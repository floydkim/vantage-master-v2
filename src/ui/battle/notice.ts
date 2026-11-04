// 알림판(VANTAGEPOPUP, 0x42e090 만들기 → 0x42e38f 그리기). 전투 끝·항복·물이 돌아옴 문구를 프레임 가운데에 띄운다. 그림은 그때마다 만드는
// W × 60 DIB: 색 10으로 채우고 공통 그림(페이지 0)의 테두리 칩을 통째로 놓은 뒤 글자를 그림자(41, 23) 색 10, 본문(40, 22) 색 0xb로 쓴다
import { drawText } from './font.ts';
import type { Rect } from '../frame/layout.ts';
import { CHIP, CHIP_H, CHIP_W } from './sheet.ts';

export const NOTICE_H = 60;
const COMMON = 0x1000; // 그림 페이지 0의 칩
const EDGE = [0x26, 0x36, 0x36, 0x36, 0x46]; // 줄 y = 0·12·24·36·48의 왼쪽 칩, 가운데 +1, 오른쪽 +2

/** vmv2.exe 0x0042e29c: 폭 = ((바이트 수 + 1) >> 1) × 16 + 0x50 */
export const noticeWidth = (text: string): number => ((text.length + 1) >> 1) * 16 + 0x50;

/** vmv2.exe 0x0042e29c: 프레임 창 사각형(화면 좌표) 가운데, 화면 밖 보정 없음 */
export function noticeAt(width: number, frame: Rect): { x: number; y: number } {
  return { x: Math.trunc((frame.left + frame.right - width) / 2), y: Math.trunc((frame.top + frame.bottom - NOTICE_H) / 2) };
}

/** vmv2.exe 0x0042e38f: 왼쪽 열, 가운데 칩(x = 24 + 16i, i = 0 … k + 1, 8px씩 겹침), 오른쪽 열 순서로 칩을 놓고 글자를 쓴다 */
export function noticeImage(text: string, chips: Uint8Array, glyphs: Uint8Array): { width: number; pixels: Uint8Array } {
  const width = noticeWidth(text);
  const pixels = new Uint8Array(width * NOTICE_H).fill(10);
  const put = (x: number, y: number, chip: number) => {
    const s = (COMMON + chip) * CHIP;
    for (let r = 0; r < CHIP_H; r++) pixels.set(chips.subarray(s + r * CHIP_W, s + (r + 1) * CHIP_W), (y + r) * width + x);
  };
  const column = (x: number, side: number) => EDGE.forEach((chip, j) => put(x, j * CHIP_H, chip + side));
  column(0, 0);
  for (let i = 0; i <= ((text.length + 1) >> 1) + 1; i++) column(24 + 16 * i, 1);
  column(width - CHIP_W, 2);
  drawText(pixels, 23 * width + 41, width, text, 10, glyphs);
  drawText(pixels, 22 * width + 40, width, text, 0xb, glyphs);
  return { width, pixels };
}
