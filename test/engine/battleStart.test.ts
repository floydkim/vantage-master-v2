import { expect, it } from 'vitest';
import { freeModeSides, startFreeBattle, toggleItem } from '../../src/engine/battleStart.ts';
import { decodeState, encodeState } from '../../src/engine/state.ts';
import { readActionCosts, readSpeedFactors } from '../../src/formats/actionTable.ts';
import { openExeImage } from '../../src/formats/exeImage.ts';
import { loadMap, MAP_COUNT, type ReadResource } from '../../src/formats/mapData.ts';
import { readFreeModeNames, readMasterTable } from '../../src/formats/masterTable.ts';
import { openVmDat } from '../../src/formats/vmFiles.ts';
import { shownSide } from '../../src/ui/battle/timeLimit.ts';
import { readOriginal } from '../original.ts';
import { blockDifferences, inflateBlock, readGolden } from './block.ts';

// 원작 프리 모드 메뉴(0x450ed7)와 새 전투 시작(0x4017a2)을 첫 시간 진행 직전까지 오라클로 실행한 뒤의 블록(zlib). 재생성: pnpm oracle battle_start
interface Case {
  readonly args: { readonly map: number; readonly masters: [number, number]; readonly levels: [number, number] };
  /** extension: 연장 아이콘 자리 0x476af0 − 블록(+0xe64 진영 0, +0xe68 진영 1, null 없음), 조종을 바꾼 경우만 */
  readonly expected: { readonly block: string; readonly extension?: number | null };
}
const golden = readGolden<Case>('battleStart');

const exe = openExeImage(readOriginal('vmv2.exe'));
const dat10 = openVmDat(10, readOriginal('DATA10.DAT'));
const read: ReadResource = (id) => dat10.read(id & 0xffff);
const data = {
  masters: readMasterTable(exe),
  oa: { actionCosts: readActionCosts(exe), speedFactors: readSpeedFactors(exe) },
  names: readFreeModeNames(exe),
};

it('프리 배틀 시작 블록이 원작과 같다(맵 52개 × 기본·변형 진영 = 104가지)', () => {
  const plain = golden.filter((c) => !('edits' in c.args));
  expect(plain).toHaveLength(MAP_COUNT * 2);
  for (const c of plain) {
    const original = inflateBlock(c.expected.block);
    const ours = startFreeBattle(data, loadMap(exe, read, c.args.map), [
      { master: c.args.masters[0], level: c.args.levels[0] },
      { master: c.args.masters[1], level: c.args.levels[1] },
    ]);
    expect(blockDifferences(encodeState(ours), original), `맵 ${c.args.map}, 마스터 ${c.args.masters}, 레벨 ${c.args.levels}`).toEqual([]);
  }
});

it('마정석 초기 소유 목록에 끝 표시(−1)가 없으면 실패한다', () => {
  const map = loadMap(exe, read, 0);
  const struct = new Uint8Array(map.struct);
  const v = new DataView(struct.buffer);
  for (let at = 0x2c8; at + 4 <= struct.length; at += 4) v.setInt32(at, 99, true);
  expect(() => startFreeBattle(data, { ...map, struct })).toThrow('끝 표시');
});

it('표에 없는 마스터·레벨은 RangeError', () => {
  const map = loadMap(exe, read, 0);
  expect(() => startFreeBattle(data, map, [{ master: 27, level: 0 }, { master: 1, level: 0 }])).toThrow(RangeError);
  expect(() => startFreeBattle(data, map, [{ master: 0, level: 40 }, { master: 1, level: 0 }])).toThrow(RangeError);
});

it('마정석 초기 소유 진영이 1·2가 아니면 실패한다', () => {
  const map = loadMap(exe, read, 0);
  const stone = startFreeBattle(data, map).stones[0];
  const struct = new Uint8Array(map.struct);
  const v = new DataView(struct.buffer);
  [stone.x, stone.y, 0, -1].forEach((n, i) => v.setInt32(0x2c8 + i * 4, n, true)); // 첫 항목의 소유 진영 0, 다음 항목에서 끝
  expect(() => startFreeBattle(data, { ...map, struct })).toThrow('초기 소유 진영이 1·2가 아닙니다: 0');
});

// 월드 장면에서 고친 진영(③b-4c-1): 마스터 정보 창 토글(0x42d762), 조종, 시간 제한, 편집 대화 상자의 이름·표준 이름 플래그·능력치 직접 값.
// 원작은 목록에서 뺀 칸 뒤를 지우지 않으므로(0x42d893·0x42d9e0) 목록 개수 뒤 칸은 비교에서 뺀다
interface Edits {
  readonly toggles?: readonly (readonly [number, number])[];
  readonly controllers?: readonly [number, number];
  readonly timeLimit?: number;
  readonly stats?: readonly (readonly number[])[];
  readonly names?: readonly string[];
  readonly standard?: readonly number[];
}
const listTails = (block: Uint8Array): Uint8Array => {
  const out = new Uint8Array(block);
  const v = new DataView(out.buffer);
  for (const s of [0, 1]) {
    const r = 0x18 + s * 0xc0;
    out.fill(0, r + 0x20 + v.getInt32(r + 0x1c, true) * 4, r + 0x38);
    out.fill(0, r + 0x3c + v.getInt32(r + 0x38, true) * 4, r + 0x9c);
  }
  return out;
};

it('월드 장면에서 고친 진영(목록 토글·빈 목록, 조종 (0,0)·(1,1)·(1,0), 시간 제한 0~3, 능력치 직접 값, 이름 16자·0x80 이상 바이트)으로 시작한 블록이 원작과 같다', () => {
  const edited = readGolden<Case & { args: { edits: Edits } }>('battleStart').filter((c) => c.args.edits);
  expect(edited.length).toBe(8);
  for (const c of edited) {
    const e = c.args.edits;
    let sides = freeModeSides(data, [
      { master: c.args.masters[0], level: c.args.levels[0] },
      { master: c.args.masters[1], level: c.args.levels[1] },
    ]);
    for (const [s, u] of e.toggles ?? []) sides = sides.map((r, i) => (i === s ? toggleItem(r, u) : r)) as typeof sides;
    sides = sides.map((r, s) => {
      const st = e.stats?.[s];
      return {
        ...r,
        ...(st ? { maxMp: st[0], attack: st[1], defense: st[2], magic: st[3], magicDefense: st[4], speed: st[5], movement: st[6] } : {}),
        ...(e.names ? { name: e.names[s] } : {}),
        ...(e.standard ? { standardName: e.standard[s] } : {}),
      };
    }) as typeof sides;
    const ours = startFreeBattle(data, loadMap(exe, read, c.args.map), { sides, controllers: e.controllers ?? [0, 1], timeLimit: e.timeLimit ?? 3 });
    expect(blockDifferences(listTails(encodeState(ours)), listTails(inflateBlock(c.expected.block))), JSON.stringify(e)).toEqual([]);
  }
});

it('아이템 토글(0x42d762): 있으면 빼고 없으면 오름차순으로 넣는다(빈 목록도 됨)', () => {
  const [r] = freeModeSides(data);
  expect(toggleItem(r, 0).natials).toEqual(r.natials.slice(1));
  expect(toggleItem(toggleItem(r, 4), 4).natials).toEqual(r.natials);
  expect(toggleItem(toggleItem(r, 26), 24).spells).toEqual([11, 13, 14, 15]);
  expect(toggleItem(toggleItem(toggleItem(r, 26), 24), 24).spells).toEqual([10, 11, 13, 14, 15]);
  let empty = r;
  for (let u = 0; u < 24; u++) empty = toggleItem(empty, u);
  expect(empty.natials).toEqual([]);
});

it('전투 시작 뒤 연장 아이콘 진영(0x401d98: 사람 진영이 하나면 그 진영, 둘이거나 없으면 없음)', () => {
  const cases = golden.filter((c) => 'extension' in c.expected);
  expect(cases.length).toBeGreaterThan(0);
  for (const c of cases) {
    const state = decodeState(inflateBlock(c.expected.block));
    const want = c.expected.extension === null ? null : (c.expected.extension! - 0xe64) / 4;
    expect(shownSide(state.sideStates.map((s) => s.controller), null), JSON.stringify(c.args)).toBe(want);
  }
});
