import { expect, it } from 'vitest';
import { inArea, inRange } from '../../src/engine/rules/range.ts';
import { workGrid } from '../../src/engine/rules/terrain.ts';
import { decodeState } from '../../src/engine/state.ts';
import { readActions } from '../../src/formats/actionTable.ts';
import { openExeImage } from '../../src/formats/exeImage.ts';
import { loadMap, type ReadResource } from '../../src/formats/mapData.ts';
import { openVmDat } from '../../src/formats/vmFiles.ts';
import { readOriginal } from '../original.ts';
import { inflateBlock, readGolden } from './block.ts';

// 흔든 전투에서 (원점, 대상 칸, 행동)마다 원작 0x41074b(사거리)·0x410d77(효과 범위)를 직접 부른 결과. 재생성: pnpm oracle range
type Pair = readonly [x: number, y: number, tx: number, ty: number, action: number, inRange: number, inArea: number];
interface Case {
  readonly args: { readonly map: number; readonly block: string };
  readonly expected: { readonly pairs: readonly Pair[] };
}
const golden = readGolden<Case>('range');
const exe = openExeImage(readOriginal('vmv2.exe'));
const dat10 = openVmDat(10, readOriginal('DATA10.DAT'));
const read: ReadResource = (id) => dat10.read(id & 0xffff);
const actions = readActions(exe);

it('사거리와 효과 범위가 원작과 같다(120가지 전투 × 25쌍: 근접·포물선·직선 시야, 높이, 유닛 가림)', () => {
  expect(golden).toHaveLength(120);
  for (const [k, c] of golden.entries()) {
    const map = loadMap(exe, read, c.args.map);
    const state = decodeState(inflateBlock(c.args.block));
    const ground = { map, grid: workGrid(map, state), state };
    for (const [x, y, tx, ty, a, range, area] of c.expected.pairs) {
      const label = `경우 ${k}: (${x}, ${y}) → (${tx}, ${ty}) 행동 ${a}`;
      expect(inRange(ground, x, y, actions[a], tx, ty), label).toBe(range !== 0);
      expect(inArea(ground, actions[a], x, y, tx, ty), label).toBe(area !== 0);
    }
  }
});
