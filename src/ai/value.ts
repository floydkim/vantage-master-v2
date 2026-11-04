// CPU AI의 값 매기기 함수. 정수 계산은 원작 i32 그대로(곱은 Math.imul, 나눗셈은 0 쪽 자름).
import { damage, statusMinutesOf } from '../engine/rules/combat.ts';
import { oaCost } from '../engine/rules/oaCost.ts';
import { type Ground, hexDistance, inArea, inRange, type Sight } from '../engine/rules/range.ts';
import { GRID } from '../engine/rules/terrain.ts';
import { idiv, type Mind, sar } from './mind.ts';
import type { SimUnit, World } from './world.ts';

const CURVE = 0x45f68c;
const HEAL_CURVE = 0x45f6a0;
const RANGE_FACTOR = 0x4754b0; // [범위 종류]
const AREA_FACTOR = 0x4754c8; // [효과 반경]
const GUARD = 0x4754d4; // [방어 + 마법방어/2 등]
const HEAL = 1;
const STATUS = 2;
const CURE = 3;
const STONE = 0x80;
const MAX_HP = 10;

export const i32At = (w: World, va: number): number => w.data.combat.i32At(va);
const imul = Math.imul;

export const oaOf = (w: World, speed: number, moved: boolean, action: number): number => oaCost(w.data.oa, speed, moved, action); // 0x4113da

export const ground = (w: World): Ground<Sight> => ({ map: w.data.map, grid: w.grid, state: w });

export const distance = (u: SimUnit, x: number, y: number): number => hexDistance(u.x, u.y, x, y); // 0x410055

/** 소환 MP(표 +0x00) */
export const summonMp = (w: World, type: number): number => {
  const t = w.data.natials[type - 1];
  if (!t) throw new RangeError(`네이티얼 종류 ${type}이 표에 없습니다`);
  return t.summonMp;
};

// vmv2.exe 0x00411450: 회복량
export const healAmount = (m: Mind, u: SimUnit, n: number): number => i32At(m.world, HEAL_CURVE + (u.magic + m.action(n).power) * 4) + 0x7f;

// vmv2.exe 0x00411371: 방어 0으로 본 데미지
function bareDamage(m: Mind, u: SimUnit, n: number): number {
  const a = m.action(n);
  const base = a.sub === 0 ? u.attack : u.magic;
  return i32At(m.world, CURVE + (base + a.power + 7) * 4) + 0x7f;
}

// vmv2.exe 0x004112e9: 방향 보정 +5로 본 데미지
function previewDamage(m: Mind, u: SimUnit, n: number, t: SimUnit): number {
  const a = m.action(n);
  const d = a.sub === 0 ? u.attack - t.defense : u.magic - t.magicDefense;
  return i32At(m.world, CURVE + (d + a.power + m.world.data.combat.damageAffinity[u.element * 5 + t.element] + 5) * 4) + 0x7f;
}

export const statusMinutes = (m: Mind, u: SimUnit, n: number): number => statusMinutesOf(m.world.data.combat, u, m.action(n)); // 0x411425

// vmv2.exe 0x0044b194: 상태 이상 값
function statusValue(m: Mind, u: SimUnit, n: number): number {
  const t = statusMinutes(m, u, n);
  const v = t < 0x78 ? idiv(imul(t, 0x500), 0x78) : idiv(imul(t * 4 - 0x1e0, 0x100), 0x78) + 0x500;
  return idiv(imul(v, m.rivalScores[u.side]), 0x18);
}

// vmv2.exe 0x0044b73c: MP를 쓰는 값(비용 0이면 0)
function mpCost(m: Mind, side: number, cost: number): number {
  if (cost === 0) return 0;
  const income = m.world.income(side);
  if (income < 1) return -200000;
  const st = m.world.sideStates[side];
  return imul(imul(cost, -0x78), idiv(m.world.sides[side].maxMp - (st.mp - cost), income));
}

// vmv2.exe 0x0044b616: MP를 쓰는 값. upkeep은 정각마다 늘어나는 유지 MP
export function spendValue(m: Mind, side: number, cost: number, upkeep: number): number {
  if (cost < 1) return 0;
  const income = m.world.income(side) - upkeep;
  if (income < 1) return -100000;
  const left = m.world.sideStates[side].mp - cost;
  if (left >= m.reserveMp[side]) return imul(upkeep, -300);
  let r = idiv(m.reserveMp[side] - left, income);
  const spell = m.spellMp[side];
  if (left < spell) {
    const short = spell - left;
    r += idiv(imul(imul(imul(short, short), 0x3c - (m.world.time % 0x3c)), 0x19), imul(imul(spell, 0x1e), spell));
  }
  return imul(imul(cost, -0x78), r) + imul(upkeep, -300);
}

// 유닛이 가진 마법 가운데 종류가 kind인 것이 있는지
const hasKind = (m: Mind, u: SimUnit, kind: number): boolean => u.spells.some((s) => m.action(s).kind === kind);

// vmv2.exe 0x00448628: u가 행동 n으로 t를 상대할 때의 값
export function actionValue(m: Mind, u: SimUnit, n: number, t: SimUnit): number {
  const a = m.action(n);
  let c: number;
  switch (a.kind) {
    case 0:
      c = previewDamage(m, u, n, t);
      break;
    case HEAL:
      if (hasKind(m, t, STATUS)) return 0;
      c = healAmount(m, u, n);
      break;
    case STATUS:
      c = statusValue(m, u, n);
      break;
    case CURE:
      if (!hasKind(m, t, STATUS)) return 0;
      c = statusValue(m, u, n);
      break;
    default:
      throw new Error(`행동 ${n}(종류 ${a.kind})의 값은 원작이 정하지 않은 값을 읽습니다(0x448628)`);
  }
  c = sar(imul(sar(imul(c, i32At(m.world, RANGE_FACTOR + a.rangeKind * 4)), 8), a.range + 7), 3);
  if (a.rangeKind === 1 && t.height < u.height) {
    const h = t.height + 8 < u.height ? 8 : u.height - t.height;
    c = sar(imul(h + 8, c), 3);
  }
  const area = i32At(m.world, AREA_FACTOR + a.areaRadius * 4);
  const oa = oaCost(m.world.data.oa, u.speed, true, n);
  c = (imul(idiv(imul(sar(imul(c, area), 8), 0x3c), oa), t.w60) + imul(mpCost(m, u.side, a.mpCost) + imul(a.mpCost, -600), 0x100)) | 0;
  return c < 0 ? 0 : c;
}

// vmv2.exe 0x004488c5: 상대 없이 본 행동 값(공격·상태 이상)
export function bareValue(m: Mind, u: SimUnit, n: number): number {
  const a = m.action(n);
  let c: number;
  if (a.kind === 0) c = bareDamage(m, u, n);
  else if (a.kind === STATUS) c = statusValue(m, u, n);
  else throw new Error(`행동 ${n}(종류 ${a.kind})의 값은 원작이 정하지 않은 값을 읽습니다(0x4488c5)`);
  c = sar(imul(a.range + 7, sar(imul(c, i32At(m.world, RANGE_FACTOR + a.rangeKind * 4)), 8)), 3);
  if (a.rangeKind === 1) c = sar(imul(c, 9), 3);
  const area = i32At(m.world, AREA_FACTOR + a.areaRadius * 4);
  const oa = oaCost(m.world.data.oa, u.speed, true, n);
  c = (imul(idiv(imul(sar(imul(c, area), 8), 0x3c), oa), 0x9c4) + imul(mpCost(m, u.side, a.mpCost) + imul(a.mpCost, -600), 0x100)) | 0;
  return c < 0 ? 0 : c;
}

// vmv2.exe 0x00448a2c: 상대 네이티얼들에게 t가 받을 위협
export function threatTo(m: Mind, t: SimUnit): number {
  let sum = 0;
  let weights = 0;
  for (const u of m.world.units) {
    if (!u || u.temp || u.side === t.side || !u.natial) continue;
    let best = actionValue(m, u, t.attackAction, t); // 원작은 t의 공격 행동 번호를 쓴다
    for (const s of u.spells) best = Math.max(best, actionValue(m, u, s, t));
    sum = (sum + best) | 0;
    weights = (weights + u.w60) | 0;
  }
  const guard = t.magicDefense < t.defense ? idiv(t.defense, 2) + t.magicDefense : t.defense + idiv(t.magicDefense, 2);
  sum = (sum + imul(i32At(m.world, GUARD + guard * 4), 4000)) | 0;
  if (sum < 0) sum = 0x7fffffff;
  return idiv(sum, weights + 4000);
}

// vmv2.exe 0x00449a10: 상대 유닛 평균 좌표에 가까울수록 큰 값
export function nearRivals(m: Mind, side: number, x: number, y: number): number {
  let dx = (y & 1) + x * 2 - m.rivalCenter[side].x;
  let dy = y * 2 - m.rivalCenter[side].y;
  if (dx > 0) dx = -dx;
  if (dy > 0) dy = -dy;
  return dx + 0x40 + dy;
}

// vmv2.exe 0x004462ad: 진영 마스터에서 떨어진 정도
export const fromMaster = (m: Mind, side: number, x: number, y: number): number => distance(m.world.master(side), x, y) * 0x29a + 0x3415;

/** 칸의 작업 격자 부품 +0x63 & 0x80(마정석) */
export const isStone = (w: World, x: number, y: number): boolean => (w.part(x, y, 0x63) & STONE) !== 0;

// vmv2.exe 0x0044af92: t의 HP가 dealt만큼 바뀌는 값(같은 진영이면 부호를 바꾼다)
export function hpValue(m: Mind, u: SimUnit, t: SimUnit, dealt: number): number {
  let p = dealt;
  let left: number;
  if (p < 0) {
    left = t.hp;
    if (left === MAX_HP) return 0;
    if (t.hp - p > MAX_HP) p = t.hp - MAX_HP;
  } else {
    if (p === 0) return 0;
    left = t.hp - p;
    if (t.hp - p < 1) {
      left = 0;
      p = t.natial ? t.hp + 3 : t.hp + 0x14;
    }
  }
  if (!isStone(m.world, t.x, t.y)) left = idiv(imul(imul(p, t.w60), 0xf), left + 5);
  else if (left === 9) left = sar(imul(p, t.w60), 2);
  else if (p < 0) {
    if (left - p === MAX_HP) left = idiv(imul(sar(imul(p * 4 + 1, t.w60), 2), 0xf), left + 5);
    else left = idiv(imul(imul(p, t.w60), 0xf), left + 5);
  } else {
    left = (idiv(imul(imul(p, t.w60), 0xf), left + 5) + idiv(imul(fromMaster(m, t.side, t.x, t.y), p - 1), 10)) | 0;
  }
  const r = idiv(imul(left, 0x1e), t.statusMinutes + 0x1e);
  return u.side === t.side ? -r : r;
}

// vmv2.exe 0x0044ace9: u가 (x, y)에서 행동 n을 t에게 쓴 값
export function hitValue(m: Mind, u: SimUnit, n: number, x: number, y: number, t: SimUnit): number {
  const a = m.action(n);
  switch (a.kind) {
    case 0:
    case HEAL:
      return hpValue(m, u, t, damage(m.world.data.combat, m.world.data.map, m.world.grid, u, a, x, y, t));
    case STATUS: {
      let c = statusMinutes(m, u, n);
      if (t.statusMinutes > 0) c = t.statusMinutes < c ? idiv(imul(c - t.statusMinutes, 0xe10), imul(t.statusMinutes, t.statusMinutes) + 0xe10) : 0;
      if (c > 100) c = idiv(c - 100, 2) + 100;
      return sideScale(m, u, t, idiv(imul(imul(c, t.w60), t.hp * 2 + 10), 900));
    }
    case CURE: {
      const v = sideScale(m, u, t, idiv(imul(imul(t.statusMinutes, t.w60), t.hp * 2 + 10), 900));
      return idiv(v << 8, 0xc0);
    }
    default:
      return 0;
  }
}

// 0x44ace9 상태 이상·풀기 공통: 마스터 대상은 진영 점수 제곱, 마스터가 쓰면 거리만큼 더함
function sideScale(m: Mind, u: SimUnit, t: SimUnit, v: number): number {
  const score = m.scores[t.side];
  if (t.natial) return idiv(imul(v, score), 0x18);
  let r = idiv(imul(imul(v, score), score), 400);
  if (!u.natial) r = (r + sar(imul(distance(u, t.x, t.y), r), 4)) | 0;
  return r;
}

// vmv2.exe 0x00410e3d
export function canTarget(m: Mind, u: SimUnit, n: number, t: SimUnit): boolean {
  const a = m.action(n);
  const ally = a.kind === HEAL || a.kind === CURE;
  if (ally !== (u.side === t.side)) return false;
  return inRange(ground(m.world), u.x, u.y, a, t.x, t.y);
}

// vmv2.exe 0x004034e0: 지형 종류 0x10·10·11이 아닌 칸
export const openCell = (w: World, x: number, y: number): boolean => {
  const k = w.part(x, y, 0x62);
  return k !== 0x10 && k !== 10 && k !== 11;
};

export const inAreaOf = (m: Mind, n: number, x: number, y: number, tx: number, ty: number): boolean => inArea(ground(m.world), m.action(n), x, y, tx, ty); // 0x410d77
export const inRangeOf = (m: Mind, x: number, y: number, n: number, tx: number, ty: number): boolean => inRange(ground(m.world), x, y, m.action(n), tx, ty); // 0x41074b

/** 그 종류의 이동 타입이 칸 지형에 멈출 수 있는지(0x473fa0) */
export const stoppableFor = (w: World, moveType: number, x: number, y: number): boolean =>
  w.data.terrain.stoppable[moveType * 17 + w.part(x, y, 0x62)];

// vmv2.exe 0x004126d7: 소환할 수 있는 칸(이동 타입이 멈출 수 있고, 주체 위치 객체 높이와 차가 1 이하, 빈 칸)
export function canSummonAt(m: Mind, u: SimUnit, type: number, x: number, y: number): boolean {
  const t = m.world.data.natials[type - 1];
  if (!t) throw new RangeError(`네이티얼 종류 ${type}이 표에 없습니다`);
  if (!stoppableFor(m.world, t.moveType, x, y)) return false;
  const h = m.world.cellHeight(x, y);
  if (u.height > h + 1 || u.height < h - 1) return false;
  return !m.world.unitAt(x, y);
}

/** 칸 번호 */
export const cell = (x: number, y: number): number => y * GRID + x;
