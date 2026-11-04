// CPU AI의 앞날 두어 보기. vmv2.exe 0x00447458(기록대로 행동, 연출 없음), 0x00447a15(시간 진행), 0x004470cd(대기 방향),
// 0x0044717e(행동한 뒤 차례들을 두어 본 점수), 0x0044a20c(45분 두어 보기). 세계를 바꾸므로 부르는 쪽이 0x44bb31로 되돌린다.
import { cappedExp, damage, damageExp, statusExp } from '../engine/rules/combat.ts';
import { applyWaterLevel } from '../engine/rules/time.ts';
import { facing } from '../engine/turn.ts';
import {
  AHEAD,
  DIRECTION,
  idiv,
  KIND,
  type Mind,
  NONE,
  NUMBER,
  sar,
  TARGET_X,
  TARGET_Y,
  TOTAL,
  X,
  Y,
} from './mind.ts';
import { evaluate, stepN } from './search.ts';
import { hpValue, inAreaOf, isStone, nearRivals, oaOf, statusMinutes, stoppableFor, summonMp } from './value.ts';
import type { SimUnit } from './world.ts';

const SELF = 5;
const WATER = 4;
const BLESS = 5;
const STATUS = 2;
const CURE = 3;
const HAZARD = 5; // 지형 종류 5: 차례 시작마다 HP −3
const STATUS_BITS = [1, 2, 4];
const MAX_WAIT = 0xb40;
const DAY = 0x5a0;

// vmv2.exe 0x00403a62: HP를 n만큼 깎아 0~10으로 자르고 0이 되었는지
export function hurt(u: SimUnit, n: number): boolean {
  u.hp -= n;
  if (u.hp < 0) u.hp = 0;
  else if (u.hp > 10) u.hp = 10;
  return u.hp === 0;
}

// vmv2.exe 0x004128c8: 마스터는 OA = 1440, 네이티얼은 뒤 소환 순번을 당기고 진영 수·유지 MP를 줄여 칸을 비운다
export function remove(m: Mind, u: SimUnit): void {
  const w = m.world;
  if (!u.natial) {
    u.oa = DAY;
    return;
  }
  for (const v of w.units) if (v && u.summonOrder < v.summonOrder) v.summonOrder--;
  w.sideStates[u.side].unitCount--;
  w.sideStates[u.side].upkeep -= sar(summonMp(w, u.type), 3);
  const i = w.units.indexOf(u);
  if (i < 0) throw new Error('이미 비운 칸의 유닛을 다시 없앱니다(원작은 해제한 레코드를 씀)');
  w.units[i] = null;
}

// vmv2.exe 0x004255d0·0x004255ff
function changeWater(m: Mind, up: boolean): void {
  const w = m.world;
  if (up ? w.waterLevel < 1 : w.waterLevel > -1) {
    w.waterLevel += up ? 1 : -1;
    w.rebuildGrid();
  }
}

// vmv2.exe 0x0042562e(+ 0x417bed) 뒤 0x00440210
function settleWater(m: Mind): void {
  const w = m.world;
  const s = applyWaterLevel(w.waterLevel);
  if (s) {
    w.waterStage = s.waterStage;
    w.waterMinutes = s.waterMinutes;
  }
  w.refreshPositions();
  w.rebuildGraphs();
}

// vmv2.exe 0x00401401: 마정석 칸이면 점령(같은 진영 것이어도 배수 −1 +1)
function capture(m: Mind, x: number, y: number, side: number): void {
  const w = m.world;
  if (!isStone(w, x, y)) return;
  const stone = w.stones.find((s) => s.x === x && s.y === y);
  if (!stone) throw new Error(`(${x}, ${y})에 마정석이 없습니다(원작은 목록 밖을 읽음)`);
  if (stone.owner !== 0) w.sideStates[stone.owner - 1].mpMultiplier--;
  w.sideStates[side].mpMultiplier++;
  w.setStoneOwner(stone, side + 1);
}

const faceTarget = (u: SimUnit, tx: number, ty: number): void => {
  u.direction = facing(u.direction, u.x, u.y, tx, ty); // 0x41798c
};

// vmv2.exe 0x0040f910: 마스터 u가 (x, y)에 네이티얼을 소환한다
function summon(m: Mind, u: SimUnit, type: number, x: number, y: number): void {
  const w = m.world;
  const v = w.allocate(w.newNatial(type, u.side));
  v.summonOrder = (w.sideStates[0].unitCount + w.sideStates[1].unitCount) & 0xff;
  w.refreshStats(v);
  v.x = x;
  v.y = y;
  w.updatePosition(v);
  v.direction = u.direction;
  v.oa = oaOf(w, v.speed, true, 0);
  w.sideStates[v.side].unitCount++;
  w.sideStates[v.side].upkeep += sar(summonMp(w, type), 3);
}

// vmv2.exe 0x00412cc9: 경험치를 더하고 100마다 레벨 +1(능력치 다시), 최대 레벨이면 100
function addExp(m: Mind, u: SimUnit, gain: number): void {
  u.exp += gain;
  while (u.exp >= 100) {
    if (u.level > 1) {
      u.exp = 100;
      return;
    }
    u.level++;
    u.exp -= 100;
    m.world.refreshStats(u);
  }
}

/** vmv2.exe 0x00447458: 기록(rec[at..])대로 유닛 u가 움직이고 행동한다 */
export function execute(m: Mind, u: SimUnit, rec: Int32Array, at: number): void {
  const w = m.world;
  const tables = w.data.combat;
  const moved = !(u.x === rec[at + X] && u.y === rec[at + Y]);
  u.x = rec[at + X] & 0xff;
  u.y = rec[at + Y] & 0xff;
  w.updatePosition(u);
  let gain = 0;
  const n = rec[at + NUMBER];
  const kind = rec[at + KIND];
  const tx = rec[at + TARGET_X];
  const ty = rec[at + TARGET_Y];
  const face = () => {
    if (rec[at + X] === tx && rec[at + Y] === ty) u.direction = rec[at + DIRECTION] & 0xff;
    else faceTarget(u, tx, ty);
  };
  if (kind === 0) {
    u.direction = rec[at + DIRECTION] & 0xff;
    u.oa = oaOf(w, u.speed, moved, 0);
  } else if (kind === 1) {
    const a = m.action(n);
    if (a.rangeKind === SELF) {
      u.direction = rec[at + DIRECTION] & 0xff;
      if (a.kind === WATER) {
        changeWater(m, a.sub === 0);
        settleWater(m);
      } else if (a.kind === BLESS) {
        for (const v of w.units) if (v && v.side === u.side && v.natial) hurt(v, -1);
      }
    } else if (a.areaRadius === 0) {
      const t = w.unitAt(tx, ty);
      face();
      if (!t) throw new Error(`(${tx}, ${ty})에 대상이 없습니다(원작은 널 포인터를 읽음)`);
      if (a.kind === STATUS) {
        const minutes = statusMinutes(m, u, n);
        if (t.statusMinutes <= minutes) {
          gain = statusExp(tables, u, t, minutes);
          t.status = (t.status & 0xfff8) | (STATUS_BITS[a.sub] ?? 0);
          t.statusMinutes = minutes;
        }
      } else if (a.kind === CURE) {
        gain = statusExp(tables, u, t, 0);
        t.status &= 0xfff8;
        t.statusMinutes = 0;
      } else {
        const d = damage(tables, w.data.map, w.grid, u, a, tx, ty, t);
        gain = damageExp(tables, u, t, d);
        if (hurt(t, d)) remove(m, t);
      }
    } else {
      face();
      for (const t of [...w.units]) {
        if (!t || !w.units.includes(t) || !inAreaOf(m, n, tx, ty, t.x, t.y)) continue;
        const d = damage(tables, w.data.map, w.grid, u, a, tx, ty, t);
        gain += damageExp(tables, u, t, d);
        if (hurt(t, d)) remove(m, t);
      }
    }
    w.sideStates[u.side].mp -= a.mpCost;
    u.oa = oaOf(w, u.speed, moved, n);
  } else if (kind === 2) {
    faceTarget(u, tx, ty);
    summon(m, u, n, tx & 0xff, ty & 0xff);
    w.sideStates[u.side].mp -= summonMp(w, n);
    u.oa = oaOf(w, u.speed, moved, 1);
  }
  if (gain !== 0) {
    addExp(m, u, cappedExp(u.exp, gain));
    if (u.natial) u.w60 = u.w64 << u.level; // 0x4460db
  }
  if (w.units.includes(u)) capture(m, u.x, u.y, u.side);
}

/** vmv2.exe 0x00447a15: minutes만큼 시간을 보낸다. MP가 모자라 네이티얼을 없앴으면 true */
export function passTime(m: Mind, minutes: number): boolean {
  const w = m.world;
  let deficit = false;
  for (const u of w.units) {
    if (!u) continue;
    if (u.statusMinutes < 1) u.oa -= minutes;
    else if (minutes < u.statusMinutes) u.statusMinutes -= minutes;
    else {
      u.oa -= minutes - u.statusMinutes;
      u.statusMinutes = 0;
      u.status &= 0xfff8;
    }
  }
  for (let h = idiv(w.time + minutes, 0x3c) - idiv(w.time, 0x3c); h > 0; h--) {
    for (let side = 0; side < 2; side++) {
      const st = w.sideStates[side];
      st.mp += w.income(side);
      if (st.mp < 0) {
        while (st.mp < 0) {
          let victim: SimUnit | null = null;
          let order = 0x32;
          for (const u of w.units) {
            if (u && u.side === side && u.natial && u.summonOrder < order) {
              order = u.summonOrder;
              victim = u;
            }
          }
          if (!victim) throw new Error('MP가 모자란데 없앨 네이티얼이 없습니다(원작은 정하지 않은 유닛을 씀)');
          remove(m, victim);
          st.mp += sar(summonMp(w, victim.type), 3);
        }
        deficit = true;
        st.mp = 0;
      } else if (w.sides[side].maxMp < st.mp) st.mp = w.sides[side].maxMp;
    }
  }
  const before = w.light();
  w.time = (w.time + minutes) % DAY;
  const light = w.light();
  if (before !== light) for (const u of w.units) if (u && u.lightPreference !== 0) w.refreshStats(u, light);
  // vmv2.exe 0x00425755
  if (w.waterMinutes !== 0) {
    if (minutes < w.waterMinutes) w.waterMinutes -= minutes;
    else {
      w.waterMinutes = 0;
      if (w.waterStage === 0) changeWater(m, true);
      else if (w.waterStage === 2) changeWater(m, false);
      settleWater(m);
    }
  }
  return deficit;
}

// vmv2.exe 0x004129fb
function nextActor(m: Mind): { unit: SimUnit; wait: number } {
  let best: SimUnit | null = null;
  let wait = MAX_WAIT;
  for (const u of m.world.units) {
    if (!u) continue;
    const v = u.oa + u.statusMinutes;
    if (v > wait) continue;
    if (v === wait) {
      if (!best) throw new Error(`대기 시간이 ${MAX_WAIT}분인 유닛을 비교할 수 없습니다(원작은 널 포인터를 읽음)`);
      if (u.summonOrder > best.summonOrder) continue;
    }
    best = u;
    wait = v;
  }
  if (!best) throw new Error(`차례를 받을 유닛이 없습니다(모든 유닛의 대기 시간이 ${MAX_WAIT}분 이상)`);
  return { unit: best, wait };
}

// vmv2.exe 0x00449a77: 방향 d로 6칸(밖이면 1칸, 그래도 밖이면 제자리)의 상대 쪽 값
function directionValue(m: Mind, side: number, x: number, y: number, d: number): number {
  const c = stepN(m, x, y, d, 6) ?? stepN(m, x, y, d, 1) ?? { x, y };
  return idiv(nearRivals(m, side, c.x, c.y), 6);
}

/** vmv2.exe 0x004470cd: 대기(또는 자기 칸 행동)면 상대 쪽 값이 가장 큰 방향 */
export function faceRivals(m: Mind, u: SimUnit, rec: Int32Array, at: number): void {
  const kind = rec[at + KIND];
  const self = rec[at + X] === rec[at + TARGET_X] && rec[at + Y] === rec[at + TARGET_Y];
  if (!(kind === 0 || (kind === 1 && (m.action(rec[at + NUMBER]).rangeKind === SELF || self)))) return;
  let best = NONE;
  let dir = 0;
  for (let d = 0; d < 6; d++) {
    const v = directionValue(m, u.side, rec[at + X], rec[at + Y], d);
    if (best < v) {
      dir = d;
      best = v;
    }
  }
  rec[at + DIRECTION] = dir;
}

// 차례 시작 지형 효과(0x40546d와 같은 식): 종류 5면 3, 마정석이면 −1, 멈출 수 없는 지형이면 +3
function hazardOf(m: Mind, v: SimUnit): number {
  const w = m.world;
  let hz = w.part(v.x, v.y, 0x62) === HAZARD ? 3 : 0;
  if (isStone(w, v.x, v.y)) hz--;
  if (!stoppableFor(w, v.moveType, v.x, v.y)) hz += 3;
  return hz;
}

/** vmv2.exe 0x0044717e: 주체가 기록대로 행동한 뒤 2시간 안팎의 차례들을 두어 본 점수를 rec 합계에 더한다 */
export function lookAhead(m: Mind, actor: SimUnit, rec: Int32Array, at: number): void {
  execute(m, actor, rec, at);
  let limit = oaOf(m.world, actor.speed, true, 1);
  if (!actor.natial && limit < 0x3c) limit = 0x3c;
  if (limit > 0x78) limit = 0x78;
  let gain = 0;
  const spent = { t: 0 };
  let f = 0;
  for (;;) {
    let v: SimUnit | null = null;
    for (;;) {
      const next = nextActor(m);
      spent.t += next.wait;
      if (limit < spent.t) break;
      f = idiv(spent.t * -0xc0, 0x78) + 0xc0;
      const hz = hazardOf(m, next.unit);
      if (hz !== 0) {
        gain = (gain + sar(Math.imul(hpValue(m, actor, next.unit, hz), f), 8)) | 0;
        if (hurt(next.unit, hz)) remove(m, next.unit);
      }
      passTime(m, next.wait);
      if (m.world.units.includes(next.unit) && next.unit.oa === 0) {
        v = next.unit;
        break;
      }
    }
    if (!v) break;
    const index = m.world.units.indexOf(v);
    const best = evaluate(m, index, true);
    let s = m.arena[best + TOTAL];
    if (actor.side !== v.side) s = -s | 0;
    if (s > 60000) s = sar(s - 60000, 2) + 60000;
    gain = (gain + sar(Math.imul(s, f), 8)) | 0;
    faceRivals(m, v, m.arena, best);
    execute(m, v, m.arena, best);
  }
  rec[at + TOTAL] = (rec[at + TOTAL] + gain) | 0;
  rec[at + AHEAD] = gain;
}

/** vmv2.exe 0x0044a20c: 45분 동안의 차례를 두어 본다(점수 없음) */
export function playAhead(m: Mind): void {
  let left = 0x2d;
  for (;;) {
    if (left < 0) return;
    let v: SimUnit | null = null;
    for (;;) {
      const next = nextActor(m);
      left -= next.wait;
      if (left < 0) return;
      const hz = hazardOf(m, next.unit);
      if (hz !== 0 && hurt(next.unit, hz)) remove(m, next.unit);
      passTime(m, next.wait);
      if (m.world.units.includes(next.unit) && next.unit.oa === 0) {
        v = next.unit;
        break;
      }
    }
    const best = evaluate(m, m.world.units.indexOf(v), true);
    faceRivals(m, v, m.arena, best);
    execute(m, v, m.arena, best);
  }
}
