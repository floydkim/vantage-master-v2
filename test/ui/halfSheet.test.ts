import { crc32 } from 'node:zlib';
import { expect, it } from 'vitest';
import { decodeState } from '../../src/engine/state.ts';
import { HALF_CHIP } from '../../src/ui/battle/halfSheet.ts';
import { drawBattle, enterHalf, loadBattleArt, loadUnitPages, logicalPalette } from '../../src/ui/battle/screen.ts';
import { NO_OVERLAY } from '../../src/ui/battle/overlay.ts';
import { SKY_START } from '../../src/ui/battle/field.ts';
import { placePage, unitPage } from '../../src/ui/battle/sprites.ts';
import { inflateBlock, readGolden } from '../engine/block.ts';
import { exe, mapOf, read } from './screenCases.ts';

interface HalfCase {
  readonly args: { readonly label: string; readonly map: number; readonly block: string; readonly markers: number; readonly effects: number; readonly dark: boolean; readonly load?: readonly [number, number]; readonly timeAfter?: boolean };
  readonly expected: { readonly half: readonly number[]; readonly logical: string; readonly field: readonly number[]; readonly terrain: readonly number[]; readonly loaded?: { readonly half: number }; readonly loadLogical?: string };
}
const cases = readGolden<HalfCase>('screenHalf');
const PAGE = 16 * HALF_CHIP;
const pages = (chips: Uint8Array) => Array.from({ length: chips.length / PAGE }, (_, i) => crc32(chips.subarray(i * PAGE, (i + 1) * PAGE)));
const rows = (field: Uint8Array) => Array.from({ length: 84 }, (_, r) => crc32(field.subarray(r * 780 * 6, (r + 1) * 780 * 6)));
const differ = (ours: readonly number[], want: readonly number[]) => want.flatMap((v, i) => (ours[i] === v ? [] : [i]));
const ui = (c: HalfCase) => (c.args.markers ? 'markers' : c.args.effects ? 'shrink' : 'keep');

it('x /2로 바꿀 때의 논리 팔레트(시각, 어두운 칸)가 원작과 같다', () => {
  for (const c of cases) {
    const art = loadBattleArt(exe, read, mapOf(c.args.map));
    const state = decodeState(inflateBlock(c.args.block));
    const ours = logicalPalette(art, state, c.args.dark ? 'dark' : 'black');
    const want = Buffer.from(c.expected.logical, 'hex');
    const diff = Array.from({ length: 236 }, (_, i) => i + 10).filter((i) => [0, 1, 2].some((k) => ours[i * 4 + k] !== want[i * 4 + k]));
    expect(diff, c.args.label).toEqual([]);
  }
});

it('반 크기 칩 시트(0x40ee74)와 반 크기 전장(780 × 504)이 원작과 같다', () => {
  const wrong: string[] = [];
  for (const c of cases) {
    const art = loadBattleArt(exe, read, mapOf(c.args.map));
    const state = decodeState(inflateBlock(c.args.block));
    // x /2인 동안 읽는 그림은 읽는 그때의 논리 팔레트로 줄인다(여기서는 바꾼 뒤 시각이 바뀐 경우)
    const later = c.expected.loadLogical ? new Uint8Array(Buffer.from(c.expected.loadLogical, 'hex')) : null;
    enterHalf(art, state, new Uint8Array(Buffer.from(c.expected.logical, 'hex')), ui(c), later ? () => later : undefined);
    // 합성 칩 캐시(페이지 0x80~0x9f, 0x43d177)는 두지 않는다. 줄이기 경우의 UI 페이지는 원작 온 시트에 CPU 생각 버퍼(0x43ff60 = 칩 0x3c60)가 남아 있다
    const skip = (p: number) => (p >= 0x80 && p < 0xa0) || (ui(c) === 'shrink' && p >= 0x3c6);
    const sheet = differ(pages(art.sheet.half!.chips), c.expected.half).filter((p) => !skip(p));
    if (sheet.length) wrong.push(`${c.args.label} 시트 페이지 ${sheet.slice(0, 12).map((p) => p.toString(16))}`);
    if (c.args.load) {
      const [resource, page] = c.args.load;
      placePage(art.sheet, read(resource), page);
      const at = (0x1000 + page * 16) * HALF_CHIP;
      if (crc32(art.sheet.half!.chips.subarray(at, at + 0xe0 * HALF_CHIP)) !== c.expected.loaded!.half) wrong.push(`${c.args.label} x /2 중 읽기`);
    }
    const view = { water: 0, sky: SKY_START };
    const field = differ(rows(drawBattle(art, state, view, NO_OVERLAY, undefined, true)), c.expected.field);
    if (field.length) wrong.push(`${c.args.label} 전장 줄 ${field.slice(0, 8)}`);
    const terrain = differ(rows(drawBattle(art, state, view, NO_OVERLAY, [], true)), c.expected.terrain);
    if (terrain.length) wrong.push(`${c.args.label} 지형 줄 ${terrain.slice(0, 8)}`);
  }
  expect(wrong).toEqual([]);
}, 60_000);

it('흐름 도중 x /2로 바꿔도 시트에 읽혀 있는 유닛 페이지(소환된 유닛)는 반 시트에 줄어 들어간다(0x40ee74는 유닛 표를 돈다)', () => {
  const c = cases[0];
  const art = loadBattleArt(exe, read, mapOf(c.args.map));
  const state = decodeState(inflateBlock(c.args.block));
  const slot = state.units.length; // 흐름 중 소환: 시트에는 있고 아직 보여 주는 상태에는 없다
  loadUnitPages(art, { ...state, units: [...state.units, { ...state.units[0]!, type: 5 }] } as typeof state);
  enterHalf(art, state, new Uint8Array(Buffer.from(c.expected.logical, 'hex')), 'markers');
  const at = (0x1000 + unitPage(slot) * 16) * HALF_CHIP;
  expect(art.sheet.half!.chips.subarray(at, at + 0xe0 * HALF_CHIP).some((v) => v !== 0)).toBe(true);
});
