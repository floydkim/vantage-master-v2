// exe의 커서 리소스(RT_GROUP_CURSOR → RT_CURSOR). RT_CURSOR는 핫스폿(u16 x, y) 뒤에 아이콘과 같은 DIB다
import type { ExeImage } from './exeImage.ts';
import { decodeIcon, type Icon } from './icons.ts';
import { resourceData } from './resources.ts';

const RT_CURSOR = 1;
const RT_GROUP_CURSOR = 12;

export interface Cursor {
  readonly hotspot: { readonly x: number; readonly y: number };
  readonly image: Icon;
}

/** 커서 그룹 id의 첫 그림(원작 커서는 32 × 32 하나) */
export function readCursor(exe: ExeImage, groupId: number): Cursor {
  const g = resourceData(exe, RT_GROUP_CURSOR, groupId);
  const r = resourceData(exe, RT_CURSOR, new DataView(exe.read(g.va, g.size).buffer).getUint16(6 + 12, true));
  const b = exe.read(r.va, r.size);
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return { hotspot: { x: v.getUint16(0, true), y: v.getUint16(2, true) }, image: decodeIcon(b.subarray(4)) };
}
