// 사거리와 시야. vmv2.exe 0x0041074b(행동 사거리), 0x0040ffcd(육각 거리), 0x0041090b(직선 시야), 0x004100f8(포물선 시야),
// 0x00410d77(범위 안). 높이는 작업 격자 부품 +0x61. 포물선 계산(0x410499, 0x410646)은 x87 53비트 정밀도 = JS double이고,
// 원작이 float32로 저장하는 곳마다 Math.fround를 둔다.
import type { Action } from '../../formats/actionTable.ts';
import type { GameMap } from '../../formats/mapData.ts';
import type { GameState } from '../state.ts';
import { cdiv, ftol } from './cint.ts';
import { GRID, partByte } from './terrain.ts';

const STEP_X2 = [-2, -1, 1, 2, 1, -1]; // 0x45f5a8: 2배 x 좌표(x × 2 + (y & 1)) 변화
const STEP_Y = [0, -1, -1, 0, 1, 1]; // 0x45f5c0
const BLOCKING = 0x10; // 지형 종류: 늘 가림
const SEE_THROUGH = 0x0b; // 지형 종류: 늘 안 가림
const f32 = Math.fround;

/** 가림 판정(0x40ff5c)이 보는 유닛 위치. CPU AI는 시뮬레이션 유닛 표를 넘긴다 */
export interface Sight {
  readonly units: readonly ({ readonly x: number; readonly y: number } | null)[];
}

export interface Ground<S extends Sight = GameState> {
  readonly map: GameMap;
  readonly grid: Uint16Array;
  readonly state: S;
}

const height = (g: Ground<Sight>, x: number, y: number) => partByte(g.map, g.grid[y * GRID + x], 0x61);
const kind = (g: Ground<Sight>, x: number, y: number) => partByte(g.map, g.grid[y * GRID + x], 0x62);
const unitAt = (g: Ground<Sight>, x: number, y: number) => g.state.units.some((u) => u && u.x === x && u.y === y); // 0x40ff5c

// vmv2.exe 0x0040ffcd
export function hexDistance(x1: number, y1: number, x2: number, y2: number): number {
  const dy = Math.abs(y2 - y1);
  const dx = x1 < x2 ? x2 - x1 - ((dy + (y1 & 1)) >> 1) : x1 - x2 - ((dy + ((y1 & 1) ^ 1)) >> 1);
  return Math.max(dx, 0) + dy;
}

/** 두 칸 사이 육각 선 위 칸마다 blocked(x, y, 총 걸음, 지금 걸음)를 묻는다. 가리는 칸이 있으면 false (0x41090b·0x4100f8 공통) */
function lineClear(x: number, y: number, tx: number, ty: number, blocked: (x: number, y: number, n: number, s: number) => boolean): boolean {
  let ax = (y & 1) + x * 2;
  let ay = y;
  const bx = (ty & 1) + tx * 2;
  let dir: number;
  if (ay < ty) dir = ty - bx < ay - ax ? 3 : ty + bx < ay + ax ? 5 : 4;
  else dir = ay - ax < ty - bx ? 0 : ay + ax < ty + bx ? 2 : 1;
  const side = (dir + 2) % 6;
  const n = cdiv((bx - ax) * STEP_Y[side] - (ty - ay) * STEP_X2[side], STEP_X2[dir] * STEP_Y[side] - STEP_Y[dir] * STEP_X2[side]);
  const m = cdiv((bx - ax) * STEP_Y[dir] - (ty - ay) * STEP_X2[dir], STEP_Y[dir] * STEP_X2[side] - STEP_X2[dir] * STEP_Y[side]);
  const at = (k: number, s: number) => {
    const cy = ay + STEP_Y[side] * k;
    return blocked((ax + STEP_X2[side] * k - (cy & 1)) >> 1, cy, n, s);
  };
  for (let s = 1; s < n; s++) {
    ax += STEP_X2[dir];
    ay += STEP_Y[dir];
    if (((m * s * 2) % n === 0) && (m * s) % n !== 0) {
      const k = cdiv(m * s, n);
      if (at(k, s) || at(k + 1, s)) return false;
    } else if (at(cdiv(cdiv(n, 2) + m * s, n), s)) return false;
  }
  return true;
}

// vmv2.exe 0x0041090b(+ 가림 0x00410cb8): 높이를 직선으로 보간해 칸 높이와 비교. extra는 보간 높이에 더하는 여유
export function straightSight(g: Ground<Sight>, x: number, y: number, h: number, tx: number, ty: number, th: number, range: number, extra: number, ignoreUnits: boolean): boolean {
  const d = hexDistance(x, y, tx, ty);
  if (range < d + cdiv(Math.abs(th - h), 2)) return false;
  if (d < 2) return true;
  return lineClear(x, y, tx, ty, (cx, cy, n, s) => {
    const k = kind(g, cx, cy);
    if (k === BLOCKING) return true;
    if (k === SEE_THROUGH) return false;
    const hh = cdiv(h * (n - s) + th * s, n) + extra;
    const ch = height(g, cx, cy);
    if (hh < ch) return true;
    return !ignoreUnits && hh < ch + 4 && unitAt(g, cx, cy);
  });
}

// vmv2.exe 0x00410499: 포물선의 계수. 좌표는 2배 x
function trajectory(ax2: number, ay: number, ah: number, bx2: number, by: number, bh: number, arc: number) {
  let l24 = f32(arc * arc);
  const dx = (bx2 - ax2) * 0x18;
  const dyi = ftol(((by - ay) << 1) * 0xc * f32(1.7320499420166016));
  const dh = (bh - ah) * 0xc;
  const d2 = (Math.imul(dx, dx) + Math.imul(dyi, dyi)) | 0;
  if (d2 === 0) return { d2, a: 0, b: 0, h0: ah * 12 };
  const fc = f32(dh * dh + d2);
  const st = l24 - dh * f32(1.2);
  let l28 = f32(st);
  let disc = st * l28 - f32(1.44) * fc;
  if (disc < 0) {
    const t30 = f32(dh * f32(1.2));
    l24 = f32(Math.sqrt(fc) * f32(1.2) + t30);
    l28 = f32(l24 - dh * f32(1.2));
    disc = 0;
  }
  const a = f32(((Math.sqrt(disc) + l28) * f32(d2)) / (2 * fc));
  let b = f32(Math.sqrt(l24 - a));
  if (d2 < (dh * -2 * l24) / f32(1.2)) b = -b;
  return { d2, a, b, h0: ah * 12 };
}

// vmv2.exe 0x004100f8(+ 0x00410499, 가림 0x00410646): 사거리 + 높이 차/2(부호 그대로)를 보고 포물선으로 가림을 본다
export function arcSight(g: Ground<Sight>, x: number, y: number, h: number, action: Action, tx: number, ty: number, th: number): boolean {
  const d = hexDistance(x, y, tx, ty);
  if (action.range < d + cdiv(th - h, 2)) return false;
  if (d < 2) return true;
  const t = trajectory((y & 1) + x * 2, y, h, (ty & 1) + tx * 2, ty, th, action.arcHeight);
  return lineClear(x, y, tx, ty, (cx, cy, n, s) => {
    const k = kind(g, cx, cy);
    if (k === BLOCKING) return true;
    if (k === SEE_THROUGH) return false;
    const q = Math.imul(Math.imul(t.d2, s), s) / (Math.imul(n, n) * t.a);
    const hh = ftol(f32(-0.6000000238418579) * f32(q) + t.b * f32(Math.sqrt(q))) + t.h0;
    const at = cdiv(hh, 12) + 2;
    const ch = height(g, cx, cy);
    if (ch > at) return true;
    return ch + 4 > at && unitAt(g, cx, cy);
  });
}

// vmv2.exe 0x0041074b: 행동의 범위 종류(+0x08)에 따라 (x, y)에서 (tx, ty)에 닿는지
export function inRange(g: Ground<Sight>, x: number, y: number, action: Action, tx: number, ty: number): boolean {
  const h = height(g, x, y);
  const th = height(g, tx, ty);
  switch (action.rangeKind) {
    case 0:
    case 3:
      return hexDistance(x, y, tx, ty) + cdiv(Math.abs(th - h), 2) <= action.range;
    case 1:
      return arcSight(g, x, y, h, action, tx, ty, th);
    case 2:
      return straightSight(g, x, y, h, tx, ty, th, action.range, 2, false);
    default:
      return false;
  }
}

// vmv2.exe 0x00410d77: 지정 칸 (x, y)를 중심으로 한 효과 범위(반경 = 행동 +0x0a)에 (tx, ty)가 드는지
export function inArea(g: Ground<Sight>, action: Action, x: number, y: number, tx: number, ty: number): boolean {
  if (x === tx && y === ty) return action.rangeKind !== 4;
  return straightSight(g, x, y, height(g, x, y), tx, ty, height(g, tx, ty), action.areaRadius, 1, true);
}
