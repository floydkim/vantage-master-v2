import { expect, it } from 'vitest';
import { startFreeBattle } from '../../src/engine/battleStart.ts';
import { workGrid } from '../../src/engine/rules/terrain.ts';
import { unitOf } from '../../src/engine/state.ts';
import { readCursor } from '../../src/formats/cursors.ts';
import { readFreeModeNames, readMasterTable } from '../../src/formats/masterTable.ts';
import { DIRECTION_CURSORS, TARGET_CURSOR } from '../../src/ui/battle/cursors.ts';
import { directionAt } from '../../src/ui/battle/hex.ts';
import { cursorShape, press, startInput } from '../../src/ui/battle/session.ts';
import { engineData } from './engineData.ts';
import { pixelOf } from './pixels.ts';
import { exe, mapOf } from './screenCases.ts';

it('커서 리소스(0x44dd9f LoadCursorA): 방향 6개(0x503df4[방향])·대상 0x75(0x503e0c)는 32 × 32 그림, 핫스폿이 그림 안, 불투명 픽셀이 있다', () => {
  expect(DIRECTION_CURSORS).toEqual([0x69, 0x6a, 0x6c, 0x6b, 0x6d, 0x6e]);
  for (const id of [...DIRECTION_CURSORS, TARGET_CURSOR]) {
    const c = readCursor(exe, id);
    expect([c.image.width, c.image.height], id.toString(16)).toEqual([32, 32]);
    expect(c.hotspot.x >= 0 && c.hotspot.x < 32 && c.hotspot.y >= 0 && c.hotspot.y < 32, id.toString(16)).toBe(true);
    expect(c.image.rgba.some((v, i) => i % 4 === 3 && v === 255), id.toString(16)).toBe(true);
  }
  const hotspots = Object.fromEntries([...DIRECTION_CURSORS, TARGET_CURSOR].map((id) => [id.toString(16), readCursor(exe, id).hotspot]));
  expect(hotspots).toEqual({ 69: { x: 20, y: 23 }, '6a': { x: 15, y: 22 }, '6c': { x: 16, y: 22 }, '6b': { x: 11, y: 23 }, '6d': { x: 17, y: 20 }, '6e': { x: 13, y: 20 }, 75: { x: 16, y: 16 } });
});

it('전장 커서(0x403d04): 단계 3이면 마우스 쪽 방향(0x4033ee, 차례 유닛이 선 자리), 단계 6이면 대상, 그 밖은 화살표(null)', () => {
  const map = mapOf(3);
  const data = engineData(map);
  const state = startFreeBattle({ masters: readMasterTable(exe), oa: data.oa, names: readFreeModeNames(exe) }, map);
  const s = startInput({ state, actor: 0 });
  const u = unitOf(state, 0);
  const grid = workGrid(map, state);
  const [ux, uy] = pixelOf(map, state, { x: u.x, y: u.y });
  const points = [[60, 0], [-60, 0], [30, 40], [30, -40], [-30, 40], [-30, -40]].map(([dx, dy]) => [ux + dx, uy + dy] as const);
  const dirs = points.map(([px, py]) => cursorShape(data, { ...s, phase: 3 }, px, py));
  expect(dirs).toEqual(points.map(([px, py]) => directionAt(map, grid, px, py, u.x, u.y)));
  expect(new Set(dirs).size).toBeGreaterThan(3);
  expect(cursorShape(data, { ...s, phase: 6 }, ...points[0])).toBe('target');
  for (const phase of [1, 2, 4, 5, 7] as const) expect(cursorShape(data, { ...s, phase }, ...points[0])).toBeNull();
});

it('걸은 뒤 단계 3의 커서 방향은 그 자리에서 누르면 실제로 돌 방향(0x403fb0 단계 3)과 같다 — 걷기 전 자리가 아니라', () => {
  const map = mapOf(3);
  const data = engineData(map);
  const state = startFreeBattle({ masters: readMasterTable(exe), oa: data.oa, names: readFreeModeNames(exe) }, map);
  const s = startInput({ state, actor: 0 });
  const home = unitOf(state, 0);
  const s2 = press(data, s, ...pixelOf(map, state, { x: home.x, y: home.y })).session;
  const cells = [[0, 2], [1, 2], [-1, 2], [2, 0], [-2, 0], [0, -2], [1, -2], [0, 4]].map(([dx, dy]) => ({ x: home.x + dx, y: home.y + dy }));
  const pressAt = (c: { x: number; y: number }) => {
    try {
      return press(data, s2, ...pixelOf(map, state, c)).session;
    } catch {
      return null; // 그 칸을 고르는 픽셀이 없음(맵 밖)
    }
  };
  const s3 = cells.map(pressAt).find((n) => n?.phase === 3)!;
  const u = unitOf(s3.moved, 0);
  expect([u.x, u.y]).not.toEqual([home.x, home.y]);
  const [ux, uy] = pixelOf(map, s3.moved, { x: u.x, y: u.y });
  const points = [[60, 0], [-60, 0], [30, 40], [30, -40], [-30, 40], [-30, -40], [0, 70], [0, -70]].map(([dx, dy]) => [ux + dx, uy + dy] as const);
  const turned = points.map(([px, py]) => unitOf(press(data, s3, px, py).session.moved, 0).direction);
  expect(points.map(([px, py]) => cursorShape(data, s3, px, py))).toEqual(turned);
  const grid = workGrid(map, state);
  expect(points.some(([px, py], i) => directionAt(map, grid, px, py, home.x, home.y) !== turned[i])).toBe(true); // 걷기 전 자리로 셌다면 틀림
});
