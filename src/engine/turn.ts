// 차례 실행. vmv2.exe 받는 쪽 명령 실행(0x40672d → 이동 0x406c5b → 0x4067b1 → 0x406d13 → 연출 → 0x405fd7·0x406045·0x4060b9)과
// 행동 뒤 흐름(0x40623b, 승패 0x40612c·0x401ec3), 차례 시작(0x40536c + 입력 대기 처리기 0x40546d의 지형 효과).
import type { Action } from '../formats/actionTable.ts';
import { type Hit, NATIAL_SCRIPT_BASE } from '../formats/effectScript.ts';
import type { GameMap } from '../formats/mapData.ts';
import type { NatialType } from '../formats/natialTable.ts';
import { TERRAIN_KINDS, type TerrainTables } from '../formats/terrainTable.ts';
import { ACT, type Cell, type Command, RETURN, STAND_BY, SUMMON } from './command.ts';
import { cdiv } from './rules/cint.ts';
import { actionTargets, ringCells } from './rules/action.ts';
import { addExp, cappedExp, type CombatTables, damage, damageExp, fighterOf, statusExp, statusMinutesOf } from './rules/combat.ts';
import { lightPhase } from './rules/light.ts';
import { moveUnit } from './rules/move.ts';
import { canStop, movementRange, moverOf } from './rules/movement.ts';
import { type OaTables, oaCost } from './rules/oaCost.ts';
import { type Ground, inArea } from './rules/range.ts';
import { canCapture, captureStone } from './rules/stones.ts';
import { natialOf, summonCells, summonNatial } from './rules/summon.ts';
import { cellHeights, GRID, partByte, terrainGraph, workGrid } from './rules/terrain.ts';
import { applyWaterLevel } from './rules/time.ts';
import { beginTurn, type TurnStep, nextActor, removeDead } from './rules/turn.ts';
import {
  type GameState,
  MASTERS,
  type SideState,
  STAT_ATTACK,
  STAT_NATIAL_EXP,
  STAT_STAND_BY,
  STAT_SUMMONS,
  STAT_USED_MP,
  type UnitRecord,
  unitOf,
} from './state.ts';

const MAX_HP = 10;
const TERRAIN_HURTS = 5; // 지형 종류 5: 차례 시작에 HP −3
const STONE_PART = 0x80;
const FALLEN_DIRECTION = 4;
const SUMMON_ACTION = 1; // 소환 뒤 OA는 행동 1의 비용(0x4060b9)
const SIDE_UNIT_LIMIT = 25; // 진영 유닛 수(마스터 포함)가 이만큼이면 소환 메뉴가 꺼진다(0x40496f)
// 행동 종류(행동 표 +0x06)
const STATUS = 2;
const CURE = 3;
const WATER = 4;
const BLESS = 5;
const STATUS_MASK = 7;
const STATUS_BITS = [1, 2, 4]; // 상태 이상 세부(+0x07) 0·1·2
export const SELF_RANGE = 5; // 행동 범위 종류 5: 자기 칸(받은 명령은 주체 칸으로, 0x4067b1)
/** 두 마스터가 함께 쓰러짐(0x401ec3의 0x476b3c = −1) */
export const DRAW = -1;

export interface EngineData {
  readonly map: GameMap;
  readonly natials: readonly NatialType[];
  readonly lightBonus: readonly (readonly number[])[];
  readonly oa: OaTables;
  readonly terrain: TerrainTables;
  readonly combat: CombatTables;
  readonly actions: readonly Action[];
  /** DATA12 연출 스크립트 항목의 타격 목록(공격은 유닛 +0x07 번, 마법은 actionScripts) */
  readonly scriptHits: (script: number) => readonly Hit[];
  /** 행동마다 마법 연출 스크립트의 DATA12 항목(readActionScripts) */
  readonly actionScripts: readonly (number | null)[];
}

/** 다음 차례를 받은 유닛(state.units 번호), 또는 전투가 끝났으면 이긴 진영(0·1, DRAW) */
export type TurnResult = { readonly state: GameState; readonly actor: number } | { readonly state: GameState; readonly winner: number };

/** 규칙에 어긋나는 명령(원작 UI가 막는 입력). apply가 { ok: false, reason }으로 돌려준다 */
export class RuleViolation extends Error {}

const withUnit = (state: GameState, index: number, change: Partial<UnitRecord>): GameState => {
  const u = unitOf(state, index);
  return { ...state, units: state.units.map((v, i) => (i === index ? { ...u, ...change } : v)) };
};

const addStat = (state: GameState, side: number, slot: number, amount: number): GameState => ({
  ...state,
  stats: state.stats.map((list, n) => (n === side ? list.map((x, k) => (k === slot ? x + amount : x)) : list)) as [number[], number[]],
});

// vmv2.exe 0x00407190
const spendMp = (state: GameState, side: number, amount: number): GameState => {
  const spend = (st: SideState, n: number): SideState => (n === side ? { ...st, mp: st.mp - amount } : st);
  return { ...state, sideStates: [spend(state.sideStates[0], 0), spend(state.sideStates[1], 1)] };
};

const hurt = (hp: number, amount: number) => Math.min(Math.max(hp - amount, 0), MAX_HP); // 0x403a62

// vmv2.exe 0x00417957
const setDirection = (state: GameState, index: number, direction: number) =>
  withUnit(state, index, { direction, pose: direction * 3 + (unitOf(state, index).pose % 3) });

// vmv2.exe 0x0041798c: 대상 칸 쪽으로 돈다
export function facing(direction: number, x: number, y: number, tx: number, ty: number): number {
  const dy = ty - y;
  const dx = (ty & 1) + tx * 2 - ((y & 1) + x * 2);
  const turns = [1, 4, 3, 2, 5, 0];
  let d = direction;
  for (let k = 0; k < 6; k++) {
    const away =
      (d !== 0 || dy * -3 < dx || dy * 3 < dx) &&
      (d !== 1 || dx < dy * 3 || 0 < dx) &&
      (d !== 2 || dx < 0 || dy * -3 < dx) &&
      (d !== 3 || dx < dy * -3 || dx < dy * 3) &&
      (d !== 4 || dy * 3 < dx || dx < 0) &&
      (d !== 5 || 0 < dx || dx < dy * -3);
    if (!away) break;
    d = (d + turns[k]) % 6;
  }
  return d;
}

const groundOf = (data: EngineData, state: GameState): Ground => ({ map: data.map, grid: workGrid(data.map, state), state });

// vmv2.exe 0x00414939의 타격 명령마다 맞는 순간(0x0040354b). 지정 칸 기준 효과 범위(0x410d77) 안의 칸에 유닛이 있을 때만:
// 상태 이상(종류 2)은 새 지속 시간이 남은 분보다 작으면 무시, 아니면 비트와 남은 분을 바꾼다. 풀기(종류 3)는 지운다. 그 밖(데미지·회복)은
// 몫 누적(+0x5c)이 0일 때 새로 계산(경험치 포함)하고, 몫 타격(0x2d)만 계산한 데미지·HP를 기억해(+0x60·+0x64) 나머지 타격(0x2c)이
// 그 HP로 되돌린 뒤 전부 뺀다. 둘레(0x2e·0x2f, 거리 ≤ 효과 반경)와 투사체는 그 칸에 새로 계산한 전부. 0x2b는 물높이 단계(0x42562e)·Bless(0x412d32)
/** 타격(0x40354b) 한 번의 결과: 칸, 맞은 유닛(효과 범위 밖·유닛 없음이면 null, 그때 나머지는 0), 맞은 뒤 HP·상태 이상,
 *  데미지 숫자(0x412c14)에 쓰는 전체 데미지(몫 타격도 나누기 전 값, 회복은 음수, 상태 이상·풀기는 0) */
export interface StrikeRecord {
  readonly x: number;
  readonly y: number;
  readonly unit: number | null;
  readonly hp: number;
  readonly status: number;
  readonly damage: number;
  /** 특수 타격(스크립트 0x2b, 0x403aaa)이면 바뀐 상태 필드: 물높이 단계·남은 분(물높이는 명령 실행 때 이미 바뀜), Bless 뒤 유닛 */
  readonly special?: Partial<Pick<GameState, 'waterLevel' | 'waterStage' | 'waterMinutes' | 'units'>>;
}

function strike(data: EngineData, state: GameState, actor: number, act: Action, target: Cell, hits: readonly (Hit | { kind: 'fresh' })[], trace?: StrikeRecord[]): { state: GameState; exp: number } {
  let s = state;
  let exp = 0;
  let dealt = 0;
  let saved = 0;
  let given = 0;
  const light = lightPhase(s.timeOfDay, data.map.header);
  const ground = groundOf(data, s);
  const at = (x: number, y: number, fresh: boolean, tenths: number | null) => {
    const index = inArea({ ...ground, state: s }, act, target.x, target.y, x, y) ? s.units.findIndex((u) => u && u.x === x && u.y === y) : -1;
    if (index < 0) {
      trace?.push({ x, y, unit: null, hp: 0, status: 0, damage: 0 });
      return;
    }
    const damage = land(index, fresh, tenths);
    const u = unitOf(s, index);
    trace?.push({ x, y, unit: index, hp: u.hp, status: u.status, damage });
  };
  const land = (index: number, fresh: boolean, tenths: number | null): number => {
    const u = unitOf(s, index);
    const a = fighterOf(s, data.natials, data.lightBonus, light, actor);
    const t = fighterOf(s, data.natials, data.lightBonus, light, index);
    if (act.kind === STATUS) {
      const minutes = statusMinutesOf(data.combat, a, act);
      if (minutes < u.statusMinutes) return 0;
      exp += statusExp(data.combat, a, t, minutes);
      s = withUnit(s, index, { status: (u.status & ~STATUS_MASK) | (STATUS_BITS[act.sub] ?? 0), statusMinutes: minutes });
      return 0;
    }
    if (act.kind === CURE) {
      exp += statusExp(data.combat, a, t, 0);
      s = withUnit(s, index, { status: u.status & ~STATUS_MASK, statusMinutes: 0 });
      return 0;
    }
    let d = dealt;
    let hp = saved;
    if (fresh) {
      d = damage(data.combat, data.map, ground.grid, a, act, target.x, target.y, t);
      exp += damageExp(data.combat, a, t, d);
      hp = u.hp;
      if (tenths !== null) [dealt, saved] = [d, hp];
    }
    s = withUnit(s, index, { hp: tenths === null ? hurt(hp, d) : hurt(u.hp, cdiv(d * tenths + 5, 10)) });
    return d;
  };
  for (const hit of hits) {
    if (hit.kind === 'rest') at(target.x, target.y, given === 0, null);
    else if (hit.kind === 'part') {
      at(target.x, target.y, given === 0, hit.tenths);
      given += hit.tenths;
    } else if (hit.kind === 'ring') {
      if (hit.distance <= act.areaRadius) for (const c of ringCells(data.terrain, target.x, target.y, hit.distance)) at(c.x, c.y, true, null);
    } else if (hit.kind === 'fresh') at(target.x, target.y, true, null);
    else if (act.kind === WATER) {
      s = { ...s, ...applyWaterLevel(s.waterLevel) };
      trace?.push({ ...target, unit: null, hp: 0, status: 0, damage: 0, special: { waterLevel: s.waterLevel, waterStage: s.waterStage, waterMinutes: s.waterMinutes } });
    } else if (act.kind === BLESS) {
      const side = unitOf(s, actor).side;
      s.units.forEach((u, i) => {
        if (u && i >= MASTERS && u.side === side) s = withUnit(s, i, { hp: hurt(u.hp, -1) });
      });
      trace?.push({ ...target, unit: null, hp: 0, status: 0, damage: 0, special: { units: s.units } });
    }
  }
  return { state: s, exp };
}

/** 대상 칸 쪽으로 돌고 자세를 행동 프레임으로(공격 0x413852, 마법 0x4141fd·0x414397, 소환 0x414397) */
function face(state: GameState, index: number, tx: number, ty: number): GameState {
  const u = unitOf(state, index);
  const direction = facing(u.direction, u.x, u.y, tx, ty);
  return withUnit(state, index, { direction, pose: direction * 3 + 1 });
}

/** 유닛 속도(+0x44): 네이티얼은 종류·레벨, 마스터는 진영 레코드 */
function speedOf(data: EngineData, state: GameState, index: number): number {
  const u = unitOf(state, index);
  return index < MASTERS ? state.sides[u.side].speed : natialOf(data.natials, u.type).speed[u.level];
}

// vmv2.exe 0x0040546d 앞부분: 차례를 받은 유닛이 선 칸에 따라 HP가 바뀐다. 쓰러지면 true
function turnStartEffect(data: EngineData, state: GameState, actor: number): { state: GameState; died: boolean } {
  const u = unitOf(state, actor);
  const id = workGrid(data.map, state)[u.y * GRID + u.x];
  const kind = partByte(data.map, id, 0x62);
  let amount = kind === TERRAIN_HURTS ? 3 : 0;
  if (partByte(data.map, id, 0x63) & STONE_PART) amount--;
  if (!data.terrain.stoppable[moverOf(state, data.natials, actor).moveType * 17 + kind]) amount += 3;
  const hp = hurt(u.hp, amount);
  return { state: { ...withUnit(state, actor, { hp }), turnStarted: 1 }, died: hp === 0 };
}

/**
 * 차례 시작: 차례 진행(0x40536c) 뒤 지형 효과(0x40546d). 지형 효과로 쓰러지면 행동 뒤 흐름을 거쳐 다시(마스터면 전투가 끝날 수 있다).
 * 지형 효과는 +0x2dc(turnStarted)가 0일 때만 준다: 되살린 입력 대기 블록(+0x2dc = 1)은 같은 유닛이 경과 0으로 다시 뽑히고 그대로다
 */
export function startTurn(data: EngineData, state: GameState, steps?: TurnStep[]): TurnResult {
  const begun = beginTurn(state, data.natials, steps);
  const started = begun.state.turnStarted === 1 ? { state: begun.state, died: false } : turnStartEffect(data, begun.state, begun.actor);
  steps?.push({ kind: 'start', actor: begun.actor, died: started.died, state: started.state });
  if (!started.died) return { state: started.state, actor: begun.actor };
  return afterAction(data, started.state, begun.actor, 0, steps);
}

// vmv2.exe 0x0040623b: 쓰러진 유닛 정리 → 행동 주체가 남의 마정석 위면 점령 → 경험치 → 승패(0x40612c) → +0x2dc = 0 → 다음 차례.
// 공격으로 마스터가 쓰러지면 원작은 먼저 사라짐 연출만 하고(0x476b28) 같은 흐름을 다시 도는데, 상태는 바뀌지 않는다
function afterAction(data: EngineData, state: GameState, actor: number, exp: number, steps?: TurnStep[]): TurnResult {
  for (;;) {
    const removed = removeDead(state, data.natials);
    state = removed.state;
    if (removed.anyDead) steps?.push({ kind: 'remove', state });
    const u = state.units[actor]; // 이번에 사라졌으면 null
    if (u && canCapture(data.map, workGrid(data.map, state), state, u.x, u.y, u.side)) {
      state = captureStone(state, u.x, u.y, u.side);
      steps?.push({ kind: 'capture', unit: actor, state });
      continue;
    }
    if (u && exp !== 0) {
      const gain = cappedExp(u.exp, exp);
      if (actor >= MASTERS) state = addStat(state, u.side, STAT_NATIAL_EXP + u.type - 1, gain);
      state = addExp(state, actor, gain);
      steps?.push({ kind: 'exp', unit: actor, gain, state });
      exp = 0;
      continue;
    }
    // 0x40612c: 마스터가 쓰러진 진영의 네이티얼을 모두 쓰러뜨리고(HP −10) 다시 돈다. 남은 네이티얼이 없으면 전투 끝(0x401ec3, +0x2dc는 그대로).
    // 쓰러진 마스터는 사라짐 연출(0x41461a → 0x416129)에서 방향이 4가 될 때까지 돈다
    const fallen = state.units.slice(0, MASTERS).flatMap((m, i) => (m && m.hp < 1 ? [i] : []));
    if (fallen.length === 0) return startTurn(data, { ...state, turnStarted: 0 }, steps);
    for (const i of fallen) state = withUnit(state, i, { direction: FALLEN_DIRECTION, pose: FALLEN_DIRECTION * 3 + 1 });
    const sides = fallen.map((i) => unitOf(state, i).side);
    const doomed = state.units.flatMap((v, i) => (i >= MASTERS && v && sides.includes(v.side) ? [i] : []));
    if (doomed.length === 0) {
      const winner = sides.length === 2 ? DRAW : 1 - sides[0];
      steps?.push({ kind: 'end', winner });
      return { state, winner };
    }
    for (const i of doomed) state = withUnit(state, i, { hp: hurt(unitOf(state, i).hp, MAX_HP) });
    steps?.push({ kind: 'fall', doomed, state });
  }
}

/** 명령이 들어온 길: 'ui'는 원작 UI가 만드는 명령(대상은 UI가 고르게 하는 칸), 'received'는 원작이 받은 메시지를 실행하는 경로
 *  (0x406573 → 0x40672d → 0x4067b1: CPU 생각·네트워크 대전)로, 범위 종류 5 행동은 명령의 대상 칸 대신 주체 칸으로 실행한다(0x406cd2) */
export type CommandSource = 'ui' | 'received';

/** 명령 하나로 지금 차례를 끝내고 다음 차례를 시작한다.
 *  규칙에 어긋나는 명령은 RuleViolation, 원작이 정의되지 않은 동작을 하거나 옮기지 않은 경로는 다른 예외를 던진다 */
/** trace를 주면 타격(0x40354b)마다 결과를 차례로 담는다(연출이 같은 차례로 HP·쓰러짐을 보인다) */
export function applyCommand(data: EngineData, state: GameState, command: Command, source: CommandSource = 'ui', trace?: StrikeRecord[], steps?: TurnStep[]): TurnResult {
  if (state.units.slice(0, MASTERS).some((m) => m && m.hp < 1)) throw new RuleViolation('전투가 끝났습니다');
  if (state.turnStarted !== 1) throw new Error('입력 대기 상태(차례 시작 효과를 준 상태, turnStarted = 1)에서만 명령을 실행합니다');
  const actor = nextActor(state).actor;
  const start = unitOf(state, actor);
  const side = start.side;
  const { to, target } = command;
  const onGrid = (c: { x: number; y: number }) => Number.isInteger(c.x) && Number.isInteger(c.y) && c.x >= 0 && c.y >= 0 && c.x < GRID && c.y < GRID;
  if (!onGrid(to) || !onGrid(target)) throw new RuleViolation(`칸이 격자 밖입니다: ${JSON.stringify({ to, target })}`);
  let s = state;
  if (to.x !== start.x || to.y !== start.y) {
    const grid = workGrid(data.map, s);
    const mover = moverOf(s, data.natials, actor);
    const range = movementRange(data.terrain, terrainGraph(data.terrain, data.map, grid, mover.moveType), cellHeights(data.map, grid), s, actor, mover);
    if (!canStop(range, to.x, to.y)) throw new RuleViolation(`(${to.x}, ${to.y})는 이동 범위 밖입니다`);
    s = moveUnit(data.terrain, range, s, actor, to.x, to.y);
  }
  const moved = to.x !== start.x || to.y !== start.y;
  // 명령 메뉴(0x40496f): 주체가 선 칸이 그 이동 타입이 멈출 수 없는 지형이면(물높이가 바뀌어 발밑이 깊어진 경우 등) 공격·마법·소환을 끈다
  const menu = () => {
    const kind = partByte(data.map, workGrid(data.map, s)[to.y * GRID + to.x], 0x62);
    if (!data.terrain.stoppable[moverOf(s, data.natials, actor).moveType * TERRAIN_KINDS + kind]) {
      throw new RuleViolation(`(${to.x}, ${to.y})는 멈출 수 없는 지형이라 공격·마법·소환을 쓸 수 없습니다`);
    }
  };
  // 대기·행동만 명령의 방향으로 돈다(0x4067b1). 원작 자세 표는 방향 × 3 + 프레임 18칸
  const turn = () => {
    if (command.direction > 5) throw new RuleViolation(`방향은 0~5입니다: ${command.direction}`);
    s = setDirection(s, actor, command.direction);
  };
  let exp = 0;
  let action = 0;
  if (command.kind === STAND_BY) {
    turn();
    if (actor < MASTERS) s = addStat(s, side, STAT_STAND_BY, 1);
  } else if (command.kind === ACT) {
    menu();
    turn();
    action = command.number;
    // 쓸 수 있는 행동: 유닛 +0x08 자기 공격(마스터 진영 레코드 +0x18, 네이티얼 표 +0x46)과 마법(마스터 진영 마법 목록 +0x1c,
    // 네이티얼 표 +0x47 → 유닛 +0x10). 다른 번호면 원작은 연출이 멈추거나(투사체 대기) 죽는다
    const natial = actor < MASTERS ? undefined : natialOf(data.natials, start.type);
    const own = natial ? natial.attackAction : s.sides[side].attackAction;
    const magic = natial ? (natial.magicAction ? [natial.magicAction] : []) : s.sides[side].spells;
    if (action !== own && !magic.includes(action)) {
      throw new RuleViolation(`행동 ${action}은 이 유닛이 쓸 수 없는 행동입니다(공격 ${own}, 마법 ${magic.join('·') || '없음'})`);
    }
    const act = data.actions[action];
    if (!act) throw new RangeError(`행동 표 밖의 행동입니다: ${action}`);
    // 받은 명령은 범위 종류 5(자기 칸)면 주체 칸으로 실행한다(0x4067b1 → 0x406cd2). CPU는 이 칸에 이전 기록의 값을 남겨 보낸다
    const aim = source === 'received' && act.rangeKind === SELF_RANGE ? to : target;
    // 메뉴(0x405d18)는 MP가 모자라면 막고, 대상은 원작 UI가 고르게 하는 칸이어야 한다(0x405d18·0x40416f)
    if (act.mpCost > s.sideStates[side].mp) throw new RuleViolation(`MP가 모자랍니다(${s.sideStates[side].mp} < ${act.mpCost})`);
    if (!actionTargets(groundOf(data, s), actor, act).some((c) => c.x === aim.x && c.y === aim.y)) {
      throw new RuleViolation(`(${aim.x}, ${aim.y})는 행동 ${action}의 대상이 아닙니다`);
    }
    const script = data.actionScripts[action];
    if (act.effect !== 0 && script === null) throw new Error(`행동 ${action}에는 연출 스크립트가 없습니다(원작은 널 포인터를 써서 죽는다)`);
    // 0x406d13 종류 1: 마스터 통계, Used MP, 물높이 마법은 여기서 물높이를 바꾸고(0x4255d0·0x4255ff), MP −(0x407190)
    if (actor < MASTERS) s = addStat(s, side, act.kind === 0 && act.sub === 0 ? STAT_ATTACK : action - 7, 1);
    s = addStat(s, side, STAT_USED_MP, act.mpCost);
    if (act.kind === WATER && act.rangeKind === 5) {
      const level = s.waterLevel;
      s = { ...s, waterLevel: act.sub === 0 ? (level < 1 ? level + 1 : level) : level > -1 ? level - 1 : level };
    }
    s = spendMp(s, side, act.mpCost);
    // 연출: 공격 0x413852, 마법 0x4141fd·0x414397 모두 지정 칸 쪽으로 돈다. 타격은 공격이면 유닛 스크립트(+0x07)와 투사체(범위 종류 1,
    // 0x416929가 도착할 때 새로 계산한 전부), 마법이면 행동의 스크립트(0x413c45)에서
    s = face(s, actor, aim.x, aim.y);
    const self = unitOf(s, actor);
    const hits: readonly (Hit | { kind: 'fresh' })[] =
      act.effect === 0
        ? [...data.scriptHits(actor < MASTERS ? self.type : self.type + NATIAL_SCRIPT_BASE), ...(act.rangeKind === 1 ? [{ kind: 'fresh' as const }] : [])]
        : data.scriptHits(script ?? 0);
    ({ state: s, exp } = strike(data, s, actor, act, aim, hits, trace));
  } else if (command.kind === SUMMON) {
    // 0x406d13 종류 2: 소환 횟수·Used MP 통계 → 0x414059(연출 + 0x40f910 소환) → MP −= 소환 MP. 메뉴(0x405dcc)는 MP가 모자라면 막는다
    const type = command.number;
    if (actor >= MASTERS) throw new RuleViolation('네이티얼은 소환할 수 없습니다');
    menu();
    if (!s.sides[side].natials.includes(type)) throw new RuleViolation(`진영 ${side}은 네이티얼 ${type}을 소환할 수 없습니다`);
    const cost = natialOf(data.natials, type).summonMp;
    if (s.sideStates[side].mp < cost) throw new RuleViolation(`MP가 모자랍니다(${s.sideStates[side].mp} < ${cost})`);
    const cells = summonCells(data.map, data.terrain, workGrid(data.map, s), data.natials, s, actor, type);
    if (!cells.some((c) => c.x === target.x && c.y === target.y)) throw new RuleViolation(`(${target.x}, ${target.y})에는 소환할 수 없습니다`);
    // 의도적 차이: 원작은 실행 중 표 51칸까지 소환하지만 블록은 50개만 담아 51번째가 개수 칸을 덮어쓴다(스펙 §11)
    // 명령 메뉴(0x40496f)는 진영 유닛 수(마스터 포함)가 25 이상이면 소환을 끈다. 두 진영 합쳐 50 = 블록이 담는 수
    if (s.sideStates[side].unitCount >= SIDE_UNIT_LIMIT) throw new RuleViolation(`진영 유닛이 ${SIDE_UNIT_LIMIT}개라 더 소환할 수 없습니다`);
    s = addStat(s, side, STAT_SUMMONS + type - 1, 1);
    s = addStat(s, side, STAT_USED_MP, cost);
    s = face(s, actor, target.x, target.y); // 0x414397: 소환 칸 쪽으로 돈 뒤 소환한다(새 네이티얼이 이 방향을 받는다)
    s = summonNatial(data.oa, data.natials, s, actor, type, target.x, target.y);
    s = spendMp(s, side, cost);
    action = SUMMON_ACTION;
  } else if (command.kind === RETURN) {
    // 0x406d13 종류 3. 원작 UI는 마스터 차례에 이동하기 전(입력 상태 1에서 유닛을 오른쪽 클릭 → 유닛 메뉴 0x404c02) 같은 진영 네이티얼을 고르면
    // 되돌리기를 켜고(0x405f13) 그 칸을 대상으로 보낸다. 대상 HP −10 뒤 행동 뒤 흐름 없이 다음 차례(0x40536c)로 간다: 마스터 OA가 그대로라
    // 대개 다시 마스터 차례이고, +0x2dc를 0으로 되돌리지 않아 지형 효과를 받지 않는다
    if (actor >= MASTERS) throw new RuleViolation('되돌리기는 마스터 차례에만 쓸 수 있습니다');
    if (moved) throw new RuleViolation('되돌리기는 이동하기 전에만 쓸 수 있습니다');
    const index = s.units.findIndex((u) => u && u.x === target.x && u.y === target.y);
    if (index < MASTERS || unitOf(s, index).side !== side) throw new RuleViolation(`(${target.x}, ${target.y})에 되돌릴 아군 네이티얼이 없습니다`);
    const returned = withUnit(s, index, { hp: hurt(unitOf(s, index).hp, MAX_HP) });
    steps?.push({ kind: 'act', state: returned });
    const begun = beginTurn(returned, data.natials, steps);
    steps?.push({ kind: 'start', actor: begun.actor, died: false, state: begun.state });
    return { state: begun.state, actor: begun.actor };
  } else {
    throw new RuleViolation(`명령 종류는 0~3입니다: ${command.kind}`);
  }
  s = withUnit(s, actor, { oa: oaCost(data.oa, speedOf(data, s, actor), moved, action) }); // 0x405fd7·0x406045·0x4060b9
  steps?.push({ kind: 'act', state: s });
  return afterAction(data, s, actor, exp, steps);
}
