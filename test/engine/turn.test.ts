import { expect, it } from 'vitest';
import { beginTurn, nextActor, removeDead } from '../../src/engine/rules/turn.ts';
import { decodeState, encodeState, STATE_SIZE } from '../../src/engine/state.ts';
import { openExeImage } from '../../src/formats/exeImage.ts';
import { readNatialTable } from '../../src/formats/natialTable.ts';
import { readOriginal } from '../original.ts';
import { blockDifferences, inflateBlock, readGolden } from './block.ts';

// 차례 진행(0x40536c)을 MP 부족으로 다시 하지 않을 때까지 되풀이한 뒤의 블록과 차례를 받은 유닛. 재생성: pnpm oracle begin_turn
interface Case {
  readonly args: { readonly block: string };
  readonly expected: { readonly block: string; readonly actor: number; readonly passes: number };
}
const golden = readGolden<Case>('beginTurn');
const natials = readNatialTable(openExeImage(readOriginal('vmv2.exe')));

it('차례 진행이 원작과 같다(전투 시작 104가지 + 쓰러진 네이티얼·MP 부족이 섞인 200가지)', () => {
  expect(golden).toHaveLength(304);
  expect(golden.filter((c) => c.expected.passes > 1).length).toBeGreaterThan(5);
  for (const [k, c] of golden.entries()) {
    const { state, actor } = beginTurn(decodeState(inflateBlock(c.args.block)), natials);
    expect(blockDifferences(encodeState(state), inflateBlock(c.expected.block)), `경우 ${k}`).toEqual([]);
    expect(state.units.slice(0, actor).filter((u) => u).length, `경우 ${k}`).toBe(c.expected.actor); // 픽스처는 빈 칸을 건너뛴 압축 순서
  }
});

it('차례를 받을 유닛이 없으면 실패한다', () => {
  const block = new Uint8Array(STATE_SIZE);
  const v = new DataView(block.buffer);
  v.setInt32(0x9e8, 1, true);
  v.setInt32(0x2e0 + 0x14, 0xb41, true); // OA 2881
  expect(() => nextActor(decodeState(block))).toThrow('차례를 받을 유닛이 없습니다');
});

it('첫 후보의 대기 시간이 정확히 2880이면 실패한다(원작은 널 포인터 +9를 읽음)', () => {
  const block = new Uint8Array(STATE_SIZE);
  const v = new DataView(block.buffer);
  v.setInt32(0x9e8, 1, true);
  v.setInt32(0x2e0 + 0x14, 0xb40, true); // OA 2880
  expect(() => nextActor(decodeState(block))).toThrow('비교할 수 없습니다');
});

it('쓰러진 네이티얼의 칸은 비우고(null) 다른 유닛의 번호는 그대로 둔다', () => {
  const block = new Uint8Array(STATE_SIZE);
  const v = new DataView(block.buffer);
  v.setInt32(0x9e8, 4, true);
  for (let i = 0; i < 4; i++) {
    v.setUint16(0x2e0 + i * 0x24 + 6, i < 2 ? 0 : 1, true); // 네이티얼은 종류 1
    v.setInt32(0x2e0 + i * 0x24 + 0x10, i === 2 ? 0 : 10, true); // 2번만 HP 0
  }
  const { state } = removeDead(decodeState(block), natials);
  expect(state.units.map((u) => u?.hp ?? null)).toEqual([10, 10, null, 10]);
});

it('쓰러진 네이티얼의 종류가 표 밖이면 RangeError', () => {
  const block = new Uint8Array(STATE_SIZE);
  new DataView(block.buffer).setInt32(0x9e8, 3, true); // 마스터 둘(HP 0이어도 남김)과 종류 0인 네이티얼 하나, 모두 HP 0
  expect(() => removeDead(decodeState(block), natials)).toThrow(RangeError);
});
