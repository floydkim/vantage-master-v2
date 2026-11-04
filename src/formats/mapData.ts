// 전장 맵: DATA10 MAP000~051._SC를 맵 구조체(2,248바이트)에 풀고, 그 안의 리소스 ID로 부품(_MP)과 격자(_MD)를 읽는다.
// vmv2.exe 0x4224a0. 맵 번호 n의 스크립트 ID는 리소스 표 0x460494[n]에 있다.
import type { ExeImage } from './exeImage.ts';
import type { Light } from './natialTable.ts';

const RESOURCE_TABLE = 0x460494;
export const MAP_COUNT = 52;
export const MAP_STRUCT_SIZE = 0x8c8;
export const PART_COUNT = 512;
export const PART_SIZE = 100;
export const GRID_SIZE = 32;

/** 리소스 ID(상위 16비트 = DAT 번호, 하위 16비트 = 항목 번호)의 풀린 내용 */
export type ReadResource = (id: number) => Uint8Array;

export interface MapHeader {
  readonly name: string;
  /** +0x18 배경 그림(_BG), +0x1c 팔레트(_PL), +0x20 부품(_MP), +0x24 격자(_MD)의 리소스 ID */
  readonly backgroundId: number;
  readonly paletteId: number;
  readonly partsId: number;
  readonly gridId: number;
  /** +0x34: 시각에 따라 밝기가 바뀜(0x402272, "Bright Change" 0x468c4c) */
  readonly lightChanges: boolean;
  /** +0x38: 밝기가 바뀌지 않는 맵의 고정 밝기 */
  readonly fixedLight: Light;
  /** +0x74: 적 마스터 설정(MAS0xx._SC)의 리소스 ID (0x42d2e9) */
  readonly enemyMasterId: number;
}

export interface GameMap {
  readonly index: number;
  /** 맵 구조체 그대로. _SC 내용 뒤는 0이다 */
  readonly struct: Uint8Array;
  readonly header: MapHeader;
  /** 부품 512개 × 100바이트. 원작처럼 부품 +0x62가 12~15면 +0x63의 0x80 비트를 세운다 */
  readonly parts: Uint8Array;
  /** 32×32 칸의 부품 번호(행 우선, u16) */
  readonly grid: Uint16Array;
}

export function mapScriptId(exe: ExeImage, index: number): number {
  if (!Number.isInteger(index) || index < 0 || index >= MAP_COUNT) throw new RangeError(`맵 번호 범위 밖: ${index}`);
  return new DataView(exe.read(RESOURCE_TABLE + index * 4, 4).buffer).getUint32(0, true);
}

function expectSize(what: string, bytes: Uint8Array, size: number): void {
  if (bytes.length !== size) throw new Error(`${what} 크기가 ${size}바이트가 아닙니다: ${bytes.length}`);
}

// vmv2.exe 0x004224a0 (배경·팔레트는 화면용이라 읽지 않는다)
export function loadMap(exe: ExeImage, read: ReadResource, index: number): GameMap {
  const script = read(mapScriptId(exe, index));
  if (script.length > MAP_STRUCT_SIZE) throw new Error(`맵 스크립트가 맵 구조체보다 큽니다: ${script.length}`);
  const struct = new Uint8Array(MAP_STRUCT_SIZE);
  struct.set(script);
  const v = new DataView(struct.buffer);
  const u32 = (o: number) => v.getUint32(o, true);
  const header: MapHeader = {
    name: String.fromCharCode(...struct.subarray(0, struct.indexOf(0))), // 바이트 그대로(브라우저 ascii·latin1은 windows-1252라 CP949 0x80~0x9f가 바뀜)
    backgroundId: u32(0x18),
    paletteId: u32(0x1c),
    partsId: u32(0x20),
    gridId: u32(0x24),
    lightChanges: u32(0x34) !== 0,
    fixedLight: u32(0x38) as Light,
    enemyMasterId: u32(0x74),
  };
  const parts = new Uint8Array(read(header.partsId));
  expectSize('맵 부품', parts, PART_COUNT * PART_SIZE);
  for (let i = 0; i < PART_COUNT; i++) {
    const kind = parts[i * PART_SIZE + 0x62];
    if (kind >= 12 && kind <= 15) parts[i * PART_SIZE + 0x63] |= 0x80;
  }
  const gridBytes = read(header.gridId);
  expectSize('맵 격자', gridBytes, GRID_SIZE * GRID_SIZE * 2);
  const gv = new DataView(gridBytes.buffer, gridBytes.byteOffset, gridBytes.byteLength);
  const grid = Uint16Array.from({ length: GRID_SIZE * GRID_SIZE }, (_, i) => gv.getUint16(i * 2, true));
  return { index, struct, header, parts, grid };
}
