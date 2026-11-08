// exe 리소스 디렉터리(종류 → id → 언어)에서 자료 하나를 찾는다
import type { ExeImage } from './exeImage.ts';

/** 리소스 종류 id, 첫 언어의 자료 VA와 크기 */
export function resourceData(exe: ExeImage, type: number, id: number): { readonly va: number; readonly size: number } {
  if (!exe.resources) throw new RangeError('exe에 리소스가 없습니다');
  const u16 = (va: number) => new DataView(exe.read(va, 2).buffer).getUint16(0, true);
  const u32 = (va: number) => new DataView(exe.read(va, 4).buffer).getUint32(0, true);
  // 디렉터리에서 숫자 id 항목을 찾아 그 오프셋(최상위 비트 = 하위 디렉터리)을 돌려준다
  const entry = (dir: number, want: number | null): number => {
    const named = u16(exe.resources + dir + 12);
    const count = named + u16(exe.resources + dir + 14);
    for (let i = named; i < count; i++) {
      const at = exe.resources + dir + 16 + i * 8;
      if (want === null || u32(at) === want) return u32(at + 4);
    }
    throw new RangeError(`리소스가 없습니다: 종류 ${type}, id 0x${id.toString(16)}`);
  };
  const names = entry(0, type) & 0x7fffffff;
  const languages = entry(names, id) & 0x7fffffff;
  const data = entry(languages, null);
  return { va: exe.imageBase + u32(exe.resources + data), size: u32(exe.resources + data + 4) };
}

/** 리소스 종류의 숫자 id들(디렉터리 차례). 그 종류가 없으면 빈 배열 */
export function resourceIds(exe: ExeImage, type: number): number[] {
  if (!exe.resources) return [];
  const u16 = (va: number) => new DataView(exe.read(va, 2).buffer).getUint16(0, true);
  const u32 = (va: number) => new DataView(exe.read(va, 4).buffer).getUint32(0, true);
  const entries = (dir: number) => {
    const named = u16(exe.resources + dir + 12);
    const count = named + u16(exe.resources + dir + 14);
    return Array.from({ length: count - named }, (_, i) => exe.resources + dir + 16 + (named + i) * 8);
  };
  const t = entries(0).find((at) => u32(at) === type);
  return t === undefined ? [] : entries(u32(t + 4) & 0x7fffffff).map((at) => u32(at));
}
