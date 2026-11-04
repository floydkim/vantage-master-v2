// 전장 창이 보이는 부분(전장 DIB 픽셀 좌표)과 차례 시작 화면 이동. 원작 창은 1560 × 1008 DIB의 일부를 보낸다.
import { cdiv } from '../../engine/rules/cint.ts';
import type { Cell } from '../../engine/command.ts';
import { GRID, partByte } from '../../engine/rules/terrain.ts';
import type { GameMap } from '../../formats/mapData.ts';
import { FIELD_H, FIELD_W } from './raster.ts';
import { CHIP_H, CHIP_W } from './sheet.ts';

export interface Viewport {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

const STEP = 0x30;

/** vmv2.exe 0x004165bb의 목표: 전장 픽셀 (x, y)를 창 가운데로, 전장 안으로 자른다(0x4147b3이 연출 객체에 둔 점). 창이 전장보다 넓으면(x /2) 0
 *  (원작 순서대로 자르면 음수가 되어 스크롤이 닿지 못해 이동이 끝나지 않는다) */
export function centerOn(x: number, y: number, vp: Viewport): { left: number; top: number } {
  const clamp = (v: number, max: number) => Math.max(Math.min(v, max), 0);
  return { left: clamp(x - cdiv(vp.width, 2), FIELD_W - vp.width), top: clamp(y - cdiv(vp.height, 2), FIELD_H - vp.height) };
}

/** vmv2.exe 0x0040646b: 칸 둘레 반경 r(칩 2r)의 전장 픽셀 상자, 전장 안으로 자른다 */
export function cellBox(map: GameMap, grid: Uint16Array, c: Cell, r: number): { left: number; top: number; right: number; bottom: number } {
  const cx = (c.y & 1) + c.x * 2;
  const cy = c.y * 2 + 0x17 - partByte(map, grid[c.y * GRID + c.x], 0x61);
  return {
    left: Math.max(cx - r * 2, 0) * CHIP_W,
    right: Math.min(cx + 2 + r * 2, 0x41) * CHIP_W,
    top: Math.max(cy - 5 - r * 2, 0) * CHIP_H,
    bottom: Math.min(cy + 1 + r * 2, 0x54) * CHIP_H,
  };
}

/**
 * CPU 명령 화면 확인(0x406ad9): 칸 상자(반경 check)가 창 안이면 null. 아니면 반경 around 상자를 보이게 하는 창 가운데(0x406b3a → 0x4147b3, centerOn이 자름).
 * 이동 전(0x406573)은 도착 칸·반경 0(대기) 또는 1, around 2. 행동 전(0x4067b1)은 대상 칸·효과 반경, around 효과 반경 + 1:
 * 창이 상자보다 작으면 상자 가운데, 상자가 창 앞쪽 밖이면 상자 앞 끝 + 창 반, 뒤쪽 밖이면 상자 뒤 끝 − 창 반, 아니면 창 가운데(그 축은 그대로)
 */
export function revealTarget(map: GameMap, grid: Uint16Array, c: Cell, check: number, vp: Viewport, around = 2): { x: number; y: number } | null {
  const right = vp.left + vp.width;
  const bottom = vp.top + vp.height;
  const v = cellBox(map, grid, c, check);
  if (v.left >= vp.left && v.top >= vp.top && v.right <= right && v.bottom <= bottom) return null;
  const b = cellBox(map, grid, c, around);
  const axis = (lo: number, hi: number, from: number, to: number, size: number) =>
    size < hi - lo ? cdiv(lo + hi, 2) : lo < from ? lo + cdiv(size, 2) : to < hi ? hi - cdiv(size, 2) : cdiv(from + to, 2);
  return { x: axis(b.left, b.right, vp.left, right, vp.width), y: axis(b.top, b.bottom, vp.top, bottom, vp.height) };
}

/** 화면 이동 한 단계(vmv2.exe 0x004165bb): 가로를 최대 48px 옮기고, 가로가 맞으면 세로를 최대 48px */
export function scrollStep(vp: Viewport, target: { readonly left: number; readonly top: number }): Viewport {
  let { left, top } = vp;
  if (left < target.left) {
    if (left + STEP < target.left) return { ...vp, left: left + STEP };
    left = target.left;
  }
  if (target.left < left) {
    if (target.left < left - STEP) return { ...vp, left: left - STEP };
    left = target.left;
  }
  if (top < target.top) {
    if (top + STEP < target.top) return { ...vp, left, top: top + STEP };
    top = target.top;
  }
  if (target.top < top) {
    if (target.top < top - STEP) return { ...vp, left, top: top - STEP };
    top = target.top;
  }
  return { ...vp, left, top };
}

/** vmv2.exe 0x00442aea: 내용 크기가 from → to로 바뀌면 스크롤 위치도 비례(왼쪽 위 기준, C 나눗셈) */
export const scaleScroll = (pos: number, from: number, to: number): number => Math.trunc((pos * to) / from);
