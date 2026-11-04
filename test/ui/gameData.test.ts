import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeState } from '../../src/engine/state.ts';
import { readScenarioData, type ScenarioMode, scenarioBlock } from '../../src/engine/scenario.ts';
import { startFreeBattle, freeModeSides } from '../../src/engine/battleStart.ts';
import { readFreeModeNames, readMasterTable } from '../../src/formats/masterTable.ts';
import { readActionCosts, readSpeedFactors } from '../../src/formats/actionTable.ts';
import { loadMap, type ReadResource } from '../../src/formats/mapData.ts';
import { decodeSaveFile, encodeSaveFile } from '../../src/formats/saveFile.ts';
import { continueRow, readMasterClassNames, readWindows } from '../../src/ui/battle/continueData.ts';
import { READ_FAILED } from '../../src/ui/battle/GameDataDialog.tsx';
import { gameDataBlock, savedPlaces, worldFromGameData } from '../../src/ui/battle/gameData.ts';
import { inflateBlock, readGolden } from '../engine/block.ts';
import { browserLatin1 } from '../i18n/browserDecoder.ts';
import { exe, read } from './screenCases.ts';

interface Case {
  readonly kind: 'save' | 'load' | 'loadCorrupt' | 'loadEmpty';
  readonly args: { label?: string; slot?: number | null; scene?: number };
  readonly expected: {
    result?: number;
    block?: string;
    dialog?: { template: number; list: number; mode: number; rows: [number, string][] } | null;
    mdi?: [string, number, number, number, number][];
    selected?: number;
    timeLimit?: number;
    rows?: [number, string][];
    row?: [number, string];
    boxes?: string[];
  };
}
afterEach(() => vi.unstubAllGlobals()); // 실패해도 TextDecoder 흉내가 남지 않게
const cases = readGolden<Case>('gameData');
const DATE = [2026, 3, 4, 5, 6];
const names = { maps: [], masters: readMasterClassNames(exe) };
const saved = cases.filter((k) => k.kind === 'save' && k.expected.block);
const blockOf = (slot: number) => inflateBlock(saved.find((k) => k.args.slot === slot)!.expected.block!);
// 월드 장면이 쓰는 칸(notes_options §4.5): +0(식별값 0), 모드·시간 제한 +0x8~+0x17, 맵 플래그 +0x198~+0x267, 고른 맵 +0x2d4, 조종 +0x9ec·+0xa04.
// 진영 레코드 +0x18~+0x197은 해석한 값으로(목록에서 뺀 칸 뒤 옛 값은 흉내 내지 않음: 월드 장면 계획 Task 2 Ruling)
const WORLD_RANGES: [number, number][] = [[0, 0x18], [0x198, 0x268], [0x2d4, 0x2d8], [0x9ec, 0x9f0], [0xa04, 0xa08]];

describe('게임 데이터(0x441aea·0x44198d)', () => {
  it('저장 블록: 월드 칸·창 구간이 원작 파일과 같다(전투 나머지 칸은 가림)', () => {
    for (const c of saved) {
      const want = blockOf(c.args.slot!);
      const { settings, places } = worldFromGameData(want);
      const ours = decodeSaveFile(encodeSaveFile(gameDataBlock(settings, places)));
      for (const [from, to] of WORLD_RANGES) expect(Buffer.from(ours.subarray(from, to)).toString('hex'), `${c.args.label} ${from.toString(16)}`).toBe(Buffer.from(want.subarray(from, to)).toString('hex'));
      expect(decodeState(ours).sides, c.args.label).toEqual(decodeState(want).sides);
      const w = readWindows(want);
      const o = readWindows(ours);
      expect([o.world, o.mapInfo, o.masterInfo, o.help, o.flags, o.zoom], c.args.label).toEqual([w.world, w.mapInfo, w.masterInfo, w.help, w.flags, w.zoom]);
      if (w.zoom !== -1) expect([o.battle, o.status, o.view], c.args.label).toEqual([w.battle, w.status, w.view]);
    }
  });

  it('전투 뒤 저장한 데이터: 확대·전장·정보 창·미니맵 자리를 그대로 읽어 다음 전투가 배치하지 않는다(0x40e392는 확대 −1일 때만)', () => {
    const { places } = worldFromGameData(blockOf(11));
    expect([places.zoom, places.battle, places.status, places.view, places.flags]).toEqual([
      2,
      { left: 0, top: 0, right: 600, bottom: 520 },
      { x: 610, y: 30 },
      { x: 610, y: 300 },
      { help: true, chat: false, status: false, view: true },
    ]);
  });

  it('저장할 창 구간: 켬은 지금 창, 확대는 전장 자리가 있을 때만(없으면 −1)', () => {
    const panes = { help: true, status: false, view: true, zoom: 2 as const };
    const world = { world: { left: 1, top: 2, right: 3, bottom: 4 } };
    expect(savedPlaces(world, panes)).toEqual({ ...world, flags: { help: true, chat: false, status: false, view: true }, zoom: -1 });
    const after = { ...world, battle: { left: 0, top: 0, right: 600, bottom: 520 } };
    expect(savedPlaces(after, panes)).toEqual({ ...after, flags: { help: true, chat: false, status: false, view: true }, zoom: 2 });
  });

  it('목록 줄(0x44161a, n < 100, 식별값 0)과 대화 상자 0x78(목록 0x834, 저장 1·읽기 0)', () => {
    for (const c of cases.filter((k) => k.kind === 'save' && k.expected.dialog)) {
      expect([c.expected.dialog!.template, c.expected.dialog!.list, c.expected.dialog!.mode]).toEqual([0x78, 0x834, 1]);
      for (const [i, [valid, text]] of c.expected.dialog!.rows.entries()) {
        const file = valid ? encodeSaveFile(gameDataBlock(worldFromGameData(blockOf(7)).settings, worldFromGameData(blockOf(7)).places)) : null;
        expect(continueRow(exe, file, i, 0, DATE, names), `${c.args.label} ${i}`).toEqual({ valid: valid === 1, text });
      }
    }
  });

  it('읽기 → 월드(0x4510b6): 창 자리는 블록 값, 고른 맵이 있으면 맵 정보·마스터 정보도', () => {
    for (const c of cases.filter((k) => k.kind === 'load')) {
      const { settings, places } = worldFromGameData(blockOf(c.args.slot!));
      expect([settings.selected, settings.timeLimit]).toEqual([c.expected.selected, c.expected.timeLimit]);
      const mdi = c.expected.mdi!;
      const [, x, y, cx, cy] = mdi.find((m) => m[0] === 'World window')!;
      expect(places.world).toEqual({ left: x, top: y, right: x + cx, bottom: y + cy });
      expect(places.help).toEqual({ x: mdi.find((m) => m[0] === 'Help window')![1], y: mdi.find((m) => m[0] === 'Help window')![2] });
      const map = mdi.find((m) => m[0] === 'Map Information Wndow');
      const master = mdi.find((m) => m[0] === 'Master Information Window');
      expect(settings.selected >= 0, '고른 맵이면 두 창').toBe(map !== undefined && master !== undefined);
      if (map) expect([places.mapInfo, places.masterInfo]).toEqual([{ x: map[1], y: map[2] }, { x: master![1], y: master![2] }]);
      expect(places.battle, '확대 −1: 다음 전투가 배치').toBeUndefined();
    }
  });

  it('읽기 실패(목록을 만든 뒤 파일이 바뀜, 바이트 100 뒤집음): 그 줄은 대시, 상자는 "Reading failed."', () => {
    const c = cases.find((k) => k.kind === 'loadCorrupt')!;
    const bad = encodeSaveFile(blockOf(c.args.slot!));
    bad[100] ^= 1;
    const [valid, text] = c.expected.row!;
    expect(continueRow(exe, bad, c.args.slot!, 0, DATE, names)).toEqual({ valid: valid === 1, text });
    expect([exe.cString(READ_FAILED)]).toEqual(c.expected.boxes);
  });

  it('빈 저장소: 80줄 모두 대시', () => {
    const rows = cases.find((k) => k.kind === 'loadEmpty')!.expected.rows!;
    expect(rows.length).toBe(80);
    rows.forEach(([valid, text], i) => expect(continueRow(exe, null, i, 0, DATE, names)).toEqual({ valid: valid === 1, text }));
  });
});

// 원작 시나리오 시작 블록(0x450da0·0x450e35, ⑤a scenarioFlow.json)의 시나리오 칸
const starts = readGolden<{ kind: string; args: { mode?: ScenarioMode }; expected: { block?: string } }>('scenarioFlow').filter((c) => c.kind === 'start');
const fieldsOf = (b: Uint8Array) => {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const i32s = (at: number, n: number) => Array.from({ length: n }, (_, k) => v.getInt32(at + k * 4, true));
  return { flag: v.getInt32(0x8, true), mode: v.getInt32(0xc, true), maps: i32s(0x198, 52), stats: i32s(0xd78, 59) };
};

describe('시나리오 블록(게임 데이터·이어 하기)', () => {
  const data = readScenarioData(exe);
  const free = freeModeSides({ masters: readMasterTable(exe), names: readFreeModeNames(exe) });
  const world = (mode: ScenarioMode) => {
    const v = new DataView(scenarioBlock(mode, data.groups).buffer);
    const flags = Array.from({ length: 52 }, (_, k) => v.getInt32(0x198 + k * 4, true));
    return { sides: [free[0], free[1]] as const, controllers: [0, 1] as const, timeLimit: 3, selected: -1, scenario: { mode, flags, stats: new Array<number>(59).fill(0) } };
  };

  it('게임 데이터 저장 블록(0x441aea): 시나리오 플래그 +0x8·모드 +0xc·맵 플래그 +0x198·통계 +0xd78가 원작 시작 블록과 같고, 읽으면(0x4510b6) 같은 설정·목록 글자 SE·SN·E', () => {
    for (const c of starts) {
      const mode = c.args.mode!;
      const want = fieldsOf(inflateBlock(c.expected.block!));
      const block = gameDataBlock(world(mode), {});
      expect(fieldsOf(block), `모드 ${mode}`).toEqual(want);
      expect(worldFromGameData(block).settings.scenario, `모드 ${mode}`).toEqual(world(mode).scenario);
      expect(continueRow(exe, encodeSaveFile(block), 0, 0, DATE, names).text.slice(0, 2), `모드 ${mode}`).toBe(['SE', 'SN', 'E '][mode]);
    }
    expect(worldFromGameData(gameDataBlock({ ...world(0), scenario: undefined }, {})).settings.scenario).toBeUndefined();
  });

  it('한국어 이름(CP949 바이트, UHC의 0x80~0x9f 포함)은 저장 블록 → 목록 줄·다시 읽기에서 바이트 그대로(브라우저 TextDecoder로도)', () => {
    browserLatin1();
    const name = '\x8c\x63\xb0\xa1A';
    const w = world(1);
    const block = gameDataBlock({ ...w, sides: [{ ...w.sides[0], name }, w.sides[1]] }, {});
    expect(continueRow(exe, encodeSaveFile(block), 0, 0, DATE, names).text).toContain(name);
    expect(worldFromGameData(block).settings.sides[0].name).toBe(name);
  });

  it('시나리오 전투 블록: 시작 상태의 블록에 시나리오 칸이 남아 이어 하기 저장(0x441e36)·되살리기에 그대로', () => {
    const map = loadMap(exe, read as ReadResource, 1);
    const w = { ...world(1), scenario: { ...world(1).scenario, stats: Array.from({ length: 59 }, (_, k) => k * 3) } };
    const state = startFreeBattle({ masters: readMasterTable(exe), oa: { actionCosts: readActionCosts(exe), speedFactors: readSpeedFactors(exe) }, names: readFreeModeNames(exe) }, map, w);
    expect(fieldsOf(state.raw)).toEqual({ flag: 1, mode: 1, maps: w.scenario.flags, stats: w.scenario.stats });
  });
});
