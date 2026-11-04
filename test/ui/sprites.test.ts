import { expect, it } from 'vitest';
import { workGrid } from '../../src/engine/rules/terrain.ts';
import { addSky, terrainLists } from '../../src/ui/battle/field.ts';
import { drawField, readRasterTables } from '../../src/ui/battle/raster.ts';
import { buildSheet } from '../../src/ui/battle/sheet.ts';
import { addSprites, decodeSprite, loadSpriteGraphics, loadUnitGraphics, unitGraphic, unitSprite } from '../../src/ui/battle/sprites.ts';
import { cases, crcRows, differentRows, exe, mapOf, read, skyAfter, stateOf } from './screenCases.ts';

it('유닛 표시 객체가 원작 풀과 같다(유닛 칸 순서)', () => {
  for (const c of cases) {
    const map = mapOf(c.args.map);
    const state = stateOf(c);
    const grid = workGrid(map, state);
    const ours = state.units.flatMap((u, slot) => (u ? [unitSprite(map, grid, u, slot)] : []));
    const want = c.expected.pool.slice(0, ours.length).map((hex) => decodeSprite(Uint8Array.from(Buffer.from(hex, 'hex'))));
    expect(ours, c.args.label).toEqual(want);
  }
});

it('전장 화면이 원작과 같다(픽스처 전부)', () => {
  const tables = readRasterTables(exe);
  const wrong: string[] = [];
  for (const c of cases) {
    const map = mapOf(c.args.map);
    const state = stateOf(c);
    const grid = workGrid(map, state);
    const sheet = buildSheet(exe, read, map);
    const graphics = loadSpriteGraphics(exe, read, sheet);
    state.units.forEach((u, slot) => u && loadUnitGraphics(exe, read, sheet, slot, unitGraphic(u, slot), u.side));
    const { lists, open } = terrainLists(sheet, map, grid, c.args.water);
    addSky(sheet, lists, open, skyAfter(sheet.sky, c.args.skyTicks));
    addSprites(lists, graphics, state.units.flatMap((u, slot) => (u ? [unitSprite(map, grid, u, slot)] : [])));
    const rows = differentRows(crcRows(drawField(sheet, tables, lists)), c.expected.field);
    if (rows.length) wrong.push(`${c.args.label}: 칩 줄 ${rows.slice(0, 5)}`);
  }
  expect(wrong).toEqual([]);
}, 60_000);

it('상태 이상 경우에 색 바꿈·덧그림이 있다', () => {
  const looks = new Set(cases.flatMap((c) => stateOf(c).units.flatMap((u) => (u ? [u.status & 7] : []))));
  expect([...looks].sort()).toEqual([0, 1, 2, 4]);
});
