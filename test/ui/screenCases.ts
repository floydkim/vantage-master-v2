// 전장 화면 픽스처(screen.json) 읽기와 비교 도우미. 재생성: pnpm oracle screen
import { crc32 } from 'node:zlib';
import { decodeState, type GameState } from '../../src/engine/state.ts';
import { openExeImage } from '../../src/formats/exeImage.ts';
import { type GameMap, loadMap } from '../../src/formats/mapData.ts';
import { datFileName, openVmDat, type VmDat } from '../../src/formats/vmFiles.ts';
import { SKY_START, type SkyMotion, skyTick } from '../../src/ui/battle/field.ts';
import { FIELD_W } from '../../src/ui/battle/raster.ts';
import { CHIP_H, type ReadAny, type Sky } from '../../src/ui/battle/sheet.ts';
import { inflateBlock, readGolden } from '../engine/block.ts';
import { readOriginal } from '../original.ts';

export interface ScreenCase {
  readonly args: { readonly label: string; readonly map: number; readonly block: string; readonly water: number; readonly skyTicks: number };
  /** 칩 줄 84개의 CRC32(지형만, 전체), DIB 색 표 10~245번(hex), 표시 객체 풀(0x16바이트 hex) */
  readonly expected: { readonly terrain: readonly number[]; readonly field: readonly number[]; readonly dib: string; readonly pool: readonly string[] };
}

export const cases = readGolden<ScreenCase>('screen');
export const exe = openExeImage(readOriginal('vmv2.exe'));
const dats = new Map<number, VmDat>();
export const read: ReadAny = (id) => {
  const n = id >>> 16;
  let dat = dats.get(n);
  if (!dat) dats.set(n, (dat = openVmDat(n, readOriginal(datFileName(n)))));
  return dat.read(id & 0xffff);
};
const maps = new Map<number, GameMap>();
export const mapOf = (index: number): GameMap => {
  let map = maps.get(index);
  if (!map) maps.set(index, (map = loadMap(exe, read, index)));
  return map;
};
export const stateOf = (c: ScreenCase): GameState => decodeState(inflateBlock(c.args.block));
export const skyAfter = (sky: Sky, ticks: number): SkyMotion => {
  let m = SKY_START;
  for (let i = 0; i < ticks; i++) m = skyTick(sky, m);
  return m;
};
/** 칩 줄(1560 × 12바이트)마다 CRC32 */
export const crcRows = (field: Uint8Array): number[] => {
  const size = FIELD_W * CHIP_H;
  return Array.from({ length: field.length / size }, (_, r) => crc32(field.subarray(r * size, (r + 1) * size)));
};
/** 다른 칩 줄 번호들(없으면 빈 배열) */
export const differentRows = (ours: readonly number[], want: readonly number[]): number[] => want.flatMap((v, r) => (ours[r] === v ? [] : [r]));
