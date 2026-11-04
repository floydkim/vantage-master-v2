// 마정석 점령. vmv2.exe 0x00401616(점령할 수 있는지), 0x0040124c(실제 게임 경로, 화면 갱신 포함)·0x00401401(같은 규칙에
// 마정석 부품 가드 +0x63 & 0x80이 더 있음. 마정석 칸은 물높이·소유와 무관하게 늘 그 비트를 가져 결과가 같다).
// 원작은 행동을 마친 유닛이 남의 마정석 위에 있으면 점령한다(0x40623b). 작업 격자의 마정석 칸 표시는 workGrid가 소유에서 다시 만든다.
import { type GameMap, PART_SIZE } from '../../formats/mapData.ts';
import type { GameState, SideState } from '../state.ts';
import { GRID } from './terrain.ts';

const STONE_PART = 0x80; // 부품 +0x63

function stoneIndex(state: GameState, x: number, y: number): number {
  const n = state.stones.findIndex((s) => s.x === x && s.y === y);
  if (n < 0) throw new Error(`(${x}, ${y})에 마정석이 없습니다(원작은 목록 밖을 읽음)`);
  return n;
}

// vmv2.exe 0x00401616: 작업 격자 칸이 마정석 부품이고 그 진영 것이 아니면 true
export function canCapture(map: GameMap, grid: Uint16Array, state: GameState, x: number, y: number, side: number): boolean {
  if (!(map.parts[grid[y * GRID + x] * PART_SIZE + 0x63] & STONE_PART)) return false;
  return state.stones[stoneIndex(state, x, y)].owner !== side + 1;
}

// vmv2.exe 0x00401401: 이전 소유 진영의 회복 배수 −1, 새 진영 +1, 소유 = 진영 + 1
export function captureStone(state: GameState, x: number, y: number, side: number): GameState {
  if (side !== 0 && side !== 1) throw new RangeError(`진영 번호 범위 밖: ${side}`);
  const n = stoneIndex(state, x, y);
  const owner = state.stones[n].owner;
  const multiplier = (s: SideState, which: number) => s.mpMultiplier - (owner === which + 1 ? 1 : 0) + (side === which ? 1 : 0);
  return {
    ...state,
    sideStates: [
      { ...state.sideStates[0], mpMultiplier: multiplier(state.sideStates[0], 0) },
      { ...state.sideStates[1], mpMultiplier: multiplier(state.sideStates[1], 1) },
    ],
    stones: state.stones.map((s, i) => (i === n ? { ...s, owner: side + 1 } : s)),
  };
}
