// CPU 결정. vmv2.exe 0x00446434(표준 ver.2.0: 이번 차례 칸마다 점수를 매겨 위 후보들을 앞날까지 두어 보고 고름)와
// 0x004462ef(No Guard 네이티얼: 칸 점수만으로 고름). 결정은 Mind.decision(0x4cd868)에 남는다.
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
  X,
  Y,
} from './mind.ts';
import { bestSummon, countReserveMp, countSpellMp, evaluate, locateRivals, pathValue, rankSummons } from './search.ts';
import { faceRivals, lookAhead } from './simulate.ts';
import { adjustSummons, placeValue, selfSpellValue, summonAtValue, valueSummons } from './summons.ts';
import { canSummonAt, distance, isStone } from './value.ts';

const STAND_BY = 0;
const ACT = 1;
const SUMMON = 2;
const SELF = 5;
const SURE = 0x1f20c; // 1위 후보의 행동 점수가 이보다 크면 앞날을 두어 보지 않는다
const WEAK = 2000;

const copy = (from: Int32Array, at: number, to: Int32Array, toAt: number) => to.set(from.subarray(at, at + RECORD), toAt);

// 주체 방향을 난수로 돌린다(0x446434·0x4462ef 공통)
function shuffleDirection(m: Mind): void {
  m.actor.direction = (m.actor.direction + (m.rand() % 6)) % 6;
}

/** vmv2.exe 0x00446434 */
export function decideStandard(m: Mind): void {
  const w = m.world;
  const u = m.actor;
  const A = m.arena;
  const D = m.decision;
  for (let side = 0; side < 2; side++) {
    countSpellMp(m, side);
    countReserveMp(m, side);
    valueSummons(m, side);
    locateRivals(m, side);
  }
  w.restore();
  if (!u.natial) adjustSummons(m, u);
  shuffleDirection(m);
  evaluate(m, m.actorIndex, false);
  const path = pathValue(m, u);
  const C = m.candidates;
  const limit = m.candidateLimit;
  const keys = new Int32Array(limit + 2);
  let count = 0;
  for (let i = 0; i < CELLS; i++) {
    const at = i * RECORD;
    const x = A[at + X];
    const y = A[at + Y];
    if (m.rangeByte(x, y, 0x1e) !== 1) continue;
    const r = m.rand() & 0xf;
    A[at + TOTAL] = (A[at + TOTAL] + A[at + AHEAD] + r) | 0;
    let key = (A[at + TOTAL] + (isStone(w, x, y) ? 5000 : 0) + w.cellHeight(x, y) * 8 + (100 - w.data.combat.terrainDefense[w.part(x, y, 0x62)]) * 10) | 0;
    if (u.x === x && u.y === y) {
      A[at + TOTAL] = (A[at + TOTAL] + sar(path, 7)) | 0;
      key += 5000;
    }
    if (u.natial) {
      const master = w.master(u.side);
      if (distance(master, x, y) < 2) {
        const mh = w.cellHeight(master.x, master.y);
        const h = w.cellHeight(x, y);
        if (h <= mh + 2 && mh - 2 <= h) key += 3000;
      }
    }
    if ((x & y & 1) !== 0) key += 0x24;
    let j = count;
    if (count < limit) count++;
    for (; j > 0 && keys[j] < key; j--) {
      if (j < limit) {
        copy(A, C + (j - 1) * RECORD, A, C + j * RECORD);
        keys[j + 1] = keys[j];
      }
    }
    if (j < limit) {
      copy(A, at, A, C + j * RECORD);
      keys[j + 1] = key;
    }
  }
  if (!(A[C + SCORE] < SURE)) {
    copy(A, C, D, 0);
    return;
  }
  const better = () => {
    if (D[TOTAL] < A[C + TOTAL]) copy(A, C, D, 0);
  };
  D[TOTAL] = NONE;
  for (let i = 0; i < count; i++) {
    w.restore();
    const at = C + i * RECORD;
    faceRivals(m, u, A, at);
    lookAhead(m, u, A, at);
    if (D[TOTAL] < A[at + TOTAL]) copy(A, at, D, 0);
  }
  D[TOTAL] = (D[SCORE] + D[AHEAD]) | 0;
  const side = u.side;
  if (D[KIND] === SUMMON) {
    w.restore();
    const sx = u.x;
    const sy = u.y;
    let best = Math.max(...placeValue(m, D[NUMBER], D[TARGET_X], D[TARGET_Y], side));
    D[SCORE] = ((m.rand() & 1) + D[SCORE] + sar(best, 6)) | 0;
    D[TOTAL] = (D[SCORE] + D[AHEAD]) | 0;
    copy(D, 0, A, C);
    const tx = A[C + TARGET_X];
    const ty = A[C + TARGET_Y];
    const moveActor = (x: number, y: number) => {
      u.x = x & 0xff;
      u.y = y & 0xff;
      w.updatePosition(u);
    };
    moveActor(A[C + X], A[C + Y]);
    const t = w.data.terrain;
    for (let d = 0; d < 6; d++) {
      let nx = A[C + X] + t.stepX[(A[C + Y] & 1) * 6 + d];
      const ny = A[C + Y] + t.stepY[d];
      if (nx < 0 || nx > 31 || ny < 0 || ny > 31) nx = -1; // 0x440e21
      A[C + TARGET_X] = nx;
      A[C + TARGET_Y] = ny;
      if (nx === -1 || (nx === tx && ny === ty) || !canSummonAt(m, u, A[C + NUMBER], nx, ny)) continue;
      best = Math.max(...placeValue(m, A[C + NUMBER], nx, ny, side));
      const v = summonAtValue(m, u, A[C + NUMBER], nx, ny);
      A[C + SCORE] = (v + sar(best, 6) + (m.rand() & 1)) | 0;
      A[C + TOTAL] = A[C + SCORE];
      moveActor(sx, sy);
      lookAhead(m, u, A, C);
      w.restore();
      moveActor(A[C + X], A[C + Y]);
      better();
    }
    copy(D, 0, A, C);
    const st = w.sideStates[side];
    const mp = st.mp;
    st.mp = (st.mp + w.income(side)) | 0;
    if (st.mp <= w.sides[side].maxMp) {
      rankSummons(m, side);
      const v = bestSummon(m, u, { type: 0, x: 0, y: 0 });
      A[C + SCORE] = idiv(Math.imul(v, st.unitCount), 0x18);
      A[C + TOTAL] = A[C + SCORE];
      moveActor(sx, sy);
      st.mp = mp;
      A[C + KIND] = STAND_BY;
      lookAhead(m, u, A, C);
      better();
    }
  }
  for (let i = 0; i < u.spells.length; i++) {
    const s = u.spells[i];
    if (m.action(s).rangeKind !== SELF) continue;
    w.restore();
    if (w.sideStates[side].mp < m.action(s).mpCost) continue;
    copy(D, 0, A, C);
    const v = selfSpellValue(m, u, s);
    A[C + SCORE] = v;
    A[C + TOTAL] = v;
    if (NONE < A[C + TOTAL]) {
      A[C + KIND] = ACT;
      A[C + NUMBER] = s;
      lookAhead(m, u, A, C);
      better();
    }
  }
  if (D[KIND] !== STAND_BY && D[KIND] !== SUMMON && D[SCORE] < WEAK) {
    w.restore();
    copy(D, 0, A, C);
    A[C + SCORE] = 0;
    A[C + TOTAL] = 0;
    A[C + KIND] = STAND_BY;
    lookAhead(m, u, A, C);
    better();
  }
  if (D[KIND] === STAND_BY || (D[KIND] === ACT && (m.action(D[NUMBER]).rangeKind === SELF || (D[X] === D[TARGET_X] && D[Y] === D[TARGET_Y])))) {
    copy(D, 0, A, C);
    const base = D[DIRECTION];
    for (let k = 1; k < 6; k++) {
      A[C + DIRECTION] = (base + k) % 6;
      A[C + TOTAL] = A[C + SCORE];
      w.restore();
      lookAhead(m, u, A, C);
      better();
    }
  }
}

/** vmv2.exe 0x004462ef */
export function decideNoGuard(m: Mind): void {
  const A = m.arena;
  const D = m.decision;
  for (let side = 0; side < 2; side++) {
    countSpellMp(m, side);
    countReserveMp(m, side);
    locateRivals(m, side);
  }
  m.world.restore();
  shuffleDirection(m);
  evaluate(m, m.actorIndex, false);
  pathValue(m, m.actor);
  D[TOTAL] = NONE;
  for (let i = 0; i < CELLS; i++) {
    const at = i * RECORD;
    if (m.rangeByte(A[at + X], A[at + Y], 0x1e) !== 1) continue;
    const r = m.rand() & 0xf;
    A[at + TOTAL] = (A[at + TOTAL] + A[at + AHEAD] + r) | 0;
    if (D[TOTAL] < A[at + TOTAL]) copy(A, at, D, 0);
  }
}
