import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { startFreeBattle } from '../../src/engine/battleStart.ts';
import { terrainGraph, workGrid } from '../../src/engine/rules/terrain.ts';
import { readActionCosts, readSpeedFactors } from '../../src/formats/actionTable.ts';
import { openExeImage } from '../../src/formats/exeImage.ts';
import { loadMap, MAP_COUNT, type ReadResource } from '../../src/formats/mapData.ts';
import { readFreeModeNames, readMasterTable } from '../../src/formats/masterTable.ts';
import { MOVE_TYPES, readTerrainTables } from '../../src/formats/terrainTable.ts';
import { openVmDat } from '../../src/formats/vmFiles.ts';
import { readOriginal } from '../original.ts';
import { inflateBlock, readGolden } from './block.ts';

// 원작 프리 배틀에서 물높이·마정석 소유를 바꾸고 0x4071bd·0x440210으로 다시 만든 작업 격자와 그래프(SHA-256). 재생성: pnpm oracle terrain
interface Case {
  readonly args: { readonly map: number; readonly waterLevel: number; readonly owners: readonly number[] };
  readonly expected: { readonly grid: string; readonly graphs: readonly string[] };
}
const golden = readGolden<Case>('terrain');
const exe = openExeImage(readOriginal('vmv2.exe'));
const dat10 = openVmDat(10, readOriginal('DATA10.DAT'));
const read: ReadResource = (id) => dat10.read(id & 0xffff);
const data = {
  masters: readMasterTable(exe),
  oa: { actionCosts: readActionCosts(exe), speedFactors: readSpeedFactors(exe) },
  names: readFreeModeNames(exe),
};
const tables = readTerrainTables(exe);

it('작업 격자와 지형 그래프가 원작과 같다(맵 52개 × 물높이 3 × 무작위 마정석 소유)', () => {
  expect(golden).toHaveLength(MAP_COUNT * 3);
  for (const c of golden) {
    const map = loadMap(exe, read, c.args.map);
    const start = startFreeBattle(data, map);
    const stones = start.stones.map((s, n) => ({ ...s, owner: c.args.owners[n] }));
    const grid = workGrid(map, { waterLevel: c.args.waterLevel, stones });
    const label = `맵 ${c.args.map}, 물높이 ${c.args.waterLevel}`;
    expect(new Uint8Array(grid.buffer), label).toEqual(inflateBlock(c.expected.grid));
    for (let t = 0; t < MOVE_TYPES; t++) {
      const hash = createHash('sha256').update(terrainGraph(tables, map, grid, t)).digest('hex');
      expect(hash, `${label}, 이동 타입 ${t}`).toBe(c.expected.graphs[t]);
    }
  }
});

it('부품의 지형 종류가 지형 표 밖(17 이상)이면 RangeError', () => {
  const map = loadMap(exe, read, 0);
  const parts = new Uint8Array(map.parts);
  parts[map.grid[0] * 100 + 0x62] = 17;
  expect(() => terrainGraph(tables, { ...map, parts }, new Uint16Array(map.grid), 0)).toThrow(RangeError);
});
