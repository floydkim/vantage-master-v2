// 소환 값. vmv2.exe 0x00448bb3(종류마다 평가용 네이티얼을 만들어 상대와 비교한 값), 0x004491d8(마스터 차례: 45분 두어 본 뒤
// 맵 자리·위협으로 고친 값), 그리고 그 아래 0x0044a39d·0x0044a5c3·0x0044a88c·0x0044aa04, 결정이 쓰는 0x0044a149·0x00449e53.
import { CELLS, idiv, type Mind, NONE, RECORD, SCORE, sar, TOTAL } from './mind.ts';
import { evaluate } from './search.ts';
import { playAhead } from './simulate.ts';
import {
  actionValue,
  bareValue,
  distance,
  healAmount,
  hpValue,
  i32At,
  nearRivals,
  oaOf,
  spendValue,
  statusMinutes,
  stoppableFor,
  summonMp,
  threatTo,
} from './value.ts';
import type { SimUnit } from './world.ts';

const HEAL = 1;
const STATUS = 2;
const CURE = 3;
const WATER = 4;
const BLESS = 5;
const DAY = 0x5a0;
const COUNT_FACTOR = 0x475550; // [같은 종류 수]
const WATER_MAP = 0x30; // 맵 구조체 +0x30: 0이면 물높이 마법을 쓰지 않는다

// vmv2.exe 0x0040fb43: 평가용 네이티얼(플래그 0x4001)을 유닛 표 빈 칸에 만든다. 위치 객체는 방향 0, 위치는 정하지 않는다
function tempNatial(m: Mind, type: number, side: number): SimUnit {
  const w = m.world;
  const u = w.newNatial(type, side);
  u.temp = true;
  const t = w.allocate(u);
  w.refreshStats(t);
  return t;
}

// vmv2.exe 0x0041752e + 0x0040f50d
function free(m: Mind, u: SimUnit): void {
  const i = m.world.units.indexOf(u);
  if (i < 0) throw new Error('평가용 네이티얼이 유닛 표에 없습니다');
  m.world.units[i] = null;
}

const valueAt = (m: Mind, side: number, type: number) => m.summonValue[side * 25 + type];

/** vmv2.exe 0x00448bb3: 진영이 소환할 수 있는 종류마다 소환 값(시각을 4시간 뒤로 두고 본다) */
export function valueSummons(m: Mind, side: number): void {
  const w = m.world;
  let heal = 0xa00;
  let cure = 0x1400;
  let status = m.threats[side] << 8;
  for (const u of w.units) {
    if (!u || !u.natial) continue;
    const magic = w.data.natials[u.type - 1].magicAction;
    const kind = m.action(magic).kind;
    if (u.side === side) {
      if (kind === HEAL) heal = (heal + healAmount(m, u, magic) * 2) | 0;
      else if (kind === CURE) cure += 0xa00;
    } else if (kind === STATUS) status = (status + idiv(Math.imul(statusMinutes(m, u, magic), 0xa00), 100)) | 0;
  }
  const master = w.master(side);
  const range = w.search(w.units.indexOf(master));
  range.advance(master.movement, 1);
  let low = 100;
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) if (range.w[(y * 32 + x) * 0x1f + 0x12] & 8 && w.cellHeight(x, y) < low) low = w.cellHeight(x, y);
  if (low === 100) low = 0;
  w.time = (w.time + 0xf0) % DAY;
  for (const type of w.sides[side].natials) {
    const t = tempNatial(m, type, side);
    t.height = low;
    const magic = w.data.natials[type - 1].magicAction;
    const kind = m.action(magic).kind;
    let sum = 0;
    let weights = 0x9c4;
    if (magic === 0 || (kind !== 0 && kind !== STATUS)) {
      for (const u of w.units) {
        if (!u || u.temp || u.side === side) continue;
        sum = (sum + actionValue(m, t, t.attackAction, u)) | 0;
        weights = (weights + u.w60) | 0;
      }
      sum = (sum + bareValue(m, t, t.attackAction)) | 0;
    } else {
      for (const u of w.units) {
        if (!u || u.temp || u.side === side) continue;
        sum = (sum + Math.max(actionValue(m, t, t.attackAction, u), actionValue(m, t, magic, u))) | 0;
        weights = (weights + u.w60) | 0;
      }
      const a = bareValue(m, t, t.attackAction);
      const b = bareValue(m, t, magic);
      sum = (sum + (b < a ? a + idiv(b, 2) : idiv(a, 2) + b)) | 0;
    }
    weights += 0x1d4c;
    let support = 0;
    const count = w.sideStates[side].unitCount + 7;
    if (magic !== 0 && kind === HEAL) support = idiv(Math.imul(Math.imul(healAmount(m, t, magic), count), 0x80), heal);
    if (magic !== 0 && kind === CURE) support = idiv(Math.imul(Math.imul(Math.imul(status, m.scores[side]), count), 0x55), Math.imul(cure, 0x18));
    if (sum < 0) sum = 0x7fffffff;
    let v = weights < 1 ? 0 : idiv(sum, weights);
    if (support < 0) support = 0x7fffffff;
    if (support > 0) v = v < support ? (support + idiv(v, 2)) | 0 : (v + idiv(support, 2)) | 0;
    const threat = threatTo(m, t);
    m.summonValue[side * 25 + type] = idiv(Math.imul(Math.imul(v, 0x1000), t.movement + 1), threat + 0x200);
    free(m, t);
  }
  w.time = (w.time + 0x4b0) % DAY;
}

// vmv2.exe 0x0044a39d: 두어 본 뒤 주체에서 먼 유닛일수록 회복·상태 이상 회복을 더 받은 것으로 두고, 주체 진영에서 가장 소중한 유닛은 다친 것으로 둔다
function settleAfterPlay(m: Mind, u: SimUnit): void {
  let bestValue = -1;
  let best: SimUnit | null = null;
  for (const t of m.world.units) {
    if (!t) continue;
    const d = distance(u, t.x, t.y);
    if (t.hp < 10) t.hp = Math.min(t.hp + sar(d, 2), 10);
    if (t.statusMinutes > 0) t.statusMinutes = Math.max(t.statusMinutes - d * 10, 0);
    if (t.side === u.side) {
      let v = idiv(t.w60 << 8, distance(u, t.x, t.y) + 0xc);
      if (!t.natial) v = sar(v, 8);
      if (bestValue < v) {
        bestValue = v;
        best = t;
      }
    }
  }
  if (!best) throw new Error('주체 진영 유닛이 없습니다');
  const d = distance(u, best.x, best.y);
  let hp = 6 - sar(d, 2);
  if (hp < 0) hp = 1;
  if (hp < best.hp) best.hp = hp;
  const s = idiv(Math.imul(d * 4 + 0x24, m.threats[u.side]), 10);
  if (best.statusMinutes < s) best.statusMinutes = s;
}

// vmv2.exe 0x0044a5c3: 마스터 이동 범위 칸과 높이 차 1 이하로 이웃한 빈 칸은 1, 마스터 이웃 칸은 두 배
function reachMap(m: Mind, u: SimUnit): Int32Array {
  const w = m.world;
  const range = w.search(w.units.indexOf(u));
  range.advance(u.movement, 1);
  m.range = range;
  const t = w.data.terrain;
  const out = new Int32Array(CELLS);
  const stop = (x: number, y: number) => (range.w[(y * 32 + x) * 0x1f + 0x12] & 8) !== 0;
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const o = w.unitAt(x, y);
      if (o && o !== u) continue;
      const h = w.cellHeight(x, y);
      for (let d = 0; d < 6; d++) {
        const nx = x + t.stepX[(y & 1) * 6 + d];
        const ny = y + t.stepY[d];
        if (nx < 0 || nx > 31 || ny < 0 || ny > 31 || !stop(nx, ny)) continue;
        const hn = w.cellHeight(nx, ny);
        if (hn <= h + 1 && h - 1 <= hn) {
          out[y * 32 + x] = 1;
          break;
        }
      }
    }
  }
  const h = w.cellHeight(u.x, u.y);
  for (let d = 0; d < 6; d++) {
    const nx = u.x + t.stepX[(u.y & 1) * 6 + d];
    const ny = u.y + t.stepY[d];
    if (nx < 0 || nx > 31 || ny < 0 || ny > 31) continue;
    const hn = w.cellHeight(nx, ny);
    if (h <= hn + 1 || hn - 1 <= h) out[ny * 32 + nx] <<= 1;
  }
  return out;
}

/** vmv2.exe 0x0044aa04: type을 (x, y)에 소환했다고 보고 그 네이티얼이 닿는 칸들의 공격·위협 값 4가지 */
export function placeValue(m: Mind, type: number, x: number, y: number, side: number): [number, number, number, number] {
  const w = m.world;
  const st = w.sideStates[side];
  const mp = st.mp;
  st.mp = Math.min(st.mp + 0x10, w.sides[side].maxMp);
  const t = tempNatial(m, type, side);
  t.x = x & 0xff;
  t.y = y & 0xff;
  evaluate(m, w.units.indexOf(t), false);
  free(m, t);
  st.mp = mp;
  const oa = oaOf(w, t.speed, true, 0);
  const A = m.arena;
  let attack = 0;
  let here = 0;
  let threat = 0;
  let hereThreat = 0;
  for (let i = 0; i < CELLS; i++) {
    const at = i * RECORD;
    const marker = m.rangeByte(A[at], A[at + 1], 0x1e);
    if (marker === 0) continue;
    const total = A[at + TOTAL];
    const score = A[at + SCORE];
    if (marker === 1) {
      here = Math.max(here, (total - score) | 0);
      hereThreat = Math.max(hereThreat, score);
      continue;
    }
    // 원작은 앞 갈래에서 표시 값에 4를 더한 채로 뒤 갈래에서 다시 4를 더한다
    let q = marker;
    const div = () => Math.imul(Math.imul(Math.imul(oa, oa), q + 4), q + 4);
    if (0 < ((total - score) | 0)) {
      attack = Math.max(attack, Math.min(idiv(Math.imul((total - score) | 0, 0x5eec), div()), 0x12c0));
      q += 4;
    }
    let s = score;
    if (0 < s) {
      if (s > 22000) s = 22000;
      threat = Math.max(threat, Math.min(idiv(Math.imul(s, 0x5eec), div()), 0x12c0));
    }
  }
  if (here > 40000) here = 40000;
  if (hereThreat > 40000) hereThreat = sar(hereThreat - 40000, 2) + 40000;
  return [attack, idiv(Math.imul(here, 0x2d), oa), threat, idiv(Math.imul(hereThreat, 0x2d), oa)];
}

// vmv2.exe 0x0044a88c: 맵 자리 값이 가장 큰 칸에 소환했다고 본 값
function bestPlace(m: Mind, type: number, side: number, reach: Int32Array): [number, number, number, number] {
  const w = m.world;
  const ai = w.data.mapAi;
  const moveType = w.data.natials[type - 1].moveType;
  let best = NONE;
  let bx = 0;
  let by = 0;
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const c = y * 32 + x;
      if (!stoppableFor(w, moveType, x, y) || reach[c] === 0) continue;
      const v = Math.imul((Math.imul(ai.value[type * CELLS + c], 0x10) + ai.penalty[type * CELLS + c]) | 0, reach[c]);
      if (best < v) {
        bx = x;
        by = y;
        best = v;
      }
    }
  }
  return best === NONE ? [0, 0, 0, 0] : placeValue(m, type, bx, by, side);
}

/** vmv2.exe 0x004491d8: 마스터 차례에 소환 값을 두어 본 결과·같은 종류 수·속성별 유지 MP·난수로 고친다 */
export function adjustSummons(m: Mind, u: SimUnit): void {
  const w = m.world;
  const side = u.side;
  const list = w.sides[side].natials;
  const count = new Int32Array(25);
  const element = new Int32Array(5);
  for (const t of w.units) {
    if (!t || !t.natial || t.side !== side) continue;
    count[t.type]++;
    element[t.element] += sar(summonMp(w, t.type), 3);
  }
  playAhead(m);
  settleAfterPlay(m, u);
  const reach = reachMap(m, u);
  w.time = (w.time + 0xf0) % DAY;
  for (const type of list) {
    let [a, b, c, d] = bestPlace(m, type, side, reach);
    const sv = valueAt(m, side, type);
    a = (a + idiv(sv, 6)) | 0;
    b = (idiv(b, 2) + sar(sv, 3)) | 0;
    c = idiv(Math.imul(Math.imul(sv, c), 4), 0x3840);
    d = (idiv(d << 1, 3) + sar(sv, 2)) | 0;
    if (a < b) a = b;
    if (c < d) c = d;
    m.summonValue[side * 25 + type] = c < a ? (a + idiv(c, 2)) | 0 : (idiv(a, 2) + c) | 0;
  }
  w.restore();
  const factor = Array.from(count, (n) => i32At(w, COUNT_FACTOR + n * 4));
  const upkeep = w.sideStates[side].upkeep;
  const share = Array.from(element, (e) => (sar(upkeep, 2) < e ? idiv(0x380 - idiv(e << 9, upkeep), 3) : 0x100));
  for (const type of list) {
    const i = side * 25 + type;
    m.summonValue[i] = sar(Math.imul(m.summonValue[i], factor[type]), 8);
    m.summonValue[i] = sar(Math.imul(m.summonValue[i], share[w.data.natials[type - 1].element]), 8);
  }
  for (const type of list) {
    const i = side * 25 + type;
    m.summonValue[i] = idiv(Math.imul(m.summonValue[i], (m.rand() % 500) + 800), 1000);
  }
}

/** vmv2.exe 0x0044a149: type을 (x, y)에 소환하는 값 */
export function summonAtValue(m: Mind, u: SimUnit, type: number, x: number, y: number): number {
  const cost = summonMp(m.world, type);
  const ai = m.world.data.mapAi;
  const i = type * CELLS + y * 32 + x;
  return (idiv(Math.imul(valueAt(m, u.side, type) + spendValue(m, u.side, cost, sar(cost, 3)), ai.value[i]), 0x300) + ai.penalty[i] + nearRivals(m, u.side, x, y)) | 0;
}

/** vmv2.exe 0x00449e53: 자기 칸 마법(범위 종류 5)의 값. 물높이 마법은 맵이 허락할 때만, 축복은 회복할 네이티얼이 있을 때만 */
export function selfSpellValue(m: Mind, u: SimUnit, n: number): number {
  const a = m.action(n);
  const base = spendValue(m, u.side, a.mpCost, 0);
  let sum = 0;
  if (a.kind === WATER) {
    const s = m.world.data.map.struct;
    if (new DataView(s.buffer, s.byteOffset, s.byteLength).getInt32(WATER_MAP, true) === 0) return NONE;
  } else if (a.kind === BLESS) {
    for (const t of m.world.units) if (t && t.side === u.side && t.natial) sum = (sum + hpValue(m, u, t, -1)) | 0;
    if (sum === 0) return NONE;
  }
  return (base - 10000 + sum) | 0;
}
