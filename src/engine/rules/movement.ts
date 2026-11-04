// 이동 범위. vmv2.exe 0x004404c9: 지형 그래프를 작업 버퍼(0x4c4bf0)에 복사하고 유닛·ZOC를 표시한 뒤,
// 10칸 고리 버킷 큐로 이동력 + 1번 넓혀 간다. 원작의 버퍼 배치를 그대로 쓴다(경로·AI가 같은 버퍼를 읽음).
// 칸(31바이트): +0 x, +1 y, +2~+7 방향별 비용, +8+k 비용 k로 도착한 방향, +0x12 플래그, +0x13 지금까지 비용,
// +0x14+k 비용 k로 도착하기 전 비용, +0x1e 표시. 플래그: 1 들어갈 수 없음(적), 2 멈출 수 없음(유닛·지형), 4 ZOC(더 못 감), 8 도달.
import type { NatialType } from '../../formats/natialTable.ts';
import { BLOCKED, DIRECTIONS, FLY, type TerrainTables } from '../../formats/terrainTable.ts';
import { type GameState, MASTERS, unitOf } from '../state.ts';
import { CELL_SIZE, CELLS, GRID } from './terrain.ts';

const BUCKETS = 10;
const MASTER_MOVE_TYPE = 1; // 0x40f696

export interface Mover {
  readonly moveType: number;
  readonly movement: number;
}

/** 유닛의 이동 타입과 이동력: 마스터는 이동 타입 1과 진영 레코드 이동력, 네이티얼은 네이티얼 표 (0x40f696, 0x40fc66) */
export function moverOf(state: GameState, natials: readonly NatialType[], index: number): Mover {
  const u = unitOf(state, index);
  if (index < MASTERS) return { moveType: MASTER_MOVE_TYPE, movement: state.sides[u.side].movement };
  const natial = natials[u.type - 1];
  if (!natial) throw new RangeError(`네이티얼 종류 ${u.type}이 표에 없습니다`);
  return { moveType: natial.moveType, movement: natial.movement };
}

const cellAt = (x: number, y: number) => (y * GRID + x) * CELL_SIZE;

/** 이동 범위가 보는 유닛 값(위치 객체 +0·+1·+0x0a, 진영, 상태 이상 남은 분) */
export interface Occupant {
  readonly x: number;
  readonly y: number;
  readonly direction: number;
  readonly side: number;
  readonly statusMinutes: number;
}

// 작업 버퍼 0x4c4bf0과 10칸 고리 버킷 큐(0x4c4bc0 고리 위치, 0x4c4bc4 버킷별 개수). CPU AI는 이동력 밖까지 넓혀 간다(0x447d97)
export class RangeSearch {
  readonly w: Uint8Array;
  private readonly buckets: { cost: number; at: number }[][] = Array.from({ length: BUCKETS }, () => []);
  private ring = 0;
  private readonly tables: TerrainTables;
  private readonly heights: Uint8Array;

  // vmv2.exe 0x004404f7(0x440458 그래프 복사, 0x440e74 유닛 표시, 0x440f33 ZOC, 버킷 비우기) + 0x00440567(시작 칸)
  constructor(tables: TerrainTables, graph: Uint8Array, heights: Uint8Array, units: readonly (Occupant | null)[], index: number, mover: Mover) {
    this.tables = tables;
    this.heights = heights;
    const w = new Uint8Array(graph);
    this.w = w;
    for (let i = 0; i < CELLS; i++) w[i * CELL_SIZE + 0x13] = (mover.movement + 1) & 0xff;
    const self = units[index];
    if (!self) throw new Error(`유닛 표 ${index}번 칸이 비었습니다`);
    for (const [i, u] of units.entries()) {
      if (!u) continue;
      const at = cellAt(u.x, u.y);
      if (i !== index) w[at + 0x12] |= 2;
      if (u.side !== self.side && mover.moveType !== FLY) w[at + 0x12] |= 1;
    }
    if (mover.moveType !== FLY) {
      // 상태 이상이 없는 적의 이웃 칸은 ZOC
      for (const u of units) {
        if (!u || u.side === self.side || u.statusMinutes !== 0) continue;
        const at = cellAt(u.x, u.y);
        for (let d = 0; d < DIRECTIONS; d++) if ((w[at + 2 + d] << 24) >> 24 < BLOCKED) w[this.neighbor(at, d) + 0x12] |= 4;
      }
    }
    const start = cellAt(self.x, self.y);
    w[start + 8] = self.direction;
    w[start + 0x12] = (w[start + 0x12] & ~4) | 8;
    w[start + 0x13] = 0;
    w[start + 0x1e] = 1;
    this.push(start, 0);
  }

  // 원작은 칸 주소에 칸 번호 차이(0x473f18[(y 바이트 & 1) × 6 + d])를 더한다. 격자 밖 방향은 그래프 비용이 BLOCKED라 쓰이지 않는다
  private neighbor(at: number, d: number): number {
    return at + (this.tables.stepY[d] * GRID + this.tables.stepX[(this.w[at + 1] & 1) * DIRECTIONS + d]) * CELL_SIZE;
  }

  // vmv2.exe 0x004407b5
  private push(at: number, d: number): void {
    if (d < 0) throw new Error(`음수 이동 비용: ${d}`);
    this.buckets[(this.ring + d) % BUCKETS].push({ cost: this.w[at + 0x13], at });
  }

  // vmv2.exe 0x00440827
  private expand(marker: number): void {
    const w = this.w;
    const height = (at: number) => this.heights[w[at + 1] * GRID + w[at]];
    const bucket = this.buckets[this.ring];
    for (let k = 1; k < bucket.length; k++) {
      for (let j = k; j > 0 && height(bucket[j].at) > height(bucket[j - 1].at); j--) {
        [bucket[j], bucket[j - 1]] = [bucket[j - 1], bucket[j]];
      }
    }
    for (let k = 0; k < bucket.length; k++) {
      let c = bucket[k].cost;
      const at = bucket[k].at;
      if (!(w[at + 0x12] & 2) && w[at + 0x13] !== 0) {
        w[at + 8] = w[at + 8 + c];
        w[at + 0x12] |= 8;
        w[at + 0x14] = w[at + 0x14 + c];
        w[at + 0x13] = 0;
        w[at + 0x1e] = marker;
        c = 0;
      }
      if (w[at + 0x12] & 4) continue;
      let dir = w[at + 8 + c];
      for (let n = 0; n < DIRECTIONS; n++, dir = (dir + 1) % DIRECTIONS) {
        const s = (w[at + 2 + dir] << 24) >> 24;
        if (s >= BLOCKED) continue;
        const next = this.neighbor(at, dir);
        if (c + s < w[next + 0x13] && !(w[next + 0x12] & 1)) {
          const cost = (c + s) & 0xff;
          w[next + 0x13] = cost;
          w[next + 8 + w[next + 0x13]] = dir; // 원작은 두 번 모두 +0x13을 다시 읽는다: 비용 11이면 첫 쓰기가 +0x13을 덮는다
          w[next + 0x14 + w[next + 0x13]] = c;
          this.push(next, s);
        }
      }
    }
    bucket.length = 0;
  }

  /** 이동력만큼 넓히고 칸 표시(+0x1e)를 marker로 (vmv2.exe 0x00440763) */
  advance(movement: number, marker: number): void {
    for (let k = 0; k < movement; k++) {
      this.expand(marker);
      this.ring = (this.ring + 1) % BUCKETS;
    }
    this.expand(marker);
  }

  /** 다음 차례 이동을 위해 남은 비용을 고리 앞쪽으로 옮기고 ZOC에 멈춘 칸을 다시 넣는다. 넣은 것이 있으면 true (vmv2.exe 0x004405dc) */
  relax(): boolean {
    let any = false;
    for (let k = BUCKETS - 1; k > 0; k--) {
      const bucket = this.buckets[(this.ring + k) % BUCKETS];
      let kept = 0;
      for (let i = 0; i < bucket.length; i++) {
        const e = bucket[i];
        if (k < e.cost) this.push(e.at, e.cost);
        else bucket[kept++] = e;
        any = true;
      }
      bucket.length = kept;
    }
    for (let at = 0; at < CELLS * CELL_SIZE; at += CELL_SIZE) {
      if (this.w[at + 0x12] & 8 && this.w[at + 0x12] & 4) {
        this.w[at + 0x12] &= ~4;
        this.push(at, 0);
        any = true;
      }
    }
    return any;
  }
}

// vmv2.exe 0x004404c9
export function movementRange(
  tables: TerrainTables,
  graph: Uint8Array,
  heights: Uint8Array,
  state: GameState,
  index: number,
  mover: Mover,
): Uint8Array {
  const search = new RangeSearch(tables, graph, heights, state.units, index, mover);
  search.advance(mover.movement, 1);
  return search.w;
}

/** 그 칸에 멈출 수 있는지 (vmv2.exe 0x00440ba9) */
export const canStop = (range: Uint8Array, x: number, y: number): boolean => (range[cellAt(x, y) + 0x12] & 8) !== 0;
