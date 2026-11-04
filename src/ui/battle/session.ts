// 전장 입력 단계 기계(re/ui-input.md). 원작 입력 단계 0x476af4와 진입 함수 표 0x45e244, 마우스 처리 0x403d7b·0x403fb0·0x4045ee,
// 메뉴 항목 표 0x45e298을 옮긴다. 좌표는 확대 1 픽셀. 이동은 명령을 낼 때까지 잠정이다(원작도 취소하면 위치 객체를 0x476b90에서 되돌린다).
// 단계 0(연출·CPU 차례)은 다루지 않는다. 단계 8~0x14는 유닛 메뉴의 범위 보기(rangeView.ts).
import { ACT, type Cell, type Command, RETURN, STAND_BY, SUMMON } from '../../engine/command.ts';
import { canTarget } from '../../engine/rules/action.ts';
import { moveUnit } from '../../engine/rules/move.ts';
import { canStop, movementRange, moverOf } from '../../engine/rules/movement.ts';
import { inRange } from '../../engine/rules/range.ts';
import { natialOf, summonCells } from '../../engine/rules/summon.ts';
import { cellHeights, GRID, partByte, terrainGraph, workGrid } from '../../engine/rules/terrain.ts';
import { type GameState, MASTERS, unitOf } from '../../engine/state.ts';
import type { EngineData } from '../../engine/turn.ts';
import { type Descriptions, masterText } from '../../formats/descriptions.ts';
import { TERRAIN_KINDS } from '../../formats/terrainTable.ts';
import { cellAt, directionAt } from './hex.ts';
import { dimAction, dimArea, dimMove, dimSummon, NO_OVERLAY, type UiOverlay } from './overlay.ts';
import { type Acts, dimRangeView, hasRangedSpell, RANGE_MARKS, type RangeView, rangeViewText } from './rangeView.ts';
import { type SkyMotion, skyTick } from './field.ts';
import type { Sky } from './sheet.ts';

export type Phase = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 0xa | 0xb | 0xc | 0xd | 0xe | 0xf | 0x10 | 0x11 | 0x12 | 0x13 | 0x14;

export interface Session {
  readonly phase: Phase;
  /** 차례를 시작한 상태와 차례 유닛 */
  readonly base: GameState;
  readonly actor: number;
  /** 잠정 상태: 차례 유닛이 고른 칸·방향에 선 상태(움직이지 않았으면 base) */
  readonly moved: GameState;
  /** 고른 유닛(0x476b30): 단계 2는 차례 유닛, 단계 7은 오른쪽 클릭한 유닛 */
  readonly selected: number | null;
  /** 고른 행동 번호 또는 네이티얼 종류(0x476ae8) */
  readonly action: number | null;
  /** 효과 범위 중심(0x476af8) */
  readonly center: Cell | null;
  /** 범위 보기에서 누른 칸: 0x10·0x13·(마법 없이) 0x14가 보는 칸(0x476b88), 0x11·0x12·0x14가 겨누는 칸(0x476b18) */
  readonly look: Cell | null;
  readonly aim: Cell | null;
  /** 걷기를 시작한 단계(0x476b10): 이동을 취소하면 돌아간다 */
  readonly moveFrom: Phase;
  /** 단계 8에서 누른 칸에 고른 유닛을 가상으로 세움(0x405a6e, 원래 칸이면 null). 단계 7 오른쪽 누름(0x405bb2)까지 범위 보기가 그 자리에서 센다 */
  readonly placed: Cell | null;
  /** 커서 칸(0x476b78, 칸이 아니면 null)과 켬(0x476bac) */
  readonly cursor: Cell | null;
  readonly cursorOn: boolean;
  /** 단계 3에서 누른 채 끌면 방향을 바꾼다(0x476bb8: 누르면 1, 단계가 바뀌면 0) */
  readonly pressed: boolean;
}

export interface Step {
  readonly session: Session;
  readonly command?: Command;
  /** MP가 모자라 고를 수 없음(0x419baa) */
  readonly alert?: 'mp';
  /** 되돌리기 확인 창(대화 상자 0x74)을 띄운다 */
  readonly confirm?: 'destruction';
  /** 효과음 번호(0x443d19, sound.ts) */
  readonly sounds?: readonly number[];
}

const ground = (data: EngineData, state: GameState) => ({ map: data.map, grid: workGrid(data.map, state), state });
const unitAtCell = (state: GameState, c: Cell | null) => (c ? state.units.findIndex((u) => u && u.x === c.x && u.y === c.y) : -1);

// vmv2.exe 0x0040484b: 단계를 바꾸며 진입 함수가 커서를 켜고 끈다(0x403b10). 단계 3은 커서 칸을 차례 유닛 칸으로(0x403c8e)
function enter(s: Session, phase: Phase, patch: Partial<Session> = {}): Session {
  const next = { ...s, ...patch, phase, pressed: false };
  if (phase === 3) {
    const u = unitOf(next.moved, next.actor);
    return { ...next, cursor: { x: u.x, y: u.y }, cursorOn: false };
  }
  return { ...next, cursorOn: phase !== 7 };
}

/** 사람 차례의 입력 시작(0x40546d → 0x4055cf → 단계 1). 커서 칸은 차례 진행(0x40536c → 0x403c8e)이 차례 유닛 칸으로 둔다 */
export function startInput(turn: { readonly state: GameState; readonly actor: number }): Session {
  const u = unitOf(turn.state, turn.actor);
  return {
    phase: 1, base: turn.state, actor: turn.actor, moved: turn.state, selected: null, action: null, center: null, look: null, aim: null, moveFrom: 2, placed: null,
    cursor: { x: u.x, y: u.y }, cursorOn: true, pressed: false,
  };
}

const rangeOf = (data: EngineData, state: GameState, unit: number) => {
  const grid = workGrid(data.map, state);
  const mover = moverOf(state, data.natials, unit);
  return movementRange(data.terrain, terrainGraph(data.terrain, data.map, grid, mover.moveType), cellHeights(data.map, grid), state, unit, mover);
};

function turnTo(state: GameState, unit: number, direction: number): GameState {
  const u = unitOf(state, unit);
  return { ...state, units: state.units.map((v, i) => (i === unit ? { ...u, direction, pose: direction * 3 + (u.pose % 3) } : v)) }; // 0x417957
}

/** 마우스 이동(0x403d7b): 커서 칸, 단계 3에서 누른 채면 차례 유닛 방향. 커서 칸이 바뀌면 부르는 쪽이 커서 프레임을 0으로 */
export function pointer(data: EngineData, s: Session, px: number, py: number, held: boolean): Session {
  const grid = workGrid(data.map, s.moved);
  const next = { ...s, cursor: cellAt(data.map, grid, px, py) };
  if (s.phase === 3 && held && s.pressed) {
    const u = unitOf(s.moved, s.actor);
    return { ...next, moved: turnTo(s.moved, s.actor, directionAt(data.map, grid, px, py, u.x, u.y)) };
  }
  return next;
}

function command(s: Session, kind: number, number: number, target: Cell): Command {
  const u = unitOf(s.moved, s.actor);
  return { to: { x: u.x, y: u.y }, direction: u.direction, kind, number, target };
}

/** vmv2.exe 0x00403d04(WM_SETCURSOR): 단계 3이면 마우스 쪽 방향 0~5(0x4033ee, 차례 유닛이 선 자리), 단계 6이면 'target', 그 밖은 null(화살표) */
export function cursorShape(data: EngineData, s: Session, px: number, py: number): number | 'target' | null {
  if (s.phase === 6) return 'target';
  if (s.phase !== 3) return null;
  const u = unitOf(s.moved, s.actor);
  return directionAt(data.map, workGrid(data.map, s.moved), px, py, u.x, u.y);
}

/** 왼쪽 누름(0x403fb0) */
export function press(data: EngineData, s: Session, px: number, py: number): Step {
  const grid = workGrid(data.map, s.moved);
  const cell = cellAt(data.map, grid, px, py);
  const pressed = { ...s, pressed: true };
  switch (s.phase) {
    case 1: {
      // 차례 유닛을 누르면 이동 범위(진영 제어 2 = 네트워크 상대는 아님)
      const side = unitOf(s.base, s.actor).side;
      if (s.base.sideStates[side].controller !== 2 && unitAtCell(s.base, cell) === s.actor) return { session: enter(s, 2, { selected: s.actor }), sounds: [4] };
      return { session: pressed };
    }
    case 2: {
      if (!cell || s.selected !== s.actor) return { session: pressed };
      const range = rangeOf(data, s.base, s.actor);
      if (!canStop(range, cell.x, cell.y)) return { session: pressed };
      return { session: enter(s, 3, { moved: moveUnit(data.terrain, range, s.base, s.actor, cell.x, cell.y), moveFrom: 2 }), sounds: [4] };
    }
    case 3: {
      // 누른 곳 쪽으로 차례 유닛이 돈다(0x4033ee → 0x417957)
      const u = unitOf(s.moved, s.actor);
      return { session: { ...pressed, moved: turnTo(s.moved, s.actor, directionAt(data.map, grid, px, py, u.x, u.y)) }, sounds: [0] };
    }
    case 4: {
      const act = data.actions[s.action!];
      const g = ground(data, s.moved);
      if (act.areaRadius === 0) {
        const target = unitAtCell(s.moved, cell);
        if (target >= 0 && canTarget(g, s.actor, act, target)) return { session: pressed, command: command(s, ACT, s.action!, cell!), sounds: [1] };
        return { session: pressed };
      }
      const u = unitOf(s.moved, s.actor);
      if (cell && inRange(g, u.x, u.y, act, cell.x, cell.y)) return { session: enter(s, 6, { center: cell }), sounds: [4] };
      return { session: pressed };
    }
    case 5: {
      const cells = summonCells(data.map, data.terrain, grid, data.natials, s.moved, s.actor, s.action!);
      if (cell && cells.some((c) => c.x === cell.x && c.y === cell.y)) return { session: pressed, command: command(s, SUMMON, s.action!, cell), sounds: [1] };
      return { session: pressed };
    }
    case 6:
      return { session: pressed, command: command(s, ACT, s.action!, s.center!), sounds: [1] };
    case 7:
    case 9:
    case 0xa:
    case 0xf:
    case 0x10:
      return { session: pressed };
    case 8: {
      // 0x405bb2 → 0x405a6e: 아무 칸이나 고른 유닛을 그 칸에 가상으로 세우고 단계 7
      if (!cell) return { session: pressed };
      const home = unitOf(s.base, s.selected!);
      return { session: enter(s, 7, { placed: cell.x === home.x && cell.y === home.y ? null : cell }), sounds: [4] };
    }
  }
  // 범위 보기에서 보이는 칸(0x43d416)을 누르면
  if (!cell || overlayOf(data, s, 0).dimCells![cell.y * GRID + cell.x]) return { session: pressed };
  const ranged = hasRangedSpell(data, actionsOf(data, s.base, s.selected!));
  switch (s.phase) {
    case 0xb:
      return ranged ? { session: enter(s, 0x10, { look: cell }), sounds: [4] } : { session: pressed };
    case 0xc:
      return { session: enter(s, 0x11, { aim: cell }), sounds: [4] };
    case 0xd:
      return { session: enter(s, 0x12, { aim: cell }), sounds: [4] };
    case 0xe:
      return { session: enter(s, ranged ? 0x13 : 0x14, { look: cell }), sounds: [4] };
    case 0x13:
      return { session: enter(s, 0x14, { aim: cell }), sounds: [4] };
    default: {
      // 0x11·0x12·0x14: 차례 유닛을 보고 있고, 사람이고, 가상 배치가 없으면(0x476b08) 그 칸으로 걷는다(0x406c5b → 0x405fba)
      const side = unitOf(s.base, s.actor).side;
      if (s.selected !== s.actor || s.base.sideStates[side].controller !== 0 || s.placed) return { session: pressed };
      const range = rangeOf(data, s.base, s.actor);
      return { session: enter(s, 3, { moved: moveUnit(data.terrain, range, s.base, s.actor, cell.x, cell.y), moveFrom: s.phase }), sounds: [4] };
    }
  }
}

/** 오른쪽 누름(0x4045ee) */
export function pressRight(data: EngineData, s: Session, px: number, py: number): Step {
  switch (s.phase) {
    case 1: {
      const unit = unitAtCell(s.base, cellAt(data.map, workGrid(data.map, s.base), px, py));
      return unit >= 0 ? { session: enter(s, 7, { selected: unit }), sounds: [4] } : { session: s };
    }
    case 2:
      return { session: enter(s, 1, { selected: null }), sounds: [2] };
    case 3:
      return cancelMove(s);
    case 4:
    case 5:
      return { session: enter(s, 3), sounds: [2] };
    case 6:
      return { session: enter(s, data.actions[s.action!].rangeKind === 4 ? 3 : 4), sounds: [2] };
    case 7:
      return { session: enter(s, 1, { selected: null, placed: null }), sounds: [2, 2] }; // 0x405e1d(효과음 2, 0x405bb2)
    case 0x10:
    case 0x11:
    case 0x12:
    case 0x13:
      return { session: enter(s, BACK[s.phase]!), sounds: [2] };
    case 0x14:
      return { session: enter(s, hasRangedSpell(data, actionsOf(data, s.base, s.selected!)) ? 0x13 : 0xe), sounds: [2] };
    default: // 8~0xf
      return { session: enter(s, 7), sounds: [2] };
  }
}

const BACK: Partial<Record<Phase, Phase>> = { 0x10: 0xb, 0x11: 0xc, 0x12: 0xd, 0x13: 0xe };
// 유닛 메뉴 항목(0x45e298[5~13]) → 범위 보기 단계. 4(Detail Info, 대화 상자 0x7f·0x80)는 BattleWindow
const VIEWS: Partial<Record<number, Phase>> = { 0: 8, 1: 9, 2: 0xa, 3: 0xb, 5: 0xf, 6: 0xc, 7: 0xd, 8: 0xe };

// vmv2.exe 0x00405c74: 이동 취소(효과음 2). 위치·방향을 되돌리고 걷기를 시작한 단계(0x476b10)
const cancelMove = (s: Session): Step => ({ session: enter(s, s.moveFrom, { moved: s.base }), sounds: [2] });

const moveTypeAt = (data: EngineData, state: GameState, unit: number) => {
  const u = unitOf(state, unit);
  const kind = partByte(data.map, workGrid(data.map, state)[u.y * GRID + u.x], 0x62);
  return data.terrain.stoppable[moverOf(state, data.natials, unit).moveType * TERRAIN_KINDS + kind];
};

/** 차례 유닛의 공격 행동과 마법 목록(유닛 +0x08, +0x0c 목록) */
export function actionsOf(data: EngineData, state: GameState, unit: number): Acts {
  const u = unitOf(state, unit);
  if (unit < MASTERS) return { attack: state.sides[u.side].attackAction, spells: state.sides[u.side].spells };
  const n = natialOf(data.natials, u.type);
  return { attack: n.attackAction, spells: n.magicAction ? [n.magicAction] : [] };
}

// vmv2.exe 0x00410f40: 범위 종류 5이거나 효과 반경이 있거나 대상이 될 유닛이 있다
function usable(data: EngineData, state: GameState, actor: number, action: number): boolean {
  const act = data.actions[action];
  if (act.rangeKind === 5 || act.areaRadius !== 0) return true;
  const g = ground(data, state);
  return state.units.some((u, i) => u !== null && canTarget(g, actor, act, i));
}

/** 명령 메뉴 켬 [대기, 공격, 마법, 소환] (vmv2.exe 0x0040496f) */
export function menuEnabled(data: EngineData, s: Session): boolean[] {
  const stop = moveTypeAt(data, s.moved, s.actor);
  const { attack, spells } = actionsOf(data, s.moved, s.actor);
  const side = unitOf(s.moved, s.actor).side;
  return [
    true,
    stop && usable(data, s.moved, s.actor, attack),
    stop && spells.some((a) => usable(data, s.moved, s.actor, a)),
    stop && s.actor < MASTERS && s.moved.sideStates[side].unitCount <= 24,
  ];
}

/** 유닛 메뉴(단계 7) 켬 10칸: 범위 보기 8칸과 정보·되돌리기 (vmv2.exe 0x00404c02) */
export function unitMenuEnabled(data: EngineData, s: Session): boolean[] {
  const sel = s.selected!;
  const acts = actionsOf(data, s.base, sel);
  const magic = hasRangedSpell(data, acts);
  const area = acts.spells.some((a) => data.actions[a].areaRadius !== 0);
  const u = unitOf(s.base, sel);
  const side = unitOf(s.base, s.actor).side;
  const destruction = u.side === side && s.base.sideStates[side].controller === 0 && sel >= MASTERS && s.actor < MASTERS;
  return [true, true, magic, area, true, true, true, magic, area, destruction];
}

/** 명령 메뉴 항목(0x405c4f → 0x45e298[항목]). 마법·소환은 하위 메뉴에서 고른 번호 */
export function chooseMenu(data: EngineData, s: Session, item: number, number = 0): Step {
  if (s.phase !== 3 || (item !== 0 && !menuEnabled(data, s)[item - 1])) return { session: s };
  const u = unitOf(s.moved, s.actor);
  const { attack, spells } = actionsOf(data, s.moved, s.actor);
  const mp = s.moved.sideStates[u.side].mp;
  switch (item) {
    case 0:
      return cancelMove(s);
    case 1: // 0x405ce3
      return { session: s, command: command(s, STAND_BY, 0, { x: u.x, y: u.y }), sounds: [1] };
    case 2:
    case 3: {
      // 0x405cfe·0x405d18(효과음 1). 마법은 마스터면 하위 메뉴에서 고른 번호, 네이티얼은 자기 마법(0x41a528)
      const action = item === 2 ? attack : s.actor < MASTERS ? number : spells[0];
      if (item === 3 && !spells.includes(action)) throw new RangeError(`유닛의 마법 목록에 없는 행동입니다: ${action}`);
      const act = data.actions[action];
      if (mp < act.mpCost) return { session: s, alert: 'mp', sounds: [1] };
      if (act.rangeKind === 4) return { session: enter(s, 6, { action, center: { x: u.x, y: u.y } }), sounds: [1] };
      if (act.rangeKind === 5) return { session: s, command: command(s, ACT, action, { x: u.x, y: u.y }), sounds: [1] };
      return { session: enter(s, 4, { action }), sounds: [1] };
    }
    case 4: // 0x405dcc(효과음 1)
      if (!s.moved.sides[u.side].natials.includes(number)) throw new RangeError(`진영이 소환할 수 없는 네이티얼입니다: ${number}`);
      if (mp < natialOf(data.natials, number).summonMp) return { session: s, alert: 'mp', sounds: [1] };
      return { session: enter(s, 5, { action: number }), sounds: [1] };
    default:
      throw new RangeError(`명령 메뉴 항목 ${item}`);
  }
}

/** vmv2.exe 0x00406cd2(0, 0): 생각 시간을 다 씀(0x407926) → 차례 유닛 칸에서 Stand by. 효과음은 타이머 쪽(13) */
export function timeUp(s: Session): Step {
  const u = unitOf(s.moved, s.actor);
  return { session: s, command: command(s, STAND_BY, 0, { x: u.x, y: u.y }) };
}

/** 유닛 메뉴 항목(단계 7, 0x41a9e5): 0~3·5~8 범위 보기(0x405e4b~0x405efa), 9 되돌리기 확인. 4(Detail Info)는 BattleWindow의 정보 대화 상자(0x405f5a) */
export function chooseUnitMenu(data: EngineData, s: Session, item: number): Step {
  if (s.phase !== 7 || !unitMenuEnabled(data, s)[item]) return { session: s };
  if (item === 9) return { session: s, confirm: 'destruction', sounds: [1] };
  const view = VIEWS[item];
  return view ? { session: enter(s, view), sounds: [1] } : { session: s };
}

/** 되돌리기 확인 창에서 예(0x405f13): 고른 네이티얼 칸으로 되돌리기 명령 */
export function confirmDestruction(data: EngineData, s: Session): Step {
  if (s.phase !== 7 || !unitMenuEnabled(data, s)[9]) throw new RangeError('되돌리기를 고를 수 있는 유닛 메뉴가 아닙니다');
  const t = unitOf(s.base, s.selected!);
  return { session: s, command: command({ ...s, moved: s.base }, RETURN, 0, { x: t.x, y: t.y }), sounds: [1] }; // 0x405f13
}

/** 지금 단계의 화면 표시 */
export function overlayOf(data: EngineData, s: Session, cursorFrame: number): UiOverlay {
  const cursor = s.cursorOn && s.cursor ? { ...s.cursor, frame: cursorFrame } : null;
  const remote = s.base.sideStates[unitOf(s.base, s.actor).side].controller === 2;
  const base = { ...NO_OVERLAY, cursor };
  switch (s.phase) {
    case 1:
      return { ...base, turnMarker: { unit: s.actor, remote } };
    case 2:
      return { ...base, ...dimMove(data, s.base, s.selected!), rangeMarker: { unit: s.selected!, mode: 1 } };
    case 3:
      return base;
    case 4:
      return { ...base, ...dimAction(data, s.moved, s.actor, s.action!) };
    case 5:
      return { ...base, ...dimSummon(data, s.moved, s.actor, s.action!) };
    case 6:
      return { ...base, ...dimArea(data, s.moved, s.action!, s.center!) };
    case 7:
      return { ...base, turnMarker: s.selected === s.actor ? null : { unit: s.actor, remote }, rangeMarker: { unit: s.selected!, mode: 0 }, placed: placedOf(s) };
    default:
      return {
        ...base,
        ...dimRangeView(data, drawnState(s), rangeView(s), actionsOf(data, s.base, s.selected!)),
        turnMarker: s.selected === s.actor ? null : { unit: s.actor, remote }, // 단계 7(0x404c02)이 지운 차례 표식은 범위 보기에서 다시 생기지 않는다
        rangeMarker: { unit: s.selected!, mode: RANGE_MARKS[s.phase] },
        placed: placedOf(s),
      };
  }
}

const placedOf = (s: Session): UiOverlay['placed'] => {
  if (!s.placed) return null;
  const u = unitOf(s.base, s.selected!);
  return { unit: s.selected!, from: { x: u.x, y: u.y }, at: s.placed };
};

/** 그릴 상태: 가상 배치가 있으면 고른 유닛을 그 칸에(위치 객체만 옮긴 원작처럼) */
export function drawnState(s: Session): GameState {
  if (!s.placed) return s.moved;
  const { x, y } = s.placed;
  return { ...s.moved, units: s.moved.units.map((u, i) => (i === s.selected ? { ...u!, x, y } : u)) };
}

const rangeView = (s: Session): RangeView => ({ phase: s.phase, unit: s.selected!, look: s.look, aim: s.aim });

/** 화면에 그릴 상태(잠정 이동 포함) */
export const shownState = (s: Session): GameState => s.moved;

// 상태 줄 문구(exe 주소, 0x424fed)
const STATUS: Partial<Record<Phase, number>> = { 2: 0x45e600, 3: 0x45e574, 5: 0x45e700, 6: 0x45e744 };

/** 단계에 들어갈 때 상태 줄에 쓰는 문구의 exe 주소(없으면 null) */
export function statusOf(data: EngineData, s: Session): number | null {
  if (s.phase === 4) return data.actions[s.action!].areaRadius === 0 ? 0x45e678 : 0x45e6bc;
  if (s.phase >= 8) return rangeViewText(data, rangeView(s), actionsOf(data, s.base, s.selected!), s.actor);
  return STATUS[s.phase] ?? null;
}

// vmv2.exe 0x00424ed3: 마스터 0x4622d0[번호](시나리오의 진영 1은 MAS 글), 네이티얼 0x46226c[종류]
function unitText(texts: Descriptions, state: GameState, unit: number): string {
  const u = unitOf(state, unit);
  return unit < MASTERS ? masterText(texts, u.side, u.type) : texts.natials[u.type];
}

/** 단계 1의 상태 줄(vmv2.exe 0x00403bde): 커서 칸이 없으면 빈 줄, 유닛이 있으면 종류 설명(0x424ed3: 마스터는 마스터 번호, 네이티얼은 종류),
 *  아니면 지형 설명(0x424eb6). 원작은 단계 1에서 커서 칸이 바뀔 때(0x403d7b)와 사람 입력 시작(0x4055cf)에 부른다. 단계 7은 고른 유닛 설명(0x404c02), 그 밖은 null */
export function cursorStatus(data: EngineData, texts: Descriptions, s: Session): string | null {
  if (s.phase === 7) return unitText(texts, s.base, s.selected!); // 단계 7 진입 0x404c02 → 0x424ed3
  if (s.phase !== 1) return null;
  if (!s.cursor) return '';
  const unit = unitAtCell(s.base, s.cursor);
  if (unit >= 0) return unitText(texts, s.base, unit);
  return texts.terrain[partByte(data.map, workGrid(data.map, s.base)[s.cursor.y * GRID + s.cursor.x], 0x62)];
}
