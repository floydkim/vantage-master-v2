// 전장 확대 x /2의 반 크기 칩 시트(vmv2.exe 0x483f44, 칩 12 × 6 = 72바이트). 확대를 x /2로 바꿀 때(0x40e762 → 0x40ee74) 온 시트를 줄여 채우고,
// 그림 페이지 0과 커서·표식 그림은 따로 그린 반 크기 리소스(7·9)에서 가져온다. 칩 번호는 온 시트와 같다.
import { type ShrinkTables, shrinkChips } from './minimap.ts';
import { type BattleSheet, CHIP, type HalfSheet, PAGES, SKY } from './sheet.ts';

export const HALF_W = 12;
export const HALF_H = 6;
export const HALF_CHIP = HALF_W * HALF_H;
const COMMON_HALF_GRAPHICS = 7; // 그림 페이지 0(0x422db7)
export const UI_HALF_GRAPHICS = 9; // 커서·표식(0x422f9a 확대 0)
const COMMON_BLOCKS = 5;
export const UI_BLOCKS = 9;
const BACKGROUND = 0x800; // 배경 칩과 어두운 판
const SKY_CHIPS = 0x600;
const UNIT_CHIPS = 0xe0;
const UI_FIRST = PAGES + 0x2c6 * 16;
const UI_CHIPS = 0x3c0;
const SHEET_CHIPS = UI_FIRST + UI_CHIPS;

/** UI 페이지 출처: 표식 그림이 읽혀 있으면(0x476bb0) 반 크기 리소스, 연출 그림이면(0x476bb4) 줄이기, 둘 다 아니면 그대로 */
export type UiSource = 'markers' | 'shrink' | 'keep';

/**
 * vmv2.exe 0x00422db7·0x00422f9a: 반 크기 그림 리소스는 온 칩 16개 묶음마다 앞 8개를 쓴다. 칩마다 위 6줄의 왼쪽·오른쪽 반,
 * 그다음 같은 8개의 아래 6줄 왼쪽·오른쪽 반이 차례로 반 칩이 된다(묶음 하나 = 반 칩 32개)
 */
export function placeHalfArt(bytes: Uint8Array, blocks: number, out: Uint8Array, first: number): void {
  let o = first * HALF_CHIP;
  for (let b = 0; b < blocks; b++) {
    const block = b * 16 * CHIP;
    for (const top of [0, 6]) {
      for (let k = 0; k < 8; k++) {
        for (const left of [0, HALF_W]) {
          for (let r = 0; r < HALF_H; r++, o += HALF_W) out.set(bytes.subarray(block + k * CHIP + (top + r) * 24 + left, block + k * CHIP + (top + r) * 24 + left + HALF_W), o);
        }
      }
    }
  }
}

/**
 * vmv2.exe 0x0040ee74: 반 시트 채우기. 유닛 페이지(unitPages, 칩 0xe0개씩), 배경 0~0x7ff(0x42322d), 페이지 0(리소스 7), 하늘 0xa00~(0x42362b),
 * UI 페이지(ui). palette는 그때의 논리 팔레트(LOGPALETTE 항목 256개), logical은 그 뒤 읽기 때의 논리 팔레트. 합성 칩 캐시(0x43d177)는 두지 않는다
 */
export function buildHalf(
  sheet: BattleSheet,
  read: (id: number) => Uint8Array,
  palette: Uint8Array,
  tables: ShrinkTables,
  unitPages: readonly number[],
  ui: UiSource,
  logical: () => Uint8Array = () => palette,
): HalfSheet {
  const chips = new Uint8Array(SHEET_CHIPS * HALF_CHIP);
  const shrink = (first: number, count: number, dither = false) => shrinkChips(sheet.chips, first, count, palette, tables, chips.subarray(first * HALF_CHIP), dither);
  for (const page of unitPages) shrink(PAGES + page * 16, UNIT_CHIPS);
  shrink(0, BACKGROUND);
  placeHalfArt(read(COMMON_HALF_GRAPHICS), COMMON_BLOCKS, chips, PAGES);
  shrink(SKY, SKY_CHIPS, true);
  if (ui === 'shrink') shrink(UI_FIRST, UI_CHIPS);
  if (ui === 'markers') placeHalfArt(read(UI_HALF_GRAPHICS), UI_BLOCKS, chips, UI_FIRST);
  return { chips, tables, logical };
}
