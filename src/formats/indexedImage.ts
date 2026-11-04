// 헤더 없는 8비트 인덱스 이미지(_BM, _CH 등). 너비·높이는 exe 코드에 있으므로 호출하는 쪽이 정한다.

export interface RgbaImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray<ArrayBuffer>;
}

/** palette는 256×RGB 표. 너비로 나누어떨어지지 않는 나머지 바이트는 버린다. */
export function indexedToRgba(pixels: Uint8Array, width: number, palette: Uint8Array): RgbaImage {
  if (!Number.isInteger(width) || width <= 0) throw new RangeError(`너비는 양의 정수여야 합니다: ${width}`);
  const height = Math.floor(pixels.length / width);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const c = pixels[i] * 3;
    data[i * 4] = palette[c];
    data[i * 4 + 1] = palette[c + 1];
    data[i * 4 + 2] = palette[c + 2];
    data[i * 4 + 3] = 255;
  }
  return { width, height, data };
}
