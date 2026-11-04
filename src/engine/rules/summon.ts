// 소환. vmv2.exe 0x004127bb·0x004126d7(소환할 수 있는 칸), 0x0040f910(네이티얼 소환), 0x0040f47e(유닛 표의 빈 칸).
import type { GameMap } from '../../formats/mapData.ts';
import type { NatialType } from '../../formats/natialTable.ts';
import { TERRAIN_KINDS, type TerrainTables } from '../../formats/terrainTable.ts';
import type { Cell } from '../command.ts';
import { type GameState, type SideState, type UnitRecord, unitOf } from '../state.ts';
import { type OaTables, oaCost } from './oaCost.ts';
import { hexDistance } from './range.ts';
import { GRID, partByte } from './terrain.ts';
import { upkeepOf } from './time.ts';

const START_HP = 10;
const MOVED = true; // 0x40f910은 OA를 "이동함, 행동 0"으로 매긴다

export function natialOf(natials: readonly NatialType[], type: number): NatialType {
  const natial = natials[type - 1];
  if (!natial) throw new RangeError(`네이티얼 종류 ${type}이 표에 없습니다`);
  return natial;
}

// vmv2.exe 0x004127bb: 소환하는 유닛과 육각 거리 1(0x410055)이고 0x004126d7을 만족하는 칸(y 바깥, x 안쪽 순서).
// 0x4126d7: 그 종류의 이동 타입이 멈출 수 있는 지형, 소환하는 유닛 위치 객체 +8(0x417542가 칸 높이로 채움)과 칸 높이 차 1 이하, 빈 칸.
// 물높이를 바꾸는 경로(시간 진행 0x402742, 물높이 마법 스크립트 0x2b → 0x403aaa)는 모두 0x42562e → 0x417bed로 위치 객체를 다시 구하므로
// 그 값은 늘 지금 칸 높이다(오라클 확인)
export function summonCells(map: GameMap, terrain: TerrainTables, grid: Uint16Array, natials: readonly NatialType[], state: GameState, actor: number, type: number): Cell[] {
  const self = unitOf(state, actor);
  const moveType = natialOf(natials, type).moveType;
  const height = partByte(map, grid[self.y * GRID + self.x], 0x61);
  const cells: Cell[] = [];
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      if (hexDistance(self.x, self.y, x, y) !== 1) continue;
      const id = grid[y * GRID + x];
      if (!terrain.stoppable[moveType * TERRAIN_KINDS + partByte(map, id, 0x62)]) continue;
      const h = partByte(map, id, 0x61);
      if (height > h + 1 || height < h - 1) continue;
      if (state.units.some((u) => u && u.x === x && u.y === y)) continue;
      cells.push({ x, y });
    }
  }
  return cells;
}

// vmv2.exe 0x0040f910: 소환하는 마스터 진영의 레벨 0 네이티얼을 첫 빈 칸(없으면 끝, 0x40f47e)에 만든다.
// 방향은 마스터 방향, 소환 순번은 두 진영 유닛 수 합, 진영 유닛 수 +1, 유지 MP += 소환 MP / 8
export function summonNatial(oa: OaTables, natials: readonly NatialType[], state: GameState, master: number, type: number, x: number, y: number): GameState {
  const m = unitOf(state, master);
  const natial = natialOf(natials, type);
  const unit: UnitRecord = {
    x,
    y,
    direction: m.direction,
    pose: m.direction * 3,
    animation: 0,
    type,
    side: m.side,
    summonOrder: state.sideStates[0].unitCount + state.sideStates[1].unitCount,
    level: 0,
    hp: START_HP,
    oa: oaCost(oa, natial.speed[0], MOVED, 0),
    statusMinutes: 0,
    exp: 0,
    status: 0,
  };
  const units = [...state.units];
  const free = units.indexOf(null);
  if (free < 0) units.push(unit);
  else units[free] = unit;
  const grow = (s: SideState, n: number): SideState =>
    n === m.side ? { ...s, unitCount: s.unitCount + 1, upkeep: s.upkeep + upkeepOf(natials, type) } : s;
  return { ...state, units, sideStates: [grow(state.sideStates[0], 0), grow(state.sideStates[1], 1)] };
}
