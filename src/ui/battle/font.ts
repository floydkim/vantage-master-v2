// 비트맵 글꼴(글꼴 객체 0x483b48, 0x423e35). 1바이트 글자는 DATA00 0번의 8 × 16 글리프: 글자 c는 (c − 0x20) × 16바이트,
// 줄마다 1바이트이고 앞 비트가 왼쪽 픽셀. 켜진 비트만 칠한다(0x424707, 글꼴 모드 0). 0x80 이상 바이트는 다음 바이트와 묶은 2바이트 글자로
// 16px 나아간다. 원작은 그 글리프를 TextOutA(Arial, 한국어판은 돋움체)로 16 × 16 1비트로 그린다(0x4241ae). 글리프는 i18n/hangul.ts의
// 제공자가 그린다: 한국어는 CP949, 원문은 Shift-JIS(장 사이 장면 일본어), 한 글자로 풀리지 않으면(영문판의 \xa1\xa1) 빈칸. 시험은 제공자가 없어 빈칸이다.
import { wideGlyph } from '../../i18n/hangul.ts';
import type { ReadAny } from './sheet.ts';

export const GLYPH_W = 8;
export const GLYPH_H = 16;
const GLYPHS = 0;

export const readGlyphs = (read: ReadAny): Uint8Array => read(GLYPHS);

// vmv2.exe 0x00423c6a: 2바이트 글자의 첫 바이트(Shift-JIS 범위가 아니라 0x80 이상 모두)
const isLead = (c: number) => c >= 0x80;

/** out[at]부터(줄 간격 pitch) text를 color로 쓴다. text는 바이트 하나가 문자 하나인 문자열 */
export function drawText(out: Uint8Array, at: number, pitch: number, text: string, color: number, glyphs: Uint8Array): void {
  for (let i = 0; i < text.length; i++, at += GLYPH_W) {
    const c = text.charCodeAt(i);
    if (isLead(c)) {
      const g = wideGlyph((c << 8) | text.charCodeAt(++i));
      if (g) {
        for (let r = 0; r < GLYPH_H; r++) {
          for (let b = 0; b < 16; b++) if (g[r * 2 + (b >> 3)] & (0x80 >> (b & 7))) out[at + r * pitch + b] = color;
        }
      }
      at += GLYPH_W; // 2바이트 글자: 16px
      continue;
    }
    if (c < 0x20) throw new RangeError(`제어 문자는 원작이 글리프 표 앞을 읽어 그린다: 0x${c.toString(16)}`);
    const g = (c - 0x20) * GLYPH_H;
    for (let r = 0; r < GLYPH_H; r++) {
      for (let b = 0; b < GLYPH_W; b++) if (glyphs[g + r] & (0x80 >> b)) out[at + r * pitch + b] = color;
    }
  }
}
