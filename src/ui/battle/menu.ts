// 명령 메뉴(객체 0x4800d4): 80 × 132 그림(DATA00 3번, 0x41a334) 위에 항목 이름 4개를 비트맵 글꼴로 쓴다(0x41a73f).
// 항목 i 칸은 (−7, 16 + 29i)~(0x45, 42 + 29i)이고(0x41a3ad), 위 16픽셀은 창을 끄는 자리다(0x41a229).
import type { ExeImage } from '../../formats/exeImage.ts';
import { drawText, readGlyphs } from './font.ts';
import type { ReadAny } from './sheet.ts';

export const MENU_W = 80;
export const MENU_H = 132;
const PICTURE = 3;
const LABELS = 0x46004c; // 이름 포인터 4개
const ITEMS = 4;
const LEFT = -7;
const RIGHT = 0x45;
const SHADOW = 10;
const DISABLED = 0x79;
const HOVER = 0x7e;
const NORMAL = 0xb;

const top = (i: number) => 16 + 29 * i;

/** 항목 이름: Wait, Attack, Magic, Summon */
export function menuLabels(exe: ExeImage): string[] {
  const v = new DataView(exe.read(LABELS, ITEMS * 4).buffer);
  return Array.from({ length: ITEMS }, (_, i) => exe.cString(v.getUint32(i * 4, true)));
}

/** 메뉴 그림(색 번호, 위에서 아래). hover는 가리킨 항목(−1 없음) (vmv2.exe 0x0041a73f) */
export function commandMenu(read: ReadAny, labels: readonly string[], enabled: readonly boolean[], hover: number): Uint8Array {
  const out = read(PICTURE).slice(0, MENU_W * MENU_H);
  const glyphs = readGlyphs(read);
  labels.forEach((label, i) => {
    const at = (top(i) + 5) * MENU_W + 0x16 + LEFT;
    drawText(out, at + MENU_W + 1, MENU_W, label, SHADOW, glyphs);
    drawText(out, at, MENU_W, label, !enabled[i] ? DISABLED : hover === i ? HOVER : NORMAL, glyphs);
  });
  return out;
}

/** 메뉴 안 픽셀이 가리키는 켜진 항목, 없으면 −1 (vmv2.exe 0x0041a29c) */
export function menuItemAt(enabled: readonly boolean[], px: number, py: number): number {
  for (let i = 0; i < ITEMS; i++) {
    if (enabled[i] && px >= LEFT && px < RIGHT && py >= top(i) && py < top(i) + 26) return i;
  }
  return -1;
}
