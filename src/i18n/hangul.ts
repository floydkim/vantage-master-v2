// 2바이트 글자(글자 하나 = 바이트 하나인 문자열의 0x80 이상 바이트 둘)를 그리고, 한국어판 글(CP949)을 HTML에 보인다.
// 한국어 원본을 읽으면 CP949 글리프와 한국어 모드(HTML 풀기·편집 칸·한국어판 자리)를 켜고(setHangul),
// 원문이면 Shift-JIS 글리프만 켠다(setWideGlyphs: 영문판의 장 사이 장면 글이 일본어). 시험은 둘 다 끈 채라 2바이트는 빈칸이다.

import neodgmUrl from './fonts/neodgm.woff2?url';

/** 2바이트 글자(첫 바이트 << 8 | 둘째 바이트) → 16줄 × 2바이트 글리프(앞 비트가 왼쪽 픽셀), 그릴 글자가 아니면 null(빈칸) */
export type WideGlyphs = (code: number) => Uint8Array | null;

const cp949Decoder = new TextDecoder('euc-kr'); // WHATWG euc-kr = windows-949(UHC 포함)
let wide: WideGlyphs | null = null;
let korean = false;
let layout = false;

/** 한국어: CP949 글리프와 한국어 모드. layout은 한국어판 exe의 그리기 자리(우리 번역은 영문판 exe라 false) */
export function setHangul(glyphs: WideGlyphs | null, koreanExeLayout = glyphs !== null): void {
  wide = glyphs;
  korean = glyphs !== null;
  layout = korean && koreanExeLayout;
}

/** 원문: 글리프만(HTML 글·편집 칸·자리는 그대로) */
export function setWideGlyphs(glyphs: WideGlyphs | null): void {
  wide = glyphs;
  korean = false;
  layout = false;
}

export const wideGlyph = (code: number): Uint8Array | null => wide?.(code) ?? null;

/** 한국어판 exe로 읽었는가(한국어판이 그리기 자리를 바꾼 곳에서 쓴다) */
export const koreanLayout = (): boolean => layout;

/** 2바이트 글자를 디코더로 푼 한 글자. 한 글자로 풀리지 않거나 U+FFFD면 null(영문판의 \xa1\xa1·\xa1\xa4는 Shift-JIS로 반각 두 글자라 빈칸) */
export function wideChar(decoder: TextDecoder, code: number): string | null {
  const c = decoder.decode(Uint8Array.of(code >> 8, code & 0xff));
  return [...c].length === 1 && c !== '\ufffd' ? c : null;
}

/**
 * HTML에 넣을 글: 한국어면 바이트 문자열을 CP949로 푼다. 0xff 넘는 글자가 있으면(리소스의 UTF-16 글) 이미 유니코드다.
 * 리소스 글 가운데 Latin-1 기호만 든 것(예: 메뉴 0x66의 '×1/2')은 바이트 문자열로 잘못 보므로 넣지 않는다. 한국어판 대화 상자 30개에는 그런 글이 없고 메뉴는 거치지 않는다
 */
export function htmlText(s: string): string {
  return korean && /[\x80-\xff]/.test(s) && !/[^\x00-\xff]/.test(s) ? cp949Decoder.decode(Uint8Array.from(s, (c) => c.charCodeAt(0))) : s;
}

let encoder: Map<string, string> | null = null;
/** HTML에서 친 글을 바이트 문자열로: 한국어면 CP949로 바꾸고 못 바꾸는 글자는 뺀다 */
export function byteText(s: string): string {
  return !korean || !/[^\x00-\x7f]/.test(s) ? s : cp949(s);
}

/** 유니코드 → CP949 바이트 문자열(글자 = 바이트), 못 바꾸는 글자는 뺀다. 표는 처음 쓸 때 2바이트 글자를 모두 풀어 만든다 */
export function cp949(s: string): string {
  if (!encoder) {
    encoder = new Map();
    for (let a = 0x81; a <= 0xfe; a++) {
      for (let b = 0x41; b <= 0xfe; b++) {
        const c = cp949Decoder.decode(Uint8Array.of(a, b));
        if (c.length === 1 && c !== '\ufffd' && !encoder.has(c)) encoder.set(c, String.fromCharCode(a, b));
      }
    }
  }
  return Array.from(s, (c) => (c < '\x80' ? c : (encoder!.get(c) ?? ''))).join('');
}

/** 글리프 한 줄(16비트, 앞 비트가 왼쪽)을 굵게: 오른쪽 칸이 켜지고 왼쪽 칸이 꺼진 칸을 켠다(vmv2.exe 0x4241ae, 한국어판 0x422f40) */
export function embolden(row: number): number {
  return (row | ((row << 1) & ((~((row << 2) & row) >> 1) | 0x8000))) & 0xffff;
}

/**
 * 한국어 글리프: 함께 둔 Neo둥근모(SIL OFL 1.1, fonts/neodgm-LICENSE.txt) 16px, 굵게 변환 없음. 원작 한국어판은 "돋움체" 16 × 8(0x422d4d)
 * 비트맵을 굵게 그리지만 돋움체·굴림체는 재배포할 수 없는 Microsoft 글꼴이고, 깔린 굴림체를 굵게 그린 것보다 읽기 편해 늘 Neo둥근모를 쓴다
 * (사용자 결정). 그 글꼴에 없는 글자(게임 글에서는 ⅴ·∼)는 다음 글꼴로 그린다
 */
export async function hangulGlyphs(): Promise<WideGlyphs> {
  try {
    document.fonts.add(await new FontFace('NeoDunggeunmo', `url(${neodgmUrl})`).load());
  } catch {
    // 파일을 못 받으면(기준 경로·CSP·오프라인) 다음 글꼴로 그린다. 게임은 연다
  }
  return canvasGlyphs(new TextDecoder('euc-kr'), "16px NeoDunggeunmo, 'Apple SD Gothic Neo', sans-serif", false);
}
/** 일본어 고딕(영문판 Arial DEFAULT_CHARSET이 일본어 Windows에서 이어 쓰던 글꼴) */
export const JAPANESE_FONT = "16px 'MS Gothic', 'ＭＳ ゴシック', 'Hiragino Kaku Gothic ProN', 'Hiragino Sans', 'Noto Sans JP', monospace";

/**
 * 캔버스로 만든 글리프. 원작은 글꼴을 TextOutA로 1비트 DIB에 그려 굵게 한다(0x4241ae).
 * ponytail: 브라우저 글꼴을 문턱값으로 1비트로 만든 것이라 원작 비트맵 글꼴과 픽셀이 다를 수 있다. 같게 하려면 글리프 표를 따로 들인다
 */
export function canvasGlyphs(decoder: TextDecoder, font: string, bold = true): WideGlyphs {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 16;
  const g = canvas.getContext('2d', { willReadFrequently: true })!;
  g.font = font;
  const m = g.measureText('M'); // fontBoundingBox는 글꼴 값이라 글자와 상관없다
  const base = Math.round((16 * m.fontBoundingBoxAscent) / (m.fontBoundingBoxAscent + m.fontBoundingBoxDescent));
  const cache = new Map<number, Uint8Array | null>();
  return (code) => {
    const hit = cache.get(code);
    if (hit !== undefined) return hit;
    const c = wideChar(decoder, code);
    if (c === null) {
      cache.set(code, null);
      return null;
    }
    g.clearRect(0, 0, 16, 16);
    g.fillText(c, 0, base);
    const px = g.getImageData(0, 0, 16, 16).data;
    const out = new Uint8Array(32);
    for (let y = 0; y < 16; y++) {
      let row = 0;
      for (let x = 0; x < 16; x++) if (px[(y * 16 + x) * 4 + 3] >= 0x80) row |= 0x8000 >> x;
      if (bold) row = embolden(row);
      out[y * 2] = row >> 8;
      out[y * 2 + 1] = row & 0xff;
    }
    cache.set(code, out);
    return out;
  };
}
