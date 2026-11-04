// CPU AI 분석 단계. vmv2.exe 0x00445b20 안에서 결정 전에 부르는 0x0044b207(진영마다), 0x00445d57(생각 가중치),
// 0x00446106·0x004460db(결정 가중치). 가중치는 원작이 실행 중 유닛 +0x60·+0x64에 두는 값으로, 블록에는 없다.
import { cdiv } from '../engine/rules/cint.ts';
import { oaCost } from '../engine/rules/oaCost.ts';
import { hexDistance } from '../engine/rules/range.ts';
import { natialOf } from '../engine/rules/summon.ts';
import { GRID, partByte, workGrid } from '../engine/rules/terrain.ts';
import { type GameState, MASTERS, unitOf } from '../engine/state.ts';
import type { EngineData } from '../engine/turn.ts';

/** 유닛 +0x60·+0x64 */
export interface AiWeight {
  readonly w60: number;
  readonly w64: number;
}

export interface SideAnalysis {
  /** 0x4ead64[진영]: 마스터 마력 × 회복 배수 − 유지 MP와 풀기 마법을 쓸 수 있는 유닛 수로 정한 점수 */
  readonly score: number;
  /** 0x4cefe8[진영]: 상대가 상태 이상을 걸 수 있으면 6(마스터 마법) 또는 10(소환할 수 있는 네이티얼의 마법), 아니면 0 */
  readonly statusThreat: number;
}

const MASTER_WEIGHT = 0x9c4;
const STATUS = 2;
const CURE = 3;
const FLY = 4;
const READY = 81; // OA + 상태 이상 남은 분이 이보다 작고
const HEALTHY = 2; // HP가 이보다 큰 유닛의 풀기 마법만 센다

// 유닛 +0x0c·+0x10: 마법 목록. 마스터는 진영 레코드 +0x1c, 네이티얼은 표 +0x47(0x40f910·0x40fc66)
function magicOf(data: EngineData, state: GameState, index: number): readonly number[] {
  const u = unitOf(state, index);
  if (index < MASTERS) return state.sides[u.side].spells;
  const magic = natialOf(data.natials, u.type).magicAction;
  return magic ? [magic] : [];
}

const masterOf = (state: GameState, side: number): number => {
  const index = state.units.slice(0, MASTERS).findIndex((m) => m && m.side === side);
  if (index < 0) throw new Error(`진영 ${side}의 마스터가 없습니다`);
  return index;
};

/** 소환(0x40f910)·되살리기(0x40fc66·0x40f696) 때의 가중치: 네이티얼은 둘 다 표 +0x4c, 마스터는 +0x60 = 0x9c4(+0x64는 쓰지 않음) */
export function initialWeights(data: EngineData, state: GameState): (AiWeight | null)[] {
  return state.units.map((u, i) => {
    if (!u) return null;
    if (i < MASTERS) return { w60: MASTER_WEIGHT, w64: 0 };
    const w = natialOf(data.natials, u.type).aiWeight;
    return { w60: w, w64: w };
  });
}

// vmv2.exe 0x0044b207
export function analyzeSide(data: EngineData, state: GameState, side: number): SideAnalysis {
  let cures = 0;
  state.units.forEach((u, i) => {
    if (!u || u.side !== side || u.oa + u.statusMinutes >= READY || u.hp <= HEALTHY) return;
    cures += magicOf(data, state, i).filter((a) => data.actions[a].kind === CURE).length;
  });
  const st = state.sideStates[side];
  const reserve = Math.max(Math.imul(state.sides[side].magic, st.mpMultiplier) - st.upkeep, -20);
  const score = cdiv(Math.imul(512 - cdiv(51200, reserve + 120), 384), (cures + 2) * (cures + 2) * 256);
  const enemy = 1 - side;
  const spell = state.sides[enemy].spells.some((a) => data.actions[a].kind === STATUS);
  const natial = state.sides[enemy].natials.some((t) => {
    const magic = natialOf(data.natials, t).magicAction;
    return magic !== 0 && data.actions[magic].kind === STATUS;
  });
  return { score, statusThreat: natial ? 10 : spell ? 6 : 0 };
}

// vmv2.exe 0x00445d57 앞부분: 진영마다 MP 사정(마력 × 회복 배수 − 유지 MP)과 상대 회복 배수로 정하는 배율
function sideFactor(state: GameState, side: number): number {
  const own = Math.imul(state.sides[side].magic, state.sideStates[side].mpMultiplier);
  const upkeep = state.sideStates[side].upkeep;
  let c = own <= upkeep ? own : own * 5 - upkeep * 4;
  const other = 1 - side;
  c = Math.imul(c, Math.imul(state.sides[other].magic, state.sideStates[other].mpMultiplier + 4) + 0x80);
  return cdiv(Math.imul(c, 256), Math.imul(Math.imul(own + 1, 3), Math.imul(state.sides[side].magic, state.sideStates[side].mpMultiplier + 4) + 0x80));
}

// 네이티얼 가중치(0x445d57·0x446106 공통): 표 +0x4c × (2/3 + 마스터에서 떨어진 정도 × 이동 비용 / 이동력)
function natialWeight(data: EngineData, state: GameState, grid: Uint16Array, index: number): number {
  const u = unitOf(state, index);
  const t = natialOf(data.natials, u.type);
  const m = unitOf(state, masterOf(state, u.side));
  const height = (x: number, y: number) => (partByte(data.map, grid[y * GRID + x], 0x61) << 24) >> 24; // 위치 객체 +8(부호 있는 바이트)
  let d = hexDistance(m.x, m.y, u.x, u.y);
  if (t.moveType !== FLY && height(m.x, m.y) < height(u.x, u.y)) d += height(u.x, u.y) - height(m.x, m.y);
  const cost = oaCost(data.oa, t.speed[u.level], true, 0);
  return cdiv(t.aiWeight * 2, 3) + cdiv(Math.imul(Math.imul(t.aiWeight, d), cost), t.movement * 270);
}

// 표 +0x47 마법이 풀기인 네이티얼에서 원작 반복은 끝난다(그 뒤 칸 유닛은 예전 가중치를 그대로 둔다)
const curer = (data: EngineData, state: GameState, index: number) => {
  const magic = natialOf(data.natials, unitOf(state, index).type).magicAction;
  return data.actions[magic].kind === CURE;
};

/** 생각 가중치(0x445d57): 원작은 이 값을 생각이 끝난 뒤에도 남긴다(0x44ba74가 이 직후를 떠 두고 0x44bb31이 되돌림) */
// vmv2.exe 0x00445d57
export function thinkWeights(data: EngineData, state: GameState, actor: number, previous: readonly (AiWeight | null)[]): (AiWeight | null)[] {
  const factor = [sideFactor(state, 0), sideFactor(state, 1)];
  const grid = workGrid(data.map, state);
  const out = [...previous];
  for (const [i, u] of state.units.entries()) {
    if (!u) continue;
    const before = out[i] ?? { w60: 0, w64: 0 };
    if (i < MASTERS) {
      out[i] = { ...before, w60: MASTER_WEIGHT };
      continue;
    }
    let v = Math.imul(natialWeight(data, state, grid, i), factor[u.side]);
    v = (v + ((v >> 31) & 0xff)) >> 8;
    if (curer(data, state, i)) break;
    out[i] = { w60: v << u.level, w64: v }; // 0x4460db
  }
  const m = masterOf(state, unitOf(state, actor).side);
  const before = out[m] ?? { w60: 0, w64: 0 };
  out[m] = { ...before, w60: before.w60 << 2 };
  return out;
}

/** 결정 가중치(0x446106): 결정 함수가 읽는 값. 생각 가중치 위에 다시 구하며, 배율을 곱하지 않는다 */
// vmv2.exe 0x00446106
export function decideWeights(data: EngineData, state: GameState, thought: readonly (AiWeight | null)[]): (AiWeight | null)[] {
  const grid = workGrid(data.map, state);
  const out = [...thought];
  for (const [i, u] of state.units.entries()) {
    if (!u) continue;
    if (i < MASTERS) {
      out[i] = { ...(out[i] ?? { w60: 0, w64: 0 }), w60: MASTER_WEIGHT };
      continue;
    }
    const v = natialWeight(data, state, grid, i);
    if (curer(data, state, i)) break;
    out[i] = { w60: v << u.level, w64: v };
  }
  return out;
}
