// 유닛 메뉴 범위 보기(입력 단계 8~0x14)의 어둡게 할 칸(re/ui-input.md). 원작은 모든 칸을 어둡게(0x43d3a6) 한 뒤 보일 칸만 되돌리고(0x43d3fd),
// 끝에 어두운 칸 위 유닛을 어둡게 한다(0x411849). 이동을 곁들인 범위는 이동 범위의 멈출 칸마다 유닛을 그 칸으로 옮겨(위치 객체) 센다.
import type { Cell } from '../../engine/command.ts';
import { canStop, movementRange, moverOf } from '../../engine/rules/movement.ts';
import { inArea, inRange } from '../../engine/rules/range.ts';
import { cellHeights, GRID, partByte, step, terrainGraph, workGrid } from '../../engine/rules/terrain.ts';
import { type GameState, unitOf } from '../../engine/state.ts';
import type { EngineData } from '../../engine/turn.ts';
import { TERRAIN_KINDS } from '../../formats/terrainTable.ts';
import { isCell } from './hex.ts';
import { type Dim, dimMove } from './overlay.ts';

const SELF = 4; // 범위 종류 4: 자기 칸 둘레
// ponytail: 0x476b88·0x476b18은 bss(처음 0)이고 차례를 넘어 남는다. TS 세션은 차례마다 새로 시작해 처음 값 (0, 0)부터
const ORIGIN = { x: 0, y: 0 };
const NONE = 5; // 범위 종류 5: 범위 보기에서 빼는 마법

type Ground = { readonly map: EngineData['map']; readonly grid: Uint16Array; readonly state: GameState };

/** 단계 8~0x14의 입력(0x476b30 고른 유닛, 0x476b88 look, 0x476b18 aim) */
export interface RangeView {
  readonly phase: number;
  readonly unit: number;
  readonly look: Cell | null;
  readonly aim: Cell | null;
}

/** 유닛의 공격 행동(유닛 +8)과 마법 목록(+0xc, +0x10) */
export interface Acts {
  readonly attack: number;
  readonly spells: readonly number[];
}

/** vmv2.exe 0x004115dc: 행동 +9(사거리)가 0이 아닌 마법이 있는가 */
export const hasRangedSpell = (data: EngineData, acts: Acts): boolean => acts.spells.some((a) => data.actions[a].range !== 0);

class Shade {
  readonly dim = new Uint8Array(GRID * GRID).fill(1); // 0x43d3a6
  show(x: number, y: number): void {
    this.dim[y * GRID + x] = 0; // 0x43d3fd
  }
  visible(x: number, y: number): boolean {
    return this.dim[y * GRID + x] === 0; // 0x43d416
  }
}

const cells = function* () {
  for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) yield [x, y] as const;
};

const at = (state: GameState, unit: number, x: number, y: number): GameState => ({ ...state, units: state.units.map((u, i) => (i === unit ? { ...u!, x, y } : u)) });

/** vmv2.exe 0x00411a79: 유닛이 선 칸에서 행동이 닿는 칸. withArea면 효과 반경(0이면 사거리만, 1이면 칸과 이웃 여섯, 그 밖은 아무것도) */
function reach(data: EngineData, g: Ground, shade: Shade, unit: number, action: number, withArea: boolean): void {
  const act = data.actions[action];
  const u = unitOf(g.state, unit);
  if (act.rangeKind === SELF) {
    if (!withArea) return shade.show(u.x, u.y);
    for (const [x, y] of cells()) if (isCell(g.map, g.grid, x, y) && !shade.visible(x, y) && inArea(g, act, u.x, u.y, x, y)) shade.show(x, y);
    return;
  }
  const radius = withArea ? act.areaRadius : 0;
  if (radius === 0) {
    for (const [x, y] of cells()) if (isCell(g.map, g.grid, x, y) && !shade.visible(x, y) && inRange(g, u.x, u.y, act, x, y)) shade.show(x, y);
  } else if (radius === 1) {
    for (const [x, y] of cells()) {
      if (!isCell(g.map, g.grid, x, y) || !inRange(g, u.x, u.y, act, x, y)) continue;
      if (inArea(g, act, x, y, x, y)) shade.show(x, y);
      for (let d = 0; d < 6; d++) {
        const n = step(data.terrain, x, y, d);
        if (n && isCell(g.map, g.grid, n.x, n.y) && !shade.visible(n.x, n.y) && inArea(g, act, x, y, n.x, n.y)) shade.show(n.x, n.y);
      }
    }
  }
}

// 이동 범위(0x4404c9)의 멈출 칸(0x440ba9)이면서 이동 타입이 멈출 수 있는 지형(0x473fa0)인 칸마다 유닛을 옮긴 땅
function* stops(data: EngineData, g: Ground, unit: number): Generator<readonly [number, number, Ground]> {
  const mover = moverOf(g.state, data.natials, unit);
  const range = movementRange(data.terrain, terrainGraph(data.terrain, g.map, g.grid, mover.moveType), cellHeights(g.map, g.grid), g.state, unit, mover);
  for (const [x, y] of cells()) {
    if (!canStop(range, x, y) || !data.terrain.stoppable[mover.moveType * TERRAIN_KINDS + partByte(g.map, g.grid[y * GRID + x], 0x62)]) continue;
    yield [x, y, { ...g, state: at(g.state, unit, x, y) }];
  }
}

const castable = (data: EngineData, acts: Acts) => acts.spells.filter((a) => data.actions[a].rangeKind !== NONE);

/** vmv2.exe 0x00411e8f: 멈출 칸마다 옮겨서 0x411a79 */
function moveReach(data: EngineData, g: Ground, shade: Shade, unit: number, actions: readonly number[], withArea: boolean): void {
  for (const action of actions) for (const [, , moved] of stops(data, g, unit)) reach(data, moved, shade, unit, action, withArea);
}

/** vmv2.exe 0x004122b2: 이동+마법 범위(0x411ff1) 안에서, 효과 반경 마법의 중심으로 삼으면 look이 효과 범위에 드는 칸 */
function centersFor(data: EngineData, g: Ground, unit: number, spells: readonly number[], look: Cell): Shade {
  const range = new Shade();
  moveReach(data, g, range, unit, spells, false);
  const shade = new Shade();
  for (const action of spells) {
    const act = data.actions[action];
    if (act.areaRadius <= 0) continue;
    for (const [x, y] of cells()) if (range.visible(x, y) && inArea(g, act, x, y, look.x, look.y)) shade.show(x, y);
  }
  return shade;
}

/** 단계 8~0x14의 어둡게 할 칸과 유닛(진입 함수 0x45e244[단계]) */
export function dimRangeView(data: EngineData, state: GameState, v: RangeView, acts: Acts): Dim {
  const g: Ground = { map: data.map, grid: workGrid(data.map, state), state };
  const { unit } = v;
  const { attack } = acts;
  const spells = castable(data, acts);
  let shade = new Shade();
  switch (v.phase) {
    case 8: // 0x4048a7: 단계 2와 같은 이동 범위
      return dimMove(data, state, unit);
    case 9: // 0x411d9f
      reach(data, g, shade, unit, attack, false);
      break;
    case 0xa: // 0x411dc5
      for (const a of spells) reach(data, g, shade, unit, a, false);
      break;
    case 0xb: // 0x411e2a
      for (const a of spells) reach(data, g, shade, unit, a, true);
      break;
    case 0xc: // 0x411fbf
      moveReach(data, g, shade, unit, [attack], false);
      break;
    case 0xd: // 0x411ff1
      moveReach(data, g, shade, unit, spells, false);
      break;
    case 0xe: // 0x412062
      moveReach(data, g, shade, unit, spells, true);
      break;
    case 0xf: // 0x4120d3
      moveReach(data, g, shade, unit, [...spells, attack], true);
      break;
    case 0x10: {
      // 0x412247 → 0x41215b: 선 칸에서 시전해 look을 맞히는 칸
      const u = unitOf(state, unit);
      for (const a of spells) {
        const act = data.actions[a];
        if (act.rangeKind === SELF) shade.show(u.x, u.y);
        else for (const [x, y] of cells()) if (isCell(g.map, g.grid, x, y) && inRange(g, u.x, u.y, act, x, y) && inArea(g, act, x, y, v.look!.x, v.look!.y)) shade.show(x, y);
      }
      break;
    }
    case 0x11: // 0x4125bd → 0x412435: 그 칸에 서면 aim이 사거리 안
      for (const [x, y, moved] of stops(data, g, unit)) if (inRange(moved, x, y, data.actions[attack], v.aim!.x, v.aim!.y)) shade.show(x, y);
      break;
    case 0x12:
    case 0x14: // 0x4051f3
      if (hasRangedSpell(data, acts)) {
        // 0x4125f7
        for (const a of spells) for (const [x, y, moved] of stops(data, g, unit)) if (inRange(moved, x, y, data.actions[a], v.aim!.x, v.aim!.y)) shade.show(x, y);
      } else shade = centersFor(data, g, unit, spells, v.look ?? ORIGIN); // 0xd에서 오면 앞에 남은 0x476b88
      break;
    case 0x13: // 0x4051aa
      shade = centersFor(data, g, unit, spells, v.look ?? ORIGIN);
      break;
    default:
      throw new RangeError(`범위 보기 단계가 아닙니다: ${v.phase}`);
  }
  // vmv2.exe 0x00411849
  return { dimCells: shade.dim, dimUnits: new Set(state.units.flatMap((u, i) => (u && !shade.visible(u.x, u.y) ? [i] : []))) };
}

/** 단계 8~0x14 범위 표식 모양(0x4058b6) */
export const RANGE_MARKS: Readonly<Record<number, number>> = { 8: 1, 9: 2, 0xa: 3, 0xb: 4, 0xc: 5, 0xd: 6, 0xe: 7, 0xf: 8, 0x10: 3, 0x11: 1, 0x12: 1, 0x13: 6, 0x14: 1 };

/** 단계 8~0x14 도움말 문구(0x424fed 인자) */
export function rangeViewText(data: EngineData, v: RangeView, acts: Acts, actor: number): number {
  const ranged = hasRangedSpell(data, acts);
  const own = v.unit === actor;
  switch (v.phase) {
    case 8:
      return 0x45e638;
    case 9:
      return 0x45e77c;
    case 0xa:
      return 0x45e7bc;
    case 0xb:
      return ranged ? 0x45e800 : 0x45e8c4;
    case 0xc:
      return 0x45e910;
    case 0xd:
      return 0x45e9a0;
    case 0xe:
      return ranged ? 0x45ea38 : 0x45eae0;
    case 0xf:
      return 0x45eb78;
    case 0x10:
      return 0x45ebd4;
    case 0x11:
      return own ? 0x45ec14 : 0x45ecb0;
    case 0x13:
      return 0x45ed10;
    default: // 0x12·0x14
      return ranged ? (own ? 0x45edd0 : 0x45ee68) : own ? 0x45eec4 : 0x45ef64;
  }
}
