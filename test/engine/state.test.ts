import { describe, expect, it } from 'vitest';
import { decodeState, encodeState, STATE_SIZE, STONE_SLOTS, UNIT_SLOTS, unitOf } from '../../src/engine/state.ts';

/** 시드 고정 의사 난수 바이트(재현 가능) */
function randomBlock(seed: number): Uint8Array {
  const block = new Uint8Array(STATE_SIZE);
  let x = seed;
  for (let i = 0; i < block.length; i++) {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0;
    block[i] = x >>> 24;
  }
  const v = new DataView(block.buffer);
  v.setInt32(0x9e8, seed % (UNIT_SLOTS + 1), true); // 유닛 수
  v.setInt32(0xb9c, (seed * 7) % (STONE_SLOTS + 1), true); // 마정석 수
  for (const side of [0, 1]) {
    v.setInt32(0x018 + side * 0xc0 + 0x1c, (seed + side) % 7, true); // 마법 수
    v.setInt32(0x018 + side * 0xc0 + 0x38, (seed * 3 + side) % 25, true); // 네이티얼 수
  }
  return block;
}

describe('decodeState / encodeState', () => {
  it('이름 없는 바이트까지 그대로 왕복한다(무작위 블록 50개와 0 블록)', () => {
    for (const block of [new Uint8Array(STATE_SIZE), ...Array.from({ length: 50 }, (_, i) => randomBlock(i + 1))]) {
      expect(encodeState(decodeState(block))).toEqual(block);
    }
  });

  it('필드를 바꾸면 그 필드 바이트만 바뀐다', () => {
    const block = randomBlock(7);
    const state = decodeState(block);
    const changed = encodeState({ ...state, units: state.units.map((u, i) => (i === 0 ? { ...unitOf(state, 0), hp: 3 } : u)) });
    const diff = [...changed].flatMap((b, i) => (b === block[i] ? [] : [i]));
    expect(diff.every((i) => i >= 0x2e0 + 0x10 && i < 0x2e0 + 0x14)).toBe(true);
    expect(unitOf(decodeState(changed), 0).hp).toBe(3);
  });

  it('방향 자세·애니메이션·경험치·차례 시작 표시를 원작 오프셋에서 읽는다', () => {
    const block = new Uint8Array(STATE_SIZE);
    const v = new DataView(block.buffer);
    v.setInt32(0x9e8, 1, true);
    block.set([4, 13, 6], 0x2e0 + 2); // 방향 4, 자세 4 × 3 + 1, 애니메이션 6
    v.setInt32(0x2e0 + 0x1c, 57, true);
    v.setInt32(0x2dc, 1, true);
    const state = decodeState(block);
    expect(state.units[0]).toMatchObject({ direction: 4, pose: 13, animation: 6, exp: 57 });
    expect(state.turnStarted).toBe(1);
    expect(encodeState(state)).toEqual(block);
  });

  it('상태 이상·수위·Used MP를 원작 오프셋에서 읽는다', () => {
    const block = new Uint8Array(STATE_SIZE);
    const v = new DataView(block.buffer);
    v.setInt32(0x9e8, 1, true);
    v.setInt32(0x2e0 + 0x18, 75, true);
    v.setUint16(0x2e0 + 0x20, 0x0105, true);
    [-1, 0, 120].forEach((x, k) => v.setInt32(0xba0 + k * 4, x, true));
    v.setInt32(0xbb0, 42, true);
    v.setInt32(0xbb0 + 0xe4, 8, true);
    const state = decodeState(block);
    expect(state.units[0]).toMatchObject({ statusMinutes: 75, status: 0x0105 });
    expect(state).toMatchObject({ waterLevel: -1, waterStage: 0, waterMinutes: 120 });
    expect([state.stats[0][0], state.stats[1][0]]).toEqual([42, 8]);
    expect(encodeState(state)).toEqual(block);
  });

  it('이름은 원작처럼 NUL까지만 쓰고 뒤 바이트는 남긴다', () => {
    const block = randomBlock(3);
    block.set([0x41, 0x42, 0x43, 0x44, 0], 0x018);
    const state = decodeState(block);
    expect(state.sides[0].name).toBe('ABCD');
    const out = encodeState({ ...state, sides: [{ ...state.sides[0], name: 'AB' }, state.sides[1]] });
    expect([...out.subarray(0x018, 0x018 + 5)]).toEqual([0x41, 0x42, 0, 0x44, 0]);
  });

  it('마정석 수·네이티얼 목록 개수가 범위 밖이면 어느 값인지 알린다', () => {
    const stones = new Uint8Array(STATE_SIZE);
    new DataView(stones.buffer).setInt32(0xb9c, STONE_SLOTS + 1, true);
    expect(() => decodeState(stones)).toThrow('마정석 수가 범위 밖');
    const natials = new Uint8Array(STATE_SIZE);
    new DataView(natials.buffer).setInt32(0x018 + 0x38, 25, true);
    expect(() => decodeState(natials)).toThrow('진영 0 네이티얼 목록 개수가 범위 밖');
  });

  it('유닛 표의 빈 칸(null)은 건너뛰고 담는다(0x4071ea), 해독은 빈 칸 없이', () => {
    const block = randomBlock(5);
    const state = decodeState(block);
    const holes = { ...state, units: [state.units[0], null, ...state.units.slice(1), null] };
    expect(encodeState(holes)).toEqual(block);
    expect(decodeState(block).units.includes(null)).toBe(false);
    expect(() => unitOf(holes, 1)).toThrow('1번 칸이 비었습니다');
  });

  it('바이트·u16 칸을 넘는 값은 인코딩하지 않는다', () => {
    const block = new Uint8Array(STATE_SIZE);
    new DataView(block.buffer).setInt32(0x9e8, 1, true);
    const state = decodeState(block);
    expect(() => encodeState({ ...state, units: [{ ...unitOf(state, 0), x: 300 }] })).toThrow('유닛 0 x');
    expect(() => encodeState({ ...state, units: [{ ...unitOf(state, 0), type: 0x10000 }] })).toThrow('유닛 0 type');
  });

  it('크기·개수가 범위 밖이면 실패한다', () => {
    expect(() => decodeState(new Uint8Array(STATE_SIZE - 1))).toThrow('3692바이트');
    const tooManyUnits = new Uint8Array(STATE_SIZE);
    new DataView(tooManyUnits.buffer).setInt32(0x9e8, UNIT_SLOTS + 1, true);
    expect(() => decodeState(tooManyUnits)).toThrow('유닛 수가 범위 밖');
    const badSpells = new Uint8Array(STATE_SIZE);
    new DataView(badSpells.buffer).setInt32(0x018 + 0x1c, 7, true);
    expect(() => decodeState(badSpells)).toThrow('목록 개수가 범위 밖');
    const state = decodeState(new Uint8Array(STATE_SIZE));
    expect(() => encodeState({ ...state, sides: [{ ...state.sides[0], name: 'X'.repeat(21) }, state.sides[1]] })).toThrow(
      '진영 이름이 너무 깁니다',
    );
  });
});
