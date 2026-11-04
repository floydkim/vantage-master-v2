import { useEffect, useRef } from 'react';
import type { Rect, Size } from '../frame/layout.ts';
import { toRgba } from './screen.ts';
import { TRANSPARENT } from './sheet.ts';

// 그림 미리보기(0x4453df·0x444652·0x425ab5): 0x10은 투명(SRCAND·SRCPAINT 두 번 그리기), 원본 사각형만(초상은 아래 5줄 버림)
export function Picture({ image, size, rect, colors }: { readonly image: Uint8Array; readonly size: Size; readonly rect: Rect; readonly colors: Uint8Array }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const n = size.width * size.height;
    const rgba = toRgba(image.subarray(0, n), colors);
    for (let i = 0; i < n; i++) if (image[i] === TRANSPARENT) rgba[i * 4 + 3] = 0;
    ref.current?.getContext('2d')?.putImageData(new ImageData(rgba, size.width, size.height), 0, 0);
  }, [image, size, colors]);
  return <canvas ref={ref} className="info-picture" width={size.width} height={size.height} style={{ left: rect.left, top: rect.top, width: rect.right - rect.left, height: rect.bottom - rect.top }} />;
}
