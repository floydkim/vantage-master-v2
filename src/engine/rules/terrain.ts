// 작업 격자와 지형 그래프. 원작은 둘 다 실행 중 값이라 상태 블록에 없고, 맵·물높이·마정석에서 다시 만든다.
// 원작은 그래프를 전투 시작·로드·물높이 변화 때만 다시 만들고 점령 뒤에는 두지만, 소유가 바뀌어도 마정석 부품의 지형 종류·높이가
// 같아(맵 52 × 물높이 3 × 이동 타입 5에서 확인) 언제 다시 만들어도 결과가 같다.
import { type GameMap, GRID_SIZE, PART_SIZE } from '../../formats/mapData.ts';
import { BLOCKED, DIRECTIONS, FLY, TERRAIN_KINDS, type TerrainTables } from '../../formats/terrainTable.ts';
import type { GameState } from '../state.ts';

export const GRID = GRID_SIZE;
export const CELLS = GRID * GRID;
export const CELL_SIZE = 0x1f; // 그래프 칸: +0 x, +1 y, +2~+7 방향별 이웃으로 가는 비용, +0x12 플래그, +0x1e 표시
export const STONE_PART_STEP = 12; // 마정석 칸 부품 번호 += 소유(1·2) × 12

/** 부품 id의 바이트(부품 표 밖이면 RangeError) */
export const partByte = (map: GameMap, id: number, offset: number): number => {
  if (id >= map.parts.length / PART_SIZE) throw new RangeError(`부품 번호 ${id}가 부품 표 밖입니다`);
  return map.parts[id * PART_SIZE + offset];
};

// vmv2.exe 0x004071bd: 원래 격자 복사 → 물높이(0x4256a3) → 마정석 소유(0x4016b6)
export function workGrid(map: GameMap, state: Pick<GameState, 'waterLevel' | 'stones'>): Uint16Array {
  const grid = new Uint16Array(map.grid);
  for (let i = 0; i < CELLS; i++) {
    let id = grid[i];
    if (state.waterLevel === 1 && partByte(map, id, 0x63) & 4) id += 4;
    if (state.waterLevel === -1 && partByte(map, id, 0x63) & 8) id -= 4;
    grid[i] = id;
  }
  for (const s of state.stones) grid[s.y * GRID + s.x] += s.owner * STONE_PART_STEP;
  return grid;
}

/** 칸마다 높이(부품 +0x61). 이동 범위의 버킷 정렬이 쓴다 */
export function cellHeights(map: GameMap, grid: Uint16Array): Uint8Array {
  return Uint8Array.from(grid, (id) => partByte(map, id, 0x61));
}

/** 방향 d로 한 칸 간 좌표. 격자 밖이면 null (vmv2.exe 0x00440e21) */
export function step(tables: TerrainTables, x: number, y: number, d: number): { x: number; y: number } | null {
  const nx = x + tables.stepX[(y & 1) * DIRECTIONS + d];
  const ny = y + tables.stepY[d];
  return nx < 0 || nx >= GRID || ny < 0 || ny >= GRID ? null : { x: nx, y: ny };
}

// vmv2.exe 0x00440210 (이동 타입 하나)
export function terrainGraph(tables: TerrainTables, map: GameMap, grid: Uint16Array, moveType: number): Uint8Array {
  const kindOf = (id: number) => {
    const kind = partByte(map, id, 0x62);
    if (kind >= TERRAIN_KINDS) throw new RangeError(`부품 ${id}의 지형 종류 ${kind}가 지형 표 밖입니다`);
    return moveType * TERRAIN_KINDS + kind;
  };
  const graph = new Uint8Array(CELLS * CELL_SIZE);
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      const at = (y * GRID + x) * CELL_SIZE;
      const here = grid[y * GRID + x];
      graph[at] = x;
      graph[at + 1] = y;
      if (!tables.stoppable[kindOf(here)]) graph[at + 0x12] |= 2;
      for (let d = 0; d < DIRECTIONS; d++) {
        const next = step(tables, x, y, d);
        if (!next) {
          graph[at + 2 + d] = BLOCKED;
          continue;
        }
        const there = grid[next.y * GRID + next.x];
        let cost = tables.costs[kindOf(there)];
        if (cost < BLOCKED && moveType !== FLY) {
          const h = partByte(map, here, 0x61);
          const nh = partByte(map, there, 0x61);
          if (h + 1 < nh || nh + 1 < h) cost = BLOCKED;
          else if (h < nh) cost++;
        }
        graph[at + 2 + d] = cost & 0xff;
      }
    }
  }
  return graph;
}
