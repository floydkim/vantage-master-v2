import { expect, it } from 'vitest';
import { moveUnit } from '../../src/engine/rules/move.ts';
import { movementRange, moverOf } from '../../src/engine/rules/movement.ts';
import { cellHeights, terrainGraph, workGrid } from '../../src/engine/rules/terrain.ts';
import { decodeState, encodeState, unitOf } from '../../src/engine/state.ts';
import { openExeImage } from '../../src/formats/exeImage.ts';
import { loadMap, type ReadResource } from '../../src/formats/mapData.ts';
import { readNatialTable } from '../../src/formats/natialTable.ts';
import { readTerrainTables } from '../../src/formats/terrainTable.ts';
import { openVmDat } from '../../src/formats/vmFiles.ts';
import { readOriginal } from '../original.ts';
import { blockDifferences, inflateBlock, readGolden } from './block.ts';

// 이동 범위 안의 칸 하나로 원작 걷기·비행 연출(0x41377b → 0x415829·0x415a11)을 끝까지 실행한 전후 블록. 재생성: pnpm oracle move
interface Case {
  readonly args: { readonly map: number; readonly block: string; readonly mover: number; readonly to: readonly [number, number] };
  readonly expected: { readonly block: string };
}
const golden = readGolden<Case>('move');
const exe = openExeImage(readOriginal('vmv2.exe'));
const dat10 = openVmDat(10, readOriginal('DATA10.DAT'));
const read: ReadResource = (id) => dat10.read(id & 0xffff);
const tables = readTerrainTables(exe);
const natials = readNatialTable(exe);

/** 움직인 유닛의 표시 애니메이션 값(+0x03의 프레임 부분, +0x04)을 0으로: 원작은 대기 애니메이션(0x412f6d)으로도 바꾼다 */
function withoutAnimation(block: Uint8Array, mover: number): Uint8Array {
  const out = new Uint8Array(block);
  const at = 0x2e0 + mover * 0x24;
  out[at + 3] -= out[at + 3] % 3;
  out[at + 4] = 0;
  return out;
}

it('이동이 원작과 같다(300가지: 걷기·비행, 제자리 포함)', () => {
  expect(golden).toHaveLength(300);
  for (const [k, c] of golden.entries()) {
    const map = loadMap(exe, read, c.args.map);
    const state = decodeState(inflateBlock(c.args.block));
    const grid = workGrid(map, state);
    const mover = moverOf(state, natials, c.args.mover);
    const range = movementRange(tables, terrainGraph(tables, map, grid, mover.moveType), cellHeights(map, grid), state, c.args.mover, mover);
    const moved = moveUnit(tables, range, state, c.args.mover, c.args.to[0], c.args.to[1]);
    const ours = withoutAnimation(encodeState(moved), c.args.mover);
    expect(blockDifferences(ours, withoutAnimation(inflateBlock(c.expected.block), c.args.mover)), `경우 ${k}`).toEqual([]);
  }
});

it('이동 범위 밖 칸으로는 옮기지 않는다', () => {
  const c = golden[0];
  const map = loadMap(exe, read, c.args.map);
  const state = decodeState(inflateBlock(c.args.block));
  const grid = workGrid(map, state);
  const mover = moverOf(state, natials, c.args.mover);
  const range = movementRange(tables, terrainGraph(tables, map, grid, mover.moveType), cellHeights(map, grid), state, c.args.mover, { ...mover, movement: 0 });
  const u = unitOf(state, c.args.mover);
  const far = { x: (u.x + 16) % 32, y: (u.y + 16) % 32 };
  expect(() => moveUnit(tables, range, state, c.args.mover, far.x, far.y)).toThrow('이동 범위 밖');
});
