// 도움말 창(Help window, CHelpWnd 0x424c2a): DIB 624 × 137, 바탕 DATA00 0x1a(624 × 136). 문구 0x424fed는 같은 글이면 그대로 두고,
// 앞 문구가 있던 줄을 세로줄 무늬로 지운 뒤(0x42523c) 새 문구를 줄마다(최대 6줄, \n) (0x7f, 8 + 20i)에 1바이트 글꼴 색 0xb로 쓴다(0x425078)
import { drawText, GLYPH_H, GLYPH_W, readGlyphs } from './font.ts';
import type { ReadAny } from './sheet.ts';

export const HELP_W = 624;
export const HELP_H = 137;
const BACKGROUND = 0x1a;
const LEFT = 0x7f;
const TOP = 8;
const LINE = 0x14;
const LINES = 6;
const COLOR = 0xb;

export class HelpWindow {
  readonly image = new Uint8Array(HELP_W * HELP_H);
  private readonly glyphs: Uint8Array;
  private text = '';

  constructor(read: ReadAny) {
    const bg = read(BACKGROUND);
    this.image.set(bg.subarray(0, Math.min(bg.length, this.image.length)));
    this.glyphs = readGlyphs(read);
  }

  /** vmv2.exe 0x00424fed: 문구를 바꾼다. 그림이 바뀌었으면 true */
  set(text: string): boolean {
    if (text === this.text) return false;
    lines(this.text).forEach((line, i) => line.length > 0 && this.erase(LEFT, TOP + i * LINE, line.length * GLYPH_W, GLYPH_H));
    lines(text).forEach((line, i) => line.length > 0 && drawText(this.image, LEFT + (TOP + i * LINE) * HELP_W, HELP_W, line, COLOR, this.glyphs));
    this.text = text;
    return true;
  }

  // vmv2.exe 0x0042523c: 짝수 x는 0xf5, 홀수 x는 0x0a
  private erase(x: number, y: number, w: number, h: number): void {
    for (let r = 0; r < h; r++) for (let k = 0; k < w; k++) this.image[(y + r) * HELP_W + x + k] = (x + k) & 1 ? 0x0a : 0xf5;
  }
}

// 줄 나누기(최대 6줄)
const lines = (text: string): string[] => text.split('\n').slice(0, LINES);
