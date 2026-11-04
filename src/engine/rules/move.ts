// 이동 실행. vmv2.exe 0x00406c5b → 걷기 연출 0x00415829(비행 0x00415a11): 6프레임마다 0x00440bcd로 이동 범위 버퍼의 경로를 따라 한 칸 가고 방향을 바꾼다.
// 연출이 바꾸는 위치 객체 +0x0b의 프레임 부분(압축 레코드 +0x03 % 3)과 +0x12(+0x04)는 프레임 실행기(0x412f6d)의
// 대기 애니메이션도 바꾸는(옵션 0x503ff0 & 4에 따라) 표시 값이라 옮기지 않는다. 방향 부분(+0x03 = 방향 × 3 + 프레임, 0x417957)만 맞춘다.
import { DIRECTIONS, type TerrainTables } from '../../formats/terrainTable.ts';
import { type GameState, unitOf } from '../state.ts';
import { canStop } from './movement.ts';
import { CELL_SIZE, CELLS, GRID, step } from './terrain.ts';

export interface Step {
  readonly x: number;
  readonly y: number;
  /** 그 칸에 들어설 때 바라보는 방향 */
  readonly direction: number;
}

// vmv2.exe 0x00440bcd: 도착 칸부터 도착 방향(+8+k)과 이전 비용(+0x14+k)을 거꾸로 따라가 지금 칸의 다음 칸을 찾는다
function nextStep(tables: TerrainTables, range: Uint8Array, x: number, y: number, tx: number, ty: number): Step {
  let cx = tx;
  let cy = ty;
  let k = 0;
  for (let n = 0; n < CELLS; n++) {
    const at = (cy * GRID + cx) * CELL_SIZE;
    const back = (range[at + 8 + k] + 3) % DIRECTIONS;
    k = range[at + 0x14 + k];
    const prev = step(tables, cx, cy, back);
    if (!prev) throw new Error(`경로가 격자 밖으로 나갑니다: (${cx}, ${cy})`);
    if (prev.x === x && prev.y === y) return { x: cx, y: cy, direction: (back + 3) % DIRECTIONS };
    cx = prev.x;
    cy = prev.y;
  }
  throw new Error(`(${tx}, ${ty})에서 (${x}, ${y})로 가는 경로가 끝나지 않습니다`);
}

/** (x, y)에서 이동 범위 버퍼를 따라 (tx, ty)까지 간 칸들 */
export function walkPath(tables: TerrainTables, range: Uint8Array, x: number, y: number, tx: number, ty: number): Step[] {
  const steps: Step[] = [];
  while (x !== tx || y !== ty) {
    const s = nextStep(tables, range, x, y, tx, ty);
    steps.push(s);
    ({ x, y } = s);
  }
  return steps;
}

// vmv2.exe 0x00406c5b(제자리면 그대로) + 걷기 연출
export function moveUnit(tables: TerrainTables, range: Uint8Array, state: GameState, index: number, tx: number, ty: number): GameState {
  const u = unitOf(state, index);
  if (!canStop(range, tx, ty)) throw new Error(`(${tx}, ${ty})는 이동 범위 밖입니다`);
  const steps = walkPath(tables, range, u.x, u.y, tx, ty);
  if (steps.length === 0) return state;
  const direction = steps[steps.length - 1].direction;
  const moved = { ...u, x: tx, y: ty, direction, pose: direction * 3 + (u.pose % 3) };
  return { ...state, units: state.units.map((v, i) => (i === index ? moved : v)) };
}
