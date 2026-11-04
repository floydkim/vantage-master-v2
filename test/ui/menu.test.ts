import { crc32 } from 'node:zlib';
import { expect, it } from 'vitest';
import { commandMenu, MENU_H, MENU_W, menuItemAt, menuLabels } from '../../src/ui/battle/menu.ts';
import { readGolden } from '../engine/block.ts';
import { exe, read } from './screenCases.ts';

interface MenuCase {
  readonly args: { readonly enabled: readonly number[]; readonly hover: number };
  readonly expected: { readonly rows: readonly number[] };
}

it('명령 메뉴 그림이 원작과 같다(켬 16조합 × 가리킴)', () => {
  const labels = menuLabels(exe);
  expect(labels).toEqual(['Wait', 'Attack', 'Magic', 'Summon']);
  for (const c of readGolden<MenuCase>('commandMenu')) {
    const image = commandMenu(read, labels, c.args.enabled.map(Boolean), c.args.hover);
    const rows = Array.from({ length: MENU_H }, (_, r) => crc32(image.subarray(r * MENU_W, (r + 1) * MENU_W)));
    expect(rows, JSON.stringify(c.args)).toEqual(c.expected.rows);
  }
});

it('menuItemAt은 켜진 항목 칸 안에서만 고른다', () => {
  const all = [true, true, true, true];
  expect(menuItemAt(all, 10, 16)).toBe(0);
  expect(menuItemAt(all, 10, 15)).toBe(-1); // 위 16픽셀은 창 끌기 자리
  expect(menuItemAt(all, 0x44, 41)).toBe(0);
  expect(menuItemAt(all, 0x45, 30)).toBe(-1);
  expect(menuItemAt(all, 10, 16 + 29 * 3)).toBe(3);
  expect(menuItemAt([true, false, true, true], 10, 16 + 29)).toBe(-1);
});
