import { expect, it } from 'vitest';
import { workGrid } from '../../src/engine/rules/terrain.ts';
import { addLayer, addSky, type Layer, terrainLists } from '../../src/ui/battle/field.ts';
import { drawField, readRasterTables } from '../../src/ui/battle/raster.ts';
import { buildSheet } from '../../src/ui/battle/sheet.ts';
import { cases, crcRows, differentRows, exe, mapOf, read, skyAfter, stateOf } from './screenCases.ts';

const layer = (depth: number, chip: number): Layer => ({ chip, depth, cellX: 0, cellY: 0, tint: 0, mask: 0, dx: 0, dy: 0 });

it('addLayer는 깊이가 더 큰 겹 뒤, 같거나 작은 겹 앞에 넣는다', () => {
  const list = [layer(5, 0), layer(3, 1), layer(3, 2)];
  addLayer(list, layer(3, 9));
  expect(list.map((l) => l.chip)).toEqual([0, 9, 1, 2]);
});

it('지형과 하늘이 원작과 같다(픽스처 전부)', () => {
  const tables = readRasterTables(exe);
  const wrong: string[] = [];
  for (const c of cases) {
    const map = mapOf(c.args.map);
    const sheet = buildSheet(exe, read, map);
    const { lists, open } = terrainLists(sheet, map, workGrid(map, stateOf(c)), c.args.water);
    addSky(sheet, lists, open, skyAfter(sheet.sky, c.args.skyTicks));
    const rows = differentRows(crcRows(drawField(sheet, tables, lists)), c.expected.terrain);
    if (rows.length) wrong.push(`${c.args.label}: 칩 줄 ${rows.slice(0, 5)}`);
  }
  expect(wrong).toEqual([]);
}, 60_000);

it('픽스처가 움직이는 하늘과 물 프레임, 물높이를 담는다', () => {
  const moving = cases.filter((c) => c.args.skyTicks > 0 && buildSheet(exe, read, mapOf(c.args.map)).sky.frames.length > 2);
  expect(moving.length).toBeGreaterThan(0);
  expect(new Set(cases.map((c) => c.args.water))).toEqual(new Set([0, 1, 2, 3]));
  expect(new Set(cases.map((c) => stateOf(c).waterLevel))).toEqual(new Set([-1, 0, 1]));
});
