// 칸마다 행동 평가. vmv2.exe 0x00447d97(이동 범위의 칸마다 가장 좋은 행동과 점수를 분석 격자에 씀)과 그 아래 함수.
import { GRID } from '../engine/rules/terrain.ts';
import {
  AHEAD,
  CELLS,
  DIRECTION,
  idiv,
  KIND,
  type Mind,
  NONE,
  NUMBER,
  RECORD,
  sar,
  SCORE,
  TARGET_X,
  TARGET_Y,
  TOTAL,
} from './mind.ts';
import {
  canSummonAt,
  canTarget,
  cell,
  fromMaster,
  hitValue,
  inAreaOf,
  inRangeOf,
  isStone,
  oaOf,
  nearRivals,
  openCell,
  spendValue,
  stoppableFor,
  summonMp,
} from './value.ts';
import type { SimUnit } from './world.ts';

const SELF = 5; // 범위 종류 5: 자기 칸
const SELF_AREA = 4;
const LOOKAHEAD_TURNS = 1;
const FULL_TURNS = 0x40;
const STAND_BY = 0;
const ACT = 1;
const SUMMON = 2;
const SIDE_LIMIT = 0x19;

interface Target {
  x: number;
  y: number;
}

// vmv2.exe 0x0044b487: 진영 네이티얼이 가진 마법 MP 합
export function countSpellMp(m: Mind, side: number): void {
  let sum = 0;
  for (const u of m.world.units) if (u && u.side === side && u.natial) for (const s of u.spells) sum += m.action(s).mpCost;
  m.spellMp[side] = sum;
}

// vmv2.exe 0x0044b54c: 지켜 둘 MP
export function countReserveMp(m: Mind, side: number): void {
  let most = 0;
  for (const t of m.world.sides[side].natials) most = Math.max(most, summonMp(m.world, t));
  m.reserveMp[side] = Math.min(most + m.spellMp[side], m.world.sides[side].maxMp);
}

// vmv2.exe 0x00449927: 상대 유닛의 평균 2배 좌표
export function locateRivals(m: Mind, side: number): void {
  let n = 0;
  let sx = 0;
  let sy = 0;
  for (const u of m.world.units) {
    if (!u || u.side === side) continue;
    sx += (u.y & 1) + u.x * 2;
    sy += u.y * 2;
    n++;
  }
  if (n === 0) n = 1;
  m.rivalCenter[side] = { x: idiv(sx, n), y: idiv(sy, n) };
}

// vmv2.exe 0x004497a1: 소환할 수 있는 종류를 값 순서로(같은 값이면 뒤 종류가 앞)
export function rankSummons(m: Mind, side: number): void {
  const list = m.world.sides[side].natials;
  const at = side * 24;
  for (const [i, type] of list.entries()) {
    const cost = summonMp(m.world, type);
    let v: number;
    if (m.world.sideStates[side].mp < cost) v = NONE;
    else {
      const ai = m.world.data.mapAi;
      v = (idiv(Math.imul(m.summonValue[side * 25 + type] + spendValue(m, side, cost, sar(cost, 3)), ai.valueMax[type]), 0x300) + ai.penaltyMax[type]) | 0;
    }
    let j = i;
    for (; j > 0 && m.rankValue[at + j - 1] <= v; j--) {
      m.rankType[at + j] = m.rankType[at + j - 1];
      m.rankValue[at + j] = m.rankValue[at + j - 1];
    }
    m.rankType[at + j] = type;
    m.rankValue[at + j] = v;
  }
}

// vmv2.exe 0x00449b05: 행동 n의 가장 좋은 대상과 값. buffer는 범위 마법의 방향별 버퍼 시작 칸(0x448200이 채움)
function bestUse(m: Mind, u: SimUnit, n: number, out: Target, threshold: number, buffer: number): number {
  const a = m.action(n);
  if (m.world.sideStates[u.side].mp < a.mpCost) return NONE;
  const base = spendValue(m, u.side, a.mpCost, 0);
  if (a.rangeKind === SELF) return NONE;
  let best = NONE;
  if (a.areaRadius === 0) {
    for (const t of m.world.units) {
      if (!t || !canTarget(m, u, n, t)) continue;
      const v = (base + hitValue(m, u, n, u.x, u.y, t)) | 0;
      if (best < v) {
        out.x = t.x;
        out.y = t.y;
        best = v;
      }
    }
    return best;
  }
  if (a.rangeKind === SELF_AREA) {
    let v = base;
    for (const t of m.world.units) if (t && inAreaOf(m, n, u.x, u.y, t.x, t.y)) v = (v + hitValue(m, u, n, u.x, u.y, t)) | 0;
    out.x = u.x;
    out.y = u.y;
    return v;
  }
  const A = m.arena;
  let at = buffer;
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++, at++) {
      if (!(threshold < A[at]) || !inRangeOf(m, u.x, u.y, n, x, y)) continue;
      let v = A[at];
      if (inAreaOf(m, n, x, y, u.x, u.y)) v = (v + hitValue(m, u, n, x, y, u)) | 0;
      if (best < v) {
        best = v;
        out.x = x;
        out.y = y;
      }
    }
  }
  return best;
}

// vmv2.exe 0x00448200: 범위 마법을 칸마다 쓴 값을 버퍼에 채우고, 원작 식대로 하나를 고른다
function fillArea(m: Mind, u: SimUnit, n: number, buffer: number): number {
  if (m.world.sideStates[u.side].mp < m.action(n).mpCost) return NONE;
  const base = spendValue(m, u.side, m.action(n).mpCost, 0);
  const A = m.arena;
  for (let y = 0; y < GRID; y++) for (let x = 0; x < GRID; x++) A[buffer + cell(x, y)] = openCell(m.world, x, y) ? base : NONE;
  for (const t of m.world.units) {
    if (!t || t === u) continue;
    A[buffer + cell(t.x, t.y)] += hitValue(m, u, n, t.x, t.y, t);
    for (let d = 0; d < 6; d++) {
      const c = step1(m, t.x, t.y, d);
      if (!c) continue;
      const at = buffer + cell(c.x, c.y);
      if (NONE < A[at] && inAreaOf(m, n, c.x, c.y, t.x, t.y)) A[at] += hitValue(m, u, n, c.x, c.y, t);
    }
  }
  // 원작은 0x400번 두 칸씩 건너뛰며 짝수 칸을 비교하고 홀수 칸 값을 고른다(다음 마법 칸 버퍼까지 읽음)
  let best = NONE;
  for (let i = 0; i < CELLS; i++) if (best < A[buffer + i * 2]) best = A[buffer + i * 2 + 1];
  return best;
}

/** 한 칸 이웃(격자 밖이면 null) (vmv2.exe 0x00440e21) */
export function step1(m: Mind, x: number, y: number, d: number): { x: number; y: number } | null {
  const t = m.world.data.terrain;
  const nx = x + t.stepX[(y & 1) * 6 + d];
  const ny = y + t.stepY[d];
  return nx < 0 || nx > 31 || ny < 0 || ny > 31 ? null : { x: nx, y: ny };
}

/** n걸음(도중에 격자 밖이면 null) (vmv2.exe 0x00440dba) */
export function stepN(m: Mind, x: number, y: number, d: number, n: number): { x: number; y: number } | null {
  let c: { x: number; y: number } | null = { x, y };
  for (let i = 0; i < n && c; i++) c = step1(m, c.x, c.y, d);
  return c;
}

// vmv2.exe 0x00449f5c: 마스터가 지금 칸 이웃에 소환할 가장 좋은 종류와 칸
export function bestSummon(m: Mind, u: SimUnit, out: Target & { type: number }): number {
  const side = u.side;
  const list = m.world.sides[side].natials;
  const ai = m.world.data.mapAi;
  let best = NONE;
  for (let k = 0; k < list.length && best < m.rankValue[side * 24 + k]; k++) {
    const type = m.rankType[side * 24 + k];
    const cost = summonMp(m.world, type);
    const sv = (m.summonValue[side * 25 + type] + spendValue(m, side, cost, sar(cost, 3))) | 0;
    for (let d = 0; d < 6; d++) {
      const c = step1(m, u.x, u.y, d);
      if (!c || !canSummonAt(m, u, type, c.x, c.y)) continue;
      const i = type * CELLS + cell(c.x, c.y);
      const v = (idiv(Math.imul(sv, ai.value[i]), 0x300) + ai.penalty[i] + nearRivals(m, side, c.x, c.y)) | 0;
      if (best < v) {
        out.type = type;
        out.x = c.x;
        out.y = c.y;
        best = v;
      }
    }
  }
  return best;
}

// vmv2.exe 0x0044847f: 칸 기록(at)에 가장 좋은 행동을 쓴다
function chooseAction(m: Mind, u: SimUnit, at: number): void {
  const A = m.arena;
  const t: Target = { x: 0, y: 0 };
  const take = (v: number, kind: number, number: number) => {
    A[at + SCORE] = v;
    A[at + KIND] = kind;
    A[at + NUMBER] = number;
    A[at + TARGET_X] = t.x;
    A[at + TARGET_Y] = t.y;
  };
  let v = bestUse(m, u, u.attackAction, t, A[at + SCORE], 0);
  if (A[at + SCORE] < v) take(v, ACT, u.attackAction);
  for (const [k, s] of u.spells.entries()) {
    const a = m.action(s);
    if (a.areaRadius !== 0 && a.range !== 0 && !(A[at + SCORE] < m.areaBest[k])) continue;
    v = bestUse(m, u, s, t, A[at + SCORE], m.spellBuffer(k));
    if (A[at + SCORE] < v) take(v, ACT, s);
  }
  if (!u.natial && m.world.sideStates[u.side].unitCount < SIDE_LIMIT) {
    const s = { type: 0, x: t.x, y: t.y };
    v = bestSummon(m, u, s);
    if (A[at + SCORE] < v) {
      t.x = s.x;
      t.y = s.y;
      take(v, SUMMON, s.type);
    }
  }
}

/** vmv2.exe 0x00447d97: 칸마다 점수를 분석 격자에 쓰고 가장 좋은 칸 기록의 시작 칸을 돌려준다. lookahead면 이번 차례 이동 범위만 */
export function evaluate(m: Mind, index: number, lookahead: boolean): number {
  const w = m.world;
  const u = w.units[index];
  if (!u) throw new Error(`유닛 표 ${index}번 칸이 비었습니다`);
  const bx = u.x;
  const by = u.y;
  const search = w.search(index);
  search.advance(u.movement, 1);
  const limit = lookahead ? LOOKAHEAD_TURNS : FULL_TURNS;
  for (let k = 2; k <= limit && search.relax(); k++) search.advance(u.movement, k);
  m.range = search;
  let layer = u.type;
  if (!u.natial) {
    layer = 0;
    rankSummons(m, u.side);
  }
  for (const [k, s] of u.spells.entries()) {
    const a = m.action(s);
    if (a.areaRadius !== 0 && a.range !== 0) m.areaBest[k] = fillArea(m, u, s, m.spellBuffer(k));
  }
  const A = m.arena;
  const ai = w.data.mapAi;
  const start = layer * CELLS + cell(bx, by);
  let best = NONE;
  let bestAt = -1;
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      if (!(m.rangeByte(x, y, 0x12) & 8)) continue;
      const at = cell(x, y) * RECORD;
      A[at + TOTAL] = 0;
      u.x = x;
      u.y = y;
      w.updatePosition(u);
      A[at + SCORE] = 0;
      A[at + KIND] = STAND_BY;
      A[at + DIRECTION] = m.rangeByte(x, y, 8);
      if (stoppableFor(w, u.moveType, x, y) && (u.natial || m.rangeByte(x, y, 0x1e) === 1)) chooseAction(m, u, at);
      let t = A[at + SCORE];
      if (isStone(w, x, y)) {
        const owner = w.stones.find((s) => s.x === x && s.y === y)?.owner;
        if (owner === undefined) throw new Error(`(${x}, ${y})에 마정석이 없습니다(원작은 목록 밖을 읽음)`);
        if (owner === 0) t += 10000;
        else if (owner - 1 !== u.side) t += fromMaster(m, owner - 1, x, y);
        if (u.hp < 10) t += u.natial ? u.w60 : u.w60 * 2;
      }
      const i = layer * CELLS + cell(x, y);
      t = (t + Math.imul(ai.value[i] - ai.value[start], 0x32) + ai.penalty[i]) | 0;
      if (x === bx && y === by) {
        if (A[at + KIND] !== SUMMON) t = (t + sar(t, 2)) | 0;
        t += 4;
      } else if (lookahead && !u.natial) t -= 25000;
      A[at + TOTAL] = t;
      A[at + AHEAD] = 0;
      if (best < t) {
        best = t;
        bestAt = at;
      }
    }
  }
  u.x = bx;
  u.y = by;
  w.updatePosition(u);
  if (bestAt < 0) throw new Error('멈출 수 있는 칸이 없습니다(원작은 정하지 않은 포인터를 돌려줌)');
  return bestAt;
}

// vmv2.exe 0x0044b7d7: 이번 차례에 못 닿는 좋은 칸으로 가는 길의 이번 차례 칸에 앞날 점수를 두고, 그 가운데 가장 큰 값을 돌려준다
export function pathValue(m: Mind, u: SimUnit): number {
  const w = m.world;
  const range = m.range;
  if (!range) throw new Error('이동 범위를 아직 구하지 않았습니다');
  const b = range.w;
  const A = m.arena;
  const t = w.data.terrain;
  const delta = (p: number, d: number) => (t.stepY[d] * GRID + t.stepX[(b[p + 1] & 1) * 6 + d]) * 0x1f;
  const oa = oaOf(w, u.speed, true, 0);
  let best = 0;
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      let p = cell(x, y) * 0x1f;
      const marker = b[p + 0x1e];
      if (marker <= 1) continue;
      let v = A[cell(x, y) * RECORD + TOTAL];
      if (v > 22000) v = 22000;
      const q = marker + 4;
      v = idiv(Math.imul(v, 0x21c), Math.imul(Math.imul(oa, q), q));
      if (v <= 0x13) continue;
      if (v > 0x12c0) v = 0x12c0;
      if (best < v) best = v;
      let c = 0;
      do {
        const arrived = b[p + 8 + c];
        c = b[p + 0x14 + c];
        p += delta(p, (arrived + 3) % 6);
      } while (b[p + 0x1e] !== 1);
      let walked = 1;
      while (b[p] !== u.x || b[p + 1] !== u.y) {
        const at = (b[p + 1] * GRID + b[p]) * RECORD;
        const s = idiv(Math.imul(v, u.movement - walked), u.movement);
        if (s <= A[at + AHEAD]) break;
        A[at + AHEAD] = s;
        do {
          const back = (b[p + 8 + c] + 3) % 6;
          c = b[p + 0x14 + c];
          p += delta(p, back);
          walked += (b[p + ((back + 3) % 6) + 2] << 24) >> 24;
        } while (b[p + 0x1e] !== 1);
      }
    }
  }
  return best;
}
