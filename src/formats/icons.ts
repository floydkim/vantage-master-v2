// exe의 아이콘 리소스(RT_GROUP_ICON → RT_ICON). DIB(높이 = 그림 + AND 마스크)를 RGBA로 바꾼다
import type { ExeImage } from './exeImage.ts';
import { resourceData } from './resources.ts';

const RT_ICON = 3;
const RT_GROUP_ICON = 14;

export interface Icon {
  readonly width: number;
  readonly height: number;
  /** 색 깊이(비트) */
  readonly bits: number;
  /** RGBA, 투명 칸은 알파 0 */
  readonly rgba: Uint8ClampedArray<ArrayBuffer>;
}

/** 아이콘 그룹 id의 그림들(그룹 순서) */
export function readIcons(exe: ExeImage, groupId: number): Icon[] {
  const g = resourceData(exe, RT_GROUP_ICON, groupId);
  const gv = new DataView(exe.read(g.va, g.size).buffer);
  const count = gv.getUint16(4, true);
  return Array.from({ length: count }, (_, i) => {
    const r = resourceData(exe, RT_ICON, gv.getUint16(6 + i * 14 + 12, true));
    return decodeIcon(exe.read(r.va, r.size));
  });
}

/** 아이콘·커서 그림(DIB, 높이 = 그림 + AND 마스크)을 RGBA로 */
export function decodeIcon(b: Uint8Array): Icon {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const header = v.getUint32(0, true);
  const width = v.getInt32(4, true);
  const height = v.getInt32(8, true) / 2;
  const bits = v.getUint16(14, true);
  const colors = bits <= 8 ? v.getUint32(32, true) || 1 << bits : 0;
  const palette = header;
  const xor = palette + colors * 4;
  const xorStride = ((width * bits + 31) >> 5) << 2;
  const and = xor + xorStride * height;
  const andStride = ((width + 31) >> 5) << 2;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const row = height - 1 - y; // 아래부터
    for (let x = 0; x < width; x++) {
      let c: number;
      if (bits <= 8) {
        const bit = x * bits;
        c = (b[xor + row * xorStride + (bit >> 3)] >> (8 - bits - (bit & 7))) & ((1 << bits) - 1);
      } else c = -1;
      const at = (y * width + x) * 4;
      if (c >= 0) {
        rgba[at] = b[palette + c * 4 + 2];
        rgba[at + 1] = b[palette + c * 4 + 1];
        rgba[at + 2] = b[palette + c * 4];
      } else {
        const p = xor + row * xorStride + x * (bits >> 3);
        rgba[at] = b[p + 2];
        rgba[at + 1] = b[p + 1];
        rgba[at + 2] = b[p];
      }
      const masked = (b[and + row * andStride + (x >> 3)] >> (7 - (x & 7))) & 1;
      rgba[at + 3] = masked ? 0 : 255;
    }
  }
  return { width, height, bits, rgba };
}

/** 캡션용 작은 아이콘(SM_CXSMICON 16): 그 크기가 없으면 색이 가장 많은 것을 정수배로 줄인다(Win9x처럼 건너뛰어 고름) */
export function smallIcon(icons: readonly Icon[], size = 16): Icon {
  const exact = icons.filter((i) => i.width === size).sort((a, b) => b.bits - a.bits)[0];
  if (exact) return exact;
  const src = [...icons].sort((a, b) => b.bits - a.bits || b.width - a.width)[0];
  const step = src.width / size;
  const rgba = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) rgba.set(src.rgba.subarray(((Math.floor(y * step) * src.width + Math.floor(x * step)) * 4), (Math.floor(y * step) * src.width + Math.floor(x * step)) * 4 + 4), (y * size + x) * 4);
  return { width: size, height: size, bits: src.bits, rgba };
}
