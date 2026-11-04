// 지형 표. 지형 종류(부품 +0x62) 17개 × 이동 타입 5개(0 Walk, 1 Walk 2, 2 Swim, 3 Swim 2, 4 Fly — 네이티얼 표 moveType).
// 비용 표 0x473f48: [이동 타입 × 17 + 지형] signed char, 0x7f = 들어갈 수 없음. 멈춤 표 0x473fa0: 같은 칸의 i32, 0이면 그 지형에 멈출 수 없음.
// 육각 격자는 홀수 행이 반 칸 밀린다. 방향 d(0~5 = 서, 북서, 북동, 동, 남동, 남서)의 이웃은
// (x + 0x473ed0[(y & 1) × 6 + d], y + 0x473f00[d]) (vmv2.exe 0x440210, 0x440e21).
import type { ExeImage } from './exeImage.ts';

const COSTS = 0x473f48;
const STOPPABLE = 0x473fa0;
const STEP_X = 0x473ed0;
const STEP_Y = 0x473f00;
export const TERRAIN_KINDS = 17;
export const MOVE_TYPES = 5;
export const FLY = 4;
export const DIRECTIONS = 6;
export const BLOCKED = 0x7f;

export interface TerrainTables {
  /** [이동 타입 × 17 + 지형] 들어가는 비용(signed char). BLOCKED면 못 감 */
  readonly costs: Int8Array;
  /** [이동 타입 × 17 + 지형] 그 지형에 멈출 수 있는지 */
  readonly stoppable: readonly boolean[];
  /** [(y & 1) × 6 + 방향] x 변화 */
  readonly stepX: readonly number[];
  /** [방향] y 변화 */
  readonly stepY: readonly number[];
}

export function readTerrainTables(exe: ExeImage): TerrainTables {
  const n = MOVE_TYPES * TERRAIN_KINDS;
  const i32s = (at: number, count: number) => {
    const v = new DataView(exe.read(at, count * 4).buffer);
    return Array.from({ length: count }, (_, i) => v.getInt32(i * 4, true));
  };
  return {
    costs: new Int8Array(exe.read(COSTS, n)),
    stoppable: i32s(STOPPABLE, n).map((x) => x !== 0),
    stepX: i32s(STEP_X, 2 * DIRECTIONS),
    stepY: i32s(STEP_Y, DIRECTIONS),
  };
}
