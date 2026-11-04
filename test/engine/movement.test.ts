import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { canStop, movementRange, moverOf } from '../../src/engine/rules/movement.ts';
import { cellHeights, terrainGraph, workGrid } from '../../src/engine/rules/terrain.ts';
import { decodeState } from '../../src/engine/state.ts';
import { openExeImage } from '../../src/formats/exeImage.ts';
import { loadMap, type ReadResource } from '../../src/formats/mapData.ts';
import { readNatialTable } from '../../src/formats/natialTable.ts';
import { readTerrainTables } from '../../src/formats/terrainTable.ts';
import { openVmDat } from '../../src/formats/vmFiles.ts';
import { readOriginal } from '../original.ts';
import { inflateBlock, readGolden } from './block.ts';

// 소환하고 흔든 전투에서 유닛 하나의 이동 범위를 원작(0x4404c9)으로 계산한 작업 버퍼(SHA-256)와 도달 칸. 재생성: pnpm oracle movement_range
interface Case {
  /** movement: 오라클이 실행 중 이동력(유닛 +0x48)을 바꾼 경우 그 값 */
  readonly args: { readonly map: number; readonly block: string; readonly mover: number; readonly movement?: number };
  readonly expected: { readonly work: string; readonly reached: readonly (readonly [number, number])[] };
}
const golden = readGolden<Case>('movementRange');
const exe = openExeImage(readOriginal('vmv2.exe'));
const dat10 = openVmDat(10, readOriginal('DATA10.DAT'));
const read: ReadResource = (id) => dat10.read(id & 0xffff);
const tables = readTerrainTables(exe);
const natials = readNatialTable(exe);

it('이동 범위가 원작과 같다(300가지: 이동 타입·물높이·마정석·ZOC·상태 이상 섞임 + 이동력 11~40 20가지)', () => {
  expect(golden).toHaveLength(320);
  for (const [k, c] of golden.entries()) {
    const map = loadMap(exe, read, c.args.map);
    const state = decodeState(inflateBlock(c.args.block));
    const grid = workGrid(map, state);
    const base = moverOf(state, natials, c.args.mover);
    const mover = c.args.movement === undefined ? base : { ...base, movement: c.args.movement };
    const work = movementRange(tables, terrainGraph(tables, map, grid, mover.moveType), cellHeights(map, grid), state, c.args.mover, mover);
    const reached: [number, number][] = [];
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) if (canStop(work, x, y)) reached.push([x, y]);
    expect(reached, `경우 ${k}`).toEqual(c.expected.reached);
    expect(createHash('sha256').update(work).digest('hex'), `경우 ${k}`).toBe(c.expected.work);
  }
});
