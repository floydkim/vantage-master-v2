import type { Cell } from '../../src/engine/command.ts';
import { workGrid } from '../../src/engine/rules/terrain.ts';
import type { GameState } from '../../src/engine/state.ts';
import type { GameMap } from '../../src/formats/mapData.ts';
import { cellAt } from '../../src/ui/battle/hex.ts';
import { FIELD_H, FIELD_W } from '../../src/ui/battle/raster.ts';

const cache = new WeakMap<Uint16Array, Map<number, [number, number]>>();
const grids = new Map<string, Uint16Array>();

/** 칸마다 cellAt이 그 칸을 내는 픽셀 하나(2픽셀 간격으로 훑음). 고를 수 없는 칸은 없다 */
export function cellPixels(map: GameMap, state: GameState): Map<number, [number, number]> {
  const grid = workGrid(map, state);
  const key = `${map.index}:${Array.from(grid).join(',')}`;
  const known = grids.get(key) ?? grid;
  grids.set(key, known);
  let pixels = cache.get(known);
  if (!pixels) {
    pixels = new Map();
    for (let py = 0; py < FIELD_H; py += 2) {
      for (let px = 0; px < FIELD_W; px += 2) {
        const c = cellAt(map, known, px, py);
        if (c && !pixels.has(c.y * 32 + c.x)) pixels.set(c.y * 32 + c.x, [px, py]);
      }
    }
    cache.set(known, pixels);
  }
  return pixels;
}

export function pixelOf(map: GameMap, state: GameState, c: Cell): [number, number] {
  const p = cellPixels(map, state).get(c.y * 32 + c.x);
  if (!p) throw new Error(`칸 (${c.x}, ${c.y})를 고르는 픽셀이 없습니다`);
  return p;
}
