import { expect, it } from 'vitest';
import { addExp } from '../../src/engine/rules/combat.ts';
import { decodeState, encodeState } from '../../src/engine/state.ts';
import { blockDifferences, inflateBlock, readGolden } from './block.ts';

// 네이티얼 하나에 얻은 경험치를 원작 경험치 연출(0x4147f2 → 0x4167a4 → 0x412cc9)로 반영한 전후 블록. 재생성: pnpm oracle exp
interface Case {
  readonly args: { readonly block: string; readonly unit: number; readonly gain: number };
  readonly expected: { readonly block: string };
}
const golden = readGolden<Case>('exp');

it('경험치 반영과 레벨 업이 원작과 같다(200가지: 음수, 여러 레벨 업, 최대 레벨)', () => {
  expect(golden).toHaveLength(200);
  for (const [k, c] of golden.entries()) {
    const after = addExp(decodeState(inflateBlock(c.args.block)), c.args.unit, c.args.gain);
    expect(blockDifferences(encodeState(after), inflateBlock(c.expected.block)), `경우 ${k}`).toEqual([]);
  }
});
