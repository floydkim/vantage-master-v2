import { expect, it } from 'vitest';
import { workGrid } from '../../src/engine/rules/terrain.ts';
import { decodeState } from '../../src/engine/state.ts';
import { cellAt, directionAt, isCell } from '../../src/ui/battle/hex.ts';
import { inflateBlock, readGolden } from '../engine/block.ts';
import { mapOf } from './screenCases.ts';

interface HitCase {
  readonly args: { readonly label: string; readonly block: string; readonly cells: readonly (readonly [number, number])[]; readonly directions: readonly (readonly [number, number, number, number])[] };
  readonly expected: { readonly cells: readonly (readonly [number, number])[]; readonly directions: readonly number[] };
}
const cases = readGolden<HitCase>('hitTest');

it('칸과 방향이 원작과 같다', () => {
  for (const c of cases) {
    const state = decodeState(inflateBlock(c.args.block));
    const map = mapOf(new DataView(inflateBlock(c.args.block).buffer).getInt32(0x2d4, true));
    const grid = workGrid(map, state);
    const cells = c.args.cells.map(([px, py]) => {
      const cell = cellAt(map, grid, px, py);
      return cell ? [cell.x, cell.y] : [-1, -1];
    });
    expect(cells, c.args.label).toEqual(c.expected.cells);
    expect(c.args.directions.map(([px, py, x, y]) => directionAt(map, grid, px, py, x, y)), c.args.label).toEqual(c.expected.directions);
  }
});

it('칸이 아닌 지형은 고르지 않는다', () => {
  const c = cases[0];
  const map = mapOf(0);
  const grid = workGrid(map, decodeState(inflateBlock(c.args.block)));
  const picked = c.expected.cells.filter(([x]) => x >= 0);
  expect(picked.length).toBeGreaterThan(0);
  for (const [x, y] of picked) expect(isCell(map, grid, x, y)).toBe(true);
});
