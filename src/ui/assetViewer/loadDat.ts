import { parseLbDir } from '../../formats/lbArchive.ts';
import { composePalette, parsePalette, type PaletteLayer } from '../../formats/palette.ts';
import { DIR_NUMBERS, datFileName, dirFileName, openVmDat, type VmDat } from '../../formats/vmFiles.ts';
import { originalBytes } from '../../originals/source.ts';
import { parseLayerSpec } from './helpers.ts';

export interface LoadedDat {
  readonly dat: VmDat;
  readonly names: readonly (string | null)[] | null;
}

const cache = new Map<number, Promise<LoadedDat>>();
const GRAYSCALE = Uint8Array.from({ length: 768 }, (_, i) => Math.floor(i / 3));

/** 원본 파일 바이트(출처는 originals/source.ts: 개발 서버의 original/ 또는 설치 마법사가 넣은 브라우저 저장소) */
export const fetchBytes = (name: string, dir = 'VMO_WIN'): Promise<Uint8Array> => originalBytes(`${dir}/${name}`);

export function loadDat(n: number): Promise<LoadedDat> {
  let loading = cache.get(n);
  if (!loading) {
    loading = (async () => ({
      dat: openVmDat(n, await fetchBytes(datFileName(n))),
      names: DIR_NUMBERS.includes(n) ? parseLbDir(await fetchBytes(dirFileName(n))) : null,
    }))();
    loading.catch(() => cache.delete(n)); // 실패는 남기지 않아 원본을 받은 뒤 다시 시도할 수 있게 한다
    cache.set(n, loading);
  }
  return loading;
}

/** 팔레트 지정 문자열로 256색 표를 만든다. 비어 있으면 인덱스를 그대로 밝기로 쓰는 회색조. */
export async function loadPalette(spec: string): Promise<Uint8Array> {
  const refs = parseLayerSpec(spec);
  if (refs.length === 0) return GRAYSCALE;
  const layers: PaletteLayer[] = [];
  for (const ref of refs) {
    const { dat } = await loadDat(ref.dat);
    layers.push({ colors: parsePalette(dat.read(ref.entry)), start: ref.start });
  }
  return composePalette(layers);
}
