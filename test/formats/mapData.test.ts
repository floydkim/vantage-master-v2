import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { openExeImage } from '../../src/formats/exeImage.ts';
import { MAP_COUNT, loadMap, mapScriptId, type ReadResource } from '../../src/formats/mapData.ts';
import { openVmDat } from '../../src/formats/vmFiles.ts';
import { readOriginal } from '../original.ts';

// 원작 맵 로드(vmv2.exe 0x4224a0)를 오라클로 실행한 뒤 메모리의 해시. 재생성: pnpm oracle map_load
interface Case {
  readonly args: { readonly index: number };
  readonly expected: { name: string; struct: string; parts: string; grid: string; workGrid: string };
}
const golden: { readonly cases: readonly Case[] } = JSON.parse(
  readFileSync(new URL('../golden/mapLoad.json', import.meta.url), 'utf8'),
);
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const gridBytes = (grid: Uint16Array) => {
  const out = new Uint8Array(grid.length * 2);
  grid.forEach((v, i) => new DataView(out.buffer).setUint16(i * 2, v, true));
  return out;
};

const exe = openExeImage(readOriginal('vmv2.exe'));
const dat10 = openVmDat(10, readOriginal('DATA10.DAT'));
const read: ReadResource = (id) => {
  if (id >>> 16 !== 10) throw new Error(`DATA10이 아닌 리소스: 0x${id.toString(16)}`);
  return dat10.read(id & 0xffff);
};

describe('loadMap', () => {
  it('맵 52개 모두 원작이 메모리에 올린 맵 구조체·부품·격자와 같다', () => {
    expect(golden.cases).toHaveLength(MAP_COUNT);
    for (const c of golden.cases) {
      const map = loadMap(exe, read, c.args.index);
      expect({
        name: map.header.name,
        struct: sha(map.struct),
        parts: sha(map.parts),
        grid: sha(gridBytes(map.grid)),
        workGrid: sha(gridBytes(map.grid)), // 원작은 격자를 그대로 복사해 작업용 사본을 만든다
      }).toEqual(c.expected);
    }
  });

  it('첫 맵은 시각에 따라 밝기가 바뀌고, 두 번째 맵은 밤으로 고정이다', () => {
    expect(loadMap(exe, read, 0).header).toMatchObject({ name: 'Silent Hill', lightChanges: true });
    expect(loadMap(exe, read, 1).header).toMatchObject({ name: 'Wavy Lake', lightChanges: false, fixedLight: 2 });
  });

  it('부품·격자 크기가 원작과 다르거나 스크립트가 맵 구조체보다 크면 실패한다', () => {
    const scriptId = mapScriptId(exe, 0);
    const shortParts: ReadResource = (id) => (id === scriptId ? read(id) : new Uint8Array(10));
    expect(() => loadMap(exe, shortParts, 0)).toThrow('맵 부품 크기가 51200바이트가 아닙니다: 10');
    const map0 = loadMap(exe, read, 0);
    const shortGrid: ReadResource = (id) => (id === map0.header.gridId ? new Uint8Array(4) : read(id));
    expect(() => loadMap(exe, shortGrid, 0)).toThrow('맵 격자 크기가 2048바이트가 아닙니다: 4');
    const hugeScript: ReadResource = (id) => (id === scriptId ? new Uint8Array(0x8c9) : read(id));
    expect(() => loadMap(exe, hugeScript, 0)).toThrow('맵 스크립트가 맵 구조체보다 큽니다');
  });

  it('맵 번호가 범위 밖이면 RangeError', () => {
    expect(() => mapScriptId(exe, MAP_COUNT)).toThrow(RangeError);
    expect(() => mapScriptId(exe, -1)).toThrow(RangeError);
  });
});
