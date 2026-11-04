// 전장 칸·방향 판정. 좌표는 확대 1 픽셀(전장 DIB, 칩 24 × 12). 원작 창 처리기(0x40f231 등)가 DPtoLP 뒤 이 좌표로 맞춘다.
import type { Cell } from '../../engine/command.ts';
import { cdiv } from '../../engine/rules/cint.ts';
import { GRID, partByte } from '../../engine/rules/terrain.ts';
import type { GameMap } from '../../formats/mapData.ts';
import { CHIP_H, CHIP_W } from './sheet.ts';

const NOT_CELLS = [0x10, 0xa, 0xb];

/** 고를 수 있는 칸인지: 지형 종류(부품 +0x62)가 0x10·0xa·0xb가 아니다 (vmv2.exe 0x004034e0) */
export const isCell = (map: GameMap, grid: Uint16Array, x: number, y: number): boolean =>
  !NOT_CELLS.includes(partByte(map, grid[y * GRID + x], 0x62));

/** 픽셀이 가리키는 칸. 지형 목록(0x43be78)과 같은 차례로 칸 줄을 위에서 내려가며 칸 윗면·앞면을 본다 (vmv2.exe 0x004031c5) */
export function cellAt(map: GameMap, grid: Uint16Array, px: number, py: number): Cell | null {
  const chipX = cdiv(px, CHIP_W);
  const chipY = cdiv(py, CHIP_H);
  const inX = px % CHIP_W;
  const inY = py % CHIP_H;
  let row = 0x17 - (chipY & 1);
  let top = cdiv(chipY + 0x18, 2);
  const bottom = Math.max(cdiv(chipY, 2), 0xb);
  if (top > 0x2b) {
    row -= top * 2 - 0x56;
    top = 0x2b;
  }
  for (; bottom < top; row -= 2, top--) {
    const y = top - 0xc;
    const x = (y & 1) === 0 ? cdiv(chipX, 2) : cdiv(chipX + 1, 2) - 1;
    if (x < 0 || x >= GRID || !isCell(map, grid, x, y)) continue;
    const h = partByte(map, grid[y * GRID + x], 0x60);
    if (h > row) continue;
    // 칩 안의 경사: 칸 줄과 칩 x의 홀짝에 따라 왼쪽이 높거나 오른쪽이 높다
    const rising = ((y + chipX) & 1) === 0;
    const edge = (flip: boolean) => CHIP_H - cdiv(flip ? 0x17 - inX : inX, 3);
    if (row === h && inY < edge(rising)) return { x, y }; // 윗면 위쪽 삼각형
    if (row === h + 1) return { x, y };
    if (row === h + 2 && inY >= edge(!rising)) return { x, y }; // 윗면 아래쪽 삼각형
  }
  return null;
}

/** 칸 (x, y)에서 픽셀 쪽 방향 0~5: 중심에서 좌우와 기울기 1/3 두 선으로 나눈다 (vmv2.exe 0x004033ee) */
export function directionAt(map: GameMap, grid: Uint16Array, px: number, py: number, x: number, y: number): number {
  const h = partByte(map, grid[y * GRID + x], 0x61);
  const cx = ((y & 1) + 1 + x * 2) * CHIP_W;
  const cy = (y * 2 + 0x18 - h) * CHIP_H - 0x10;
  if (px < cx) {
    const d = cdiv(cx - px, 3);
    return py < cy - d ? 1 : py < cy + d ? 0 : 5;
  }
  const d = cdiv(px - cx, 3);
  return py < cy - d ? 2 : py < cy + d ? 3 : 4;
}
