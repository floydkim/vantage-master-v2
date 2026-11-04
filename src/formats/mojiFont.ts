// MOJI._FN: 8×16 1비트 글꼴. 글자당 16바이트(한 줄 1바이트, 최상위 비트가 왼쪽). 0x20(공백)부터 224글자.

const GLYPH_HEIGHT = 16;
const COLUMNS = 16;

/** 글자를 16개씩 한 줄로 늘어놓은 0/1 픽셀 배열. */
export function mojiAtlas(font: Uint8Array): { width: number; pixels: Uint8Array } {
  const count = Math.floor(font.length / GLYPH_HEIGHT);
  const width = COLUMNS * 8;
  const pixels = new Uint8Array(width * Math.ceil(count / COLUMNS) * GLYPH_HEIGHT);
  for (let g = 0; g < count; g++) {
    const ox = (g % COLUMNS) * 8;
    const oy = Math.floor(g / COLUMNS) * GLYPH_HEIGHT;
    for (let y = 0; y < GLYPH_HEIGHT; y++) {
      const row = font[g * GLYPH_HEIGHT + y];
      for (let x = 0; x < 8; x++) pixels[(oy + y) * width + ox + x] = (row >> (7 - x)) & 1;
    }
  }
  return { width, pixels };
}
