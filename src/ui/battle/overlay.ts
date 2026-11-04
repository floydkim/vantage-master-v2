// 입력 단계의 화면 표시: 어둡게 할 칸·유닛(범위 밖), 커서, 차례·범위 표식. 원작은 범위를 보일 때 모든 칸을 어둡게(0x43d3a6) 한 뒤
// 범위 안 칸만 되돌리고(0x43d3fd), 고를 수 없는 유닛은 위치 객체 +0xf | 1로 어둡게 한다(re/ui-input.md).
import { canTarget } from '../../engine/rules/action.ts';
import { canStop, movementRange, moverOf } from '../../engine/rules/movement.ts';
import { inArea, inRange } from '../../engine/rules/range.ts';
import { summonCells } from '../../engine/rules/summon.ts';
import { cellHeights, GRID, terrainGraph, workGrid } from '../../engine/rules/terrain.ts';
import type { Cell } from '../../engine/command.ts';
import { type GameState, unitOf } from '../../engine/state.ts';
import type { EngineData } from '../../engine/turn.ts';
import type { GameMap } from '../../formats/mapData.ts';
import { isCell } from './hex.ts';
import { placeSprite, type Sprite } from './sprites.ts';

export interface Dim {
  /** 32 × 32, 1이면 그 칸의 지형 칩을 어두운 판(+0x400)으로 */
  readonly dimCells: Uint8Array | null;
  /** 어둡게 할 유닛 칸(state.units 번호) */
  readonly dimUnits: ReadonlySet<number>;
}

export interface UiOverlay extends Dim {
  /** 커서 칸과 커서 프레임 0~4(0x476ad4). 프레임 < 2면 칸·유닛을 어둡게 깜빡인다 */
  readonly cursor: { readonly x: number; readonly y: number; readonly frame: number } | null;
  /** 차례 표식(0x40574a). remote는 진영 제어 2(네트워크 상대) */
  readonly turnMarker: { readonly unit: number; readonly remote: boolean } | null;
  /** 범위 표식(0x4058b6) */
  readonly rangeMarker: { readonly unit: number; readonly mode: number } | null;
  /** 유닛 메뉴의 가상 배치(0x405a6e): 고른 유닛을 at에 세우고 원래 칸 from에 잔상, at에 선 다른 유닛은 숨김 */
  readonly placed?: { readonly unit: number; readonly from: Cell; readonly at: Cell } | null;
}

export const NO_OVERLAY: UiOverlay = { dimCells: null, dimUnits: new Set(), cursor: null, turnMarker: null, rangeMarker: null };

const ground = (data: EngineData, state: GameState) => ({ map: data.map, grid: workGrid(data.map, state), state });

function cellsBut(keep: (x: number, y: number) => boolean): Uint8Array {
  const dim = new Uint8Array(GRID * GRID).fill(1);
  for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) if (keep(x, y)) dim[y * GRID + x] = 0;
  return dim;
}

const unitsWhere = (state: GameState, dim: (i: number) => boolean): Set<number> =>
  new Set(state.units.flatMap((u, i) => (u && dim(i) ? [i] : [])));

/** 이동 범위(0x4048a7 → 0x4404c9, 멈출 수 있는 칸 0x440ba9) */
export function dimMove(data: EngineData, state: GameState, unit: number): Dim {
  const grid = workGrid(data.map, state);
  const mover = moverOf(state, data.natials, unit);
  const range = movementRange(data.terrain, terrainGraph(data.terrain, data.map, grid, mover.moveType), cellHeights(data.map, grid), state, unit, mover);
  return { dimCells: cellsBut((x, y) => canStop(range, x, y)), dimUnits: new Set() };
}

/** 공격·마법 범위(0x411625): 칸은 사거리(0x41074b), 효과 반경이 0이면 대상이 아닌 유닛(0x410e3d)도 */
export function dimAction(data: EngineData, state: GameState, actor: number, action: number): Dim {
  const g = ground(data, state);
  const act = data.actions[action];
  const self = unitOf(state, actor);
  return {
    dimCells: cellsBut((x, y) => isCell(data.map, g.grid, x, y) && inRange(g, self.x, self.y, act, x, y)),
    dimUnits: act.areaRadius === 0 ? unitsWhere(state, (i) => !canTarget(g, actor, act, i)) : new Set(),
  };
}

/** 소환 칸(0x4127bb) */
export function dimSummon(data: EngineData, state: GameState, actor: number, type: number): Dim {
  const cells = summonCells(data.map, data.terrain, workGrid(data.map, state), data.natials, state, actor, type);
  return { dimCells: cellsBut((x, y) => cells.some((c) => c.x === x && c.y === y)), dimUnits: new Set() };
}

/** 효과 범위(0x41173b, 0x410d77): 중심 칸 둘레 밖의 칸과 유닛 */
export function dimArea(data: EngineData, state: GameState, action: number, center: Cell): Dim {
  const g = ground(data, state);
  const act = data.actions[action];
  const inside = (x: number, y: number) => inArea(g, act, center.x, center.y, x, y);
  return {
    dimCells: cellsBut((x, y) => isCell(data.map, g.grid, x, y) && inside(x, y)),
    dimUnits: unitsWhere(state, (i) => !inside(unitOf(state, i).x, unitOf(state, i).y)),
  };
}

const UI_PAGE = 0x2c6;
const BLANK: Omit<Sprite, 'x' | 'y' | 'chipX' | 'chipY' | 'level' | 'height'> = {
  px: 0, py: 0, lift: 0, key: 0, direction: 0, pose: 0, page: UI_PAGE, set: 0, tint: 0, mask: 0, kind: 0, counter: 0, flags: 0, overlay: 0, overlayFrame: 0,
};
// 범위 표식 자세·묶음·종류(0x4058b6)
const RANGE_LOOKS = [[8, 2, 3], [0, 3, 5], [3, 3, 5], [6, 3, 5], [9, 3, 5], [12, 3, 5], [15, 3, 5], [0, 4, 5], [3, 4, 5]];

/** 표식 표시 객체들: 커서(0x4021ee·0x403c8e), 차례 표식(0x40574a), 범위 표식(0x4058b6). 풀 순서대로 */
export function markerSprites(map: GameMap, grid: Uint16Array, state: GameState, o: UiOverlay): Sprite[] {
  const at = (x: number, y: number) => placeSprite(map, grid, x, y);
  const out: Sprite[] = [];
  if (o.cursor) out.push({ ...BLANK, ...at(o.cursor.x, o.cursor.y), lift: 0xc, pose: 13 + o.cursor.frame, set: 1, flags: 4 }); // 0x4021ee는 6, 켜면 2 비트만 끈다
  if (o.turnMarker) {
    const u = unitOf(state, o.turnMarker.unit);
    const [pose, set, kind] = o.turnMarker.remote ? [6, 4, 4] : [0, 2, 3];
    out.push({ ...BLANK, ...at(u.x, u.y), key: 1, pose, set, kind, flags: 4 });
  }
  if (o.rangeMarker) {
    const u = unitOf(state, o.rangeMarker.unit);
    const [pose, set, kind] = RANGE_LOOKS[o.rangeMarker.mode];
    out.push({ ...BLANK, ...at(u.x, u.y), key: 2, pose, set, kind, flags: 4 });
  }
  return out;
}

/** 표식이 유닛 표시 객체에 주는 변화: 어둡게(+0xf | 1), 차례 표식 유닛은 종류 6·덧그림 끔, 범위 표식 유닛은 덧그림 끔 */
export function markUnit(sprite: Sprite, slot: number, o: UiOverlay): Sprite {
  let s = sprite;
  if (o.dimUnits.has(slot)) s = { ...s, tint: s.tint | 1 };
  if (o.turnMarker?.unit === slot) s = { ...s, kind: 6, flags: s.flags | 8 };
  if (o.rangeMarker?.unit === slot) s = { ...s, flags: s.flags | 8 };
  return s;
}
