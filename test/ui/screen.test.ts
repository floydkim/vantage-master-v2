import { expect, it } from 'vitest';
import { type BattleArt, battleColors, drawBattle, loadBattleArt, toRgba } from '../../src/ui/battle/screen.ts';
import { cases, crcRows, differentRows, exe, mapOf, read, skyAfter, stateOf } from './screenCases.ts';

it('drawBattle이 원작 전장 화면·색 표와 같다(맵마다 그림 자료를 이어 씀)', () => {
  const arts = new Map<number, BattleArt>();
  const wrong: string[] = [];
  for (const c of cases) {
    let art = arts.get(c.args.map);
    if (!art) arts.set(c.args.map, (art = loadBattleArt(exe, read, mapOf(c.args.map))));
    const state = stateOf(c);
    const rows = differentRows(crcRows(drawBattle(art, state, { water: c.args.water, sky: skyAfter(art.sheet.sky, c.args.skyTicks) })), c.expected.field);
    if (rows.length) wrong.push(`${c.args.label}: 칩 줄 ${rows.slice(0, 5)}`);
    expect(Buffer.from(battleColors(art, state).subarray(40, 246 * 4)).toString('hex'), c.args.label).toBe(c.expected.dib);
  }
  expect(wrong).toEqual([]);
}, 60_000);

it('캐시한 지형 목록으로 다시 그려도 같다(경우를 두 바퀴)', () => {
  const arts = new Map<number, BattleArt>();
  const wrong: string[] = [];
  for (const round of [1, 2]) {
    for (const c of cases) {
      let art = arts.get(c.args.map);
      if (!art) arts.set(c.args.map, (art = loadBattleArt(exe, read, mapOf(c.args.map))));
      const rows = differentRows(crcRows(drawBattle(art, stateOf(c), { water: c.args.water, sky: skyAfter(art.sheet.sky, c.args.skyTicks) })), c.expected.field);
      if (rows.length) wrong.push(`${round}바퀴 ${c.args.label}: 칩 줄 ${rows.slice(0, 5)}`);
    }
  }
  expect(wrong).toEqual([]);
  expect([...arts.values()].some((a) => a.terrain.size > 0)).toBe(true);
}, 60_000);

it('같은 칸에 다른 유닛이 오면 그림을 다시 읽는다', () => {
  const c = cases.find((k) => stateOf(k).units.length > 2)!;
  const state = stateOf(c);
  const natial = state.units[2]!;
  const other = { ...state, units: state.units.map((u, i) => (i === 2 && u ? { ...u, type: (natial.type % 24) + 1 } : u)) };
  const art = loadBattleArt(exe, read, mapOf(c.args.map));
  const view = { water: c.args.water, sky: skyAfter(art.sheet.sky, c.args.skyTicks) };
  const before = drawBattle(art, state, view);
  expect(drawBattle(art, other, view)).not.toEqual(before);
  expect(drawBattle(art, other, view)).toEqual(drawBattle(loadBattleArt(exe, read, mapOf(c.args.map)), other, view));
});

it('toRgba는 DIB 색 표(B, G, R)를 RGBA로', () => {
  const colors = new Uint8Array(256 * 4);
  colors.set([1, 2, 3, 0, 4, 5, 6, 0]);
  expect([...toRgba(Uint8Array.from([0, 1]), colors)]).toEqual([3, 2, 1, 255, 6, 5, 4, 255]);
});
