import { expect, it } from 'vitest';
import { canCapture, captureStone } from '../../src/engine/rules/stones.ts';
import { workGrid } from '../../src/engine/rules/terrain.ts';
import { decodeState, encodeState } from '../../src/engine/state.ts';
import { openExeImage } from '../../src/formats/exeImage.ts';
import { loadMap, type ReadResource } from '../../src/formats/mapData.ts';
import { openVmDat } from '../../src/formats/vmFiles.ts';
import { readOriginal } from '../original.ts';
import { blockDifferences, inflateBlock, readGolden } from './block.ts';

// 마정석 소유를 흔든 전투에서 원작 0x401616(점령할 수 있는지)과 0x401401(점령)을 실행한 결과. 재생성: pnpm oracle capture
interface Case {
  readonly args: { readonly map: number; readonly block: string; readonly x: number; readonly y: number; readonly side: number; readonly stone: boolean };
  readonly expected: { readonly canCapture: number; readonly block: string; readonly grid: string };
}
const golden = readGolden<Case>('capture');
const exe = openExeImage(readOriginal('vmv2.exe'));
const dat10 = openVmDat(10, readOriginal('DATA10.DAT'));
const read: ReadResource = (id) => dat10.read(id & 0xffff);

it('마정석 점령이 원작과 같다(200가지: 남의 것·자기 것·빈 것, 마정석이 아닌 칸)', () => {
  expect(golden).toHaveLength(200);
  for (const [k, c] of golden.entries()) {
    const map = loadMap(exe, read, c.args.map);
    const { x, y, side } = c.args;
    const state = decodeState(inflateBlock(c.args.block));
    expect(canCapture(map, workGrid(map, state), state, x, y, side), `경우 ${k}`).toBe(c.expected.canCapture !== 0);
    const after = c.args.stone ? captureStone(state, x, y, side) : state;
    expect(blockDifferences(encodeState(after), inflateBlock(c.expected.block)), `경우 ${k}`).toEqual([]);
    expect(new Uint8Array(workGrid(map, after).buffer), `경우 ${k}`).toEqual(inflateBlock(c.expected.grid));
  }
});

it('마정석이 없는 칸을 점령하거나 진영 번호가 범위 밖이면 실패한다', () => {
  const state = decodeState(inflateBlock(golden[0].args.block));
  expect(() => captureStone(state, 99, 99, 0)).toThrow('마정석이 없습니다');
  const s = state.stones[0];
  expect(() => captureStone(state, s.x, s.y, 2)).toThrow(RangeError);
});
