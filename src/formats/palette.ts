// 팔레트(_PL): Win32 PALETTEENTRY(R, G, B, flags) 배열. 원본은 flags가 전부 1(PC_RESERVED)이다.
// 256칸 중 어디부터 들어가는지는 exe가 정한다(③에서 확인). 뷰어에서는 시작 칸을 직접 지정한다.

export type Rgb = readonly [r: number, g: number, b: number];

export function parsePalette(bytes: Uint8Array): Rgb[] {
  if (bytes.length % 4 !== 0) throw new Error(`팔레트 길이가 4의 배수가 아닙니다: ${bytes.length}`);
  const colors: Rgb[] = [];
  for (let i = 0; i < bytes.length; i += 4) colors.push([bytes[i], bytes[i + 1], bytes[i + 2]]);
  return colors;
}

export interface PaletteLayer {
  readonly colors: readonly Rgb[];
  readonly start: number;
}

/** 256색 RGB 표(768바이트)를 만든다. 채우지 않은 칸은 마젠타로 둬서 눈에 띄게 한다. */
export function composePalette(layers: readonly PaletteLayer[]): Uint8Array {
  const table = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) table.set([255, 0, 255], i * 3);
  for (const { colors, start } of layers) {
    colors.forEach((color, i) => {
      if (start + i < 256) table.set(color, (start + i) * 3);
    });
  }
  return table;
}
