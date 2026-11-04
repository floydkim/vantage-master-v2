import { isDeepStrictEqual } from 'node:util';
import { describe, expect, it } from 'vitest';
import { accumulateStats, progressScenario, readScenario, readScenarioData, SCENARIO_STATS, type ScenarioMode, scenarioBlock, scenarioEnemy, scenarioPlayer } from '../../src/engine/scenario.ts';
import { decodeState, type SideRecord, STATE_SIZE } from '../../src/engine/state.ts';
import { openExeImage } from '../../src/formats/exeImage.ts';
import { loadMap, type ReadResource } from '../../src/formats/mapData.ts';
import { readMasterTable } from '../../src/formats/masterTable.ts';
import { openVmDat } from '../../src/formats/vmFiles.ts';
import { readOriginal } from '../original.ts';
import { inflateBlock, readGolden } from './block.ts';

// 원작 함수를 오라클로 부른 뒤의 블록·진영 레코드. 재생성: pnpm oracle scenario_flow
interface Case {
  readonly kind: 'start' | 'player' | 'enemy' | 'progress' | 'levelUp' | 'stats';
  readonly args: { mode?: ScenarioMode; master?: number; name?: string; map?: number; start?: string; side?: string; calls?: { first: number; days: number; side: number[] }[] };
  readonly expected: { block?: string; side?: string; steps?: { map: number; scene: number; flags: number[]; side: string }[]; total?: number[] };
}
const cases = readGolden<Case>('scenarioFlow');
const exe = openExeImage(readOriginal('vmv2.exe'));
const dat10 = openVmDat(10, readOriginal('DATA10.DAT'));
const read: ReadResource = (id) => dat10.read(id & 0xffff);
const data = { masters: readMasterTable(exe), ...readScenarioData(exe) };

/** 진영 레코드(0xc0바이트)를 빈 블록의 진영 0 자리에 넣어 푼다 */
function sideOf(hex: string): SideRecord {
  const block = new Uint8Array(STATE_SIZE);
  block.set(Buffer.from(hex, 'hex'), 0x18);
  return decodeState(block).sides[0];
}
const i32s = (b: Uint8Array, from: number, to: number) => Array.from({ length: (to - from) / 4 }, (_, k) => new DataView(b.buffer, b.byteOffset).getInt32(from + k * 4, true));
// 시작 함수가 쓰는 칸: 시나리오 플래그 +0x8, 모드 +0xc, 네트워크 +0x10, 맵 플래그 +0x198~+0x267, 진영 조종 +0x9ec·+0xa04
const startFields = (b: Uint8Array) => ({ flags: i32s(b, 0x8, 0x14), maps: i32s(b, 0x198, 0x268), controllers: [...i32s(b, 0x9ec, 0x9f0), ...i32s(b, 0xa04, 0xa08)] });

describe('시나리오 시작과 진영 준비', () => {
  it('시작 블록(0x450da0·0x450e35): 시나리오 플래그·모드·첫 묶음만 열림·진영 0 사람 1 CPU', () => {
    for (const c of cases.filter((k) => k.kind === 'start')) {
      expect(startFields(scenarioBlock(c.args.mode!, data.groups)), `모드 ${c.args.mode}`).toEqual(startFields(inflateBlock(c.expected.block!)));
    }
  });

  it('우리 진영(0x42d190): 이름, 표준 이름 0, 레벨(Expert 22), 능력치, 시나리오는 네이티얼 1·7·13·22, Expert는 마법 10~15·네이티얼 1~24', () => {
    for (const c of cases.filter((k) => k.kind === 'player')) {
      expect(scenarioPlayer(data, c.args.name!, c.args.master!, c.args.mode!), JSON.stringify(c.args)).toEqual(sideOf(c.expected.side!));
    }
  });

  it('적 진영(0x42d2e9): 맵의 MAS 이름·마스터·레벨(Easy는 (max(레벨 − 7, 0) × 17 + 5) / 22)·능력치·아이템', () => {
    const wrong: string[] = [];
    for (const c of cases.filter((k) => k.kind === 'enemy')) {
      const map = loadMap(exe, read, c.args.map!);
      const ours = scenarioEnemy(data, read(map.header.enemyMasterId), c.args.mode!);
      const want = sideOf(c.expected.side!);
      if (!isDeepStrictEqual(ours, want)) wrong.push(`${JSON.stringify(c.args)}: ${JSON.stringify(ours)} ≠ ${JSON.stringify(want)}`);
    }
    expect(wrong.slice(0, 3)).toEqual([]);
  });
});

describe('시나리오 진행과 통계', () => {
  it('진행(0x45157b): 깬 맵 2, 묶음 절반 규칙으로 열림, 같은 맵 다시, 맵 26 → 5, 다 깨면 6, Expert, 우리 마스터 레벨 + 1·보상 아이템(0x42da93)', () => {
    for (const c of cases.filter((k) => k.kind === 'progress')) {
      const start = decodeState(inflateBlock(c.args.start!));
      let flags = i32s(inflateBlock(c.args.start!), 0x198, 0x268);
      let player = start.sides[0];
      for (const step of c.expected.steps!) {
        const r = progressScenario(data, flags, step.map, c.args.mode!, player);
        expect({ scene: r.scene, flags: r.flags, player: r.player }, `모드 ${c.args.mode} 맵 ${step.map}`).toEqual({ scene: step.scene, flags: step.flags, player: sideOf(step.side) });
        flags = r.flags;
        player = r.player;
      }
    }
  });

  it('레벨 40부터(0x42dae0): 평탄한 행 (마스터 × 40 + 레벨)이라 다음 마스터의 행, 표 뒤는 exe의 다른 데이터', () => {
    const flags = new Array<number>(52).fill(2);
    for (const c of cases.filter((k) => k.kind === 'levelUp')) {
      const player = sideOf(c.args.side!);
      expect(progressScenario(data, flags, 37, 2, player).player, `마스터 ${player.master} 레벨 ${player.level}`).toEqual(sideOf(c.expected.side!));
    }
  });

  it('목록이 차면 보상을 넣지 않는다(원작은 네이티얼 25번째가 +0x9c 마스터를, 마법 7번째가 +0x38 네이티얼 개수를 덮어쓴다 — 일부러 다르게)', () => {
    const c = cases.find((k) => k.kind === 'levelUp')!;
    const full = { ...sideOf(c.args.side!), level: 0, spells: [10, 11, 12, 13, 14, 15], natials: Array.from({ length: 24 }, (_, k) => k + 1) };
    const flags = new Array<number>(52).fill(2);
    const natialMap = data.rewards.findIndex((r) => r !== -1 && data.items[r].natial);
    const spellMap = data.rewards.findIndex((r) => r !== -1 && !data.items[r].natial);
    for (const map of [natialMap, spellMap]) {
      const { player } = progressScenario(data, flags, map, 1, full);
      expect({ spells: player.spells, natials: player.natials, master: player.master }, `맵 ${map}`).toEqual({ spells: full.spells, natials: full.natials, master: full.master });
    }
  });

  it('통계 누적(0x41bd98): 블록 +0xd78의 59칸에 첫 칸·날짜·진영 통계 57칸을 더한다', () => {
    const c = cases.find((k) => k.kind === 'stats')!;
    let total = new Array<number>(59).fill(0); // 0x41bce9
    for (const call of c.args.calls!) total = accumulateStats(total, call.first, call.days, call.side);
    expect(total).toEqual(c.expected.total);
    expect(i32s(inflateBlock(c.expected.block!), SCENARIO_STATS, SCENARIO_STATS + 59 * 4)).toEqual(c.expected.total);
  });
});

it('통계 누적(0x41bd98)은 칸 수(시나리오 59·진영 57)가 틀리면 던진다 — 모자란 칸을 조용히 0으로 더하지 않게', () => {
  const zeros = (n: number) => new Array<number>(n).fill(0);
  expect(accumulateStats(zeros(59), 1, 2, new Array<number>(57).fill(3))).toEqual([1, 2, ...new Array<number>(57).fill(3)]);
  expect(() => accumulateStats(zeros(59), 1, 2, zeros(56))).toThrow(RangeError);
  expect(() => accumulateStats(zeros(58), 1, 2, zeros(57))).toThrow(RangeError);
});

it('블록의 시나리오 칸: +0x8이 0이 아니어도 모드(+0xc)가 0~2(Easy·Normal·Expert) 밖이면 없음(손댄 세이브)', () => {
  const raw = new Uint8Array(STATE_SIZE);
  const v = new DataView(raw.buffer);
  v.setInt32(0x08, 1, true);
  for (const mode of [0, 1, 2]) {
    v.setInt32(0x0c, mode, true);
    expect(readScenario(raw)?.mode).toBe(mode);
  }
  for (const mode of [3, -1]) {
    v.setInt32(0x0c, mode, true);
    expect(readScenario(raw), String(mode)).toBeUndefined();
  }
});
