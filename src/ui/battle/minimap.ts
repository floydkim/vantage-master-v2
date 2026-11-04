// 미니맵(Battle view window, 260 × 168 = 전장 1560 × 1008의 1/6). 전투 시작(0x40d4f3)에 칩 시트를 반으로 줄여(0x4232a9) 칩마다 8색을
// 표본으로 두고(0x40d53d), 칸마다 부품의 칩 겹을 칩당 4 × 2px로 그린다(0x40d5ca·0x40d695). 창은 그 위에 유닛 표식(0x40e0ec)과
// 전장 창의 보이는 사각형(0x40dc9d, 펜 0xb·0xa)을 그린다
import { GRID, partByte } from '../../engine/rules/terrain.ts';
import type { GameState } from '../../engine/state.ts';
import type { ExeImage } from '../../formats/exeImage.ts';
import type { GameMap } from '../../formats/mapData.ts';
import { CHIP, CHIP_W, TRANSPARENT } from './sheet.ts';

export const MINIMAP_W = 260;
export const MINIMAP_H = 168;
const CLASSES = 0x46205c; // 색 번호 → 색 부류(u8 256)
const RANGES = 0x46215c; // 부류 → 찾을 색 번호 범위 시작(i32, 끝 = 다음 시작)
const TERRAIN_CHIPS = 0x400;
const HALF = CHIP / 4; // 12 × 6
// 0x423651: 표본 i와 평균의 거리 × 개수(제곱합)
const scaled = (rgb: (i: number, c: number) => number, i: number, n: number, sum: readonly number[]) =>
  [0, 1, 2].reduce((a, c) => a + (rgb(i, c) * n - sum[c]) ** 2, 0);
const DITHER = [[0, 1, 2, 3], [1, 0, 3, 2], [2, 3, 0, 1], [3, 2, 1, 0]]; // [줄 홀짝 × 2 + 칸 홀짝]
const EMPTY = 0x7ff;
const BACKGROUND = 10;

/** 색 부류 표와 부류별 색 범위: exe 자료를 맵 구조체 +0x40(맵 색 수)으로 고친다(vmv2.exe 0x004231af) */
export type ShrinkTables = { readonly classes: Uint8Array; readonly ranges: Int32Array };

export function shrinkTables(exe: ExeImage, map: GameMap): ShrinkTables {
  const classes = exe.read(CLASSES, 256).slice();
  const max = Math.max(...classes);
  const v = new DataView(exe.read(RANGES, (max + 2) * 4).buffer);
  const ranges = Int32Array.from({ length: max + 2 }, (_, i) => v.getInt32(i * 4, true));
  const colors = new DataView(map.struct.buffer, map.struct.byteOffset).getInt32(0x40, true);
  let i = 0x11;
  for (; i < colors + 0x10; i++) classes[i] = 2;
  for (; i < 0x3c; i++) classes[i] = 3;
  ranges[3] = colors + 0x10;
  ranges[8] = colors + 0x80;
  return { classes, ranges };
}

/**
 * vmv2.exe 0x004232a9: 칩 first부터 count개(24 × 12)를 12 × 6으로 줄여 out에 쓴다. 2 × 2 칸 넷이 모두 불투명이면 색 부류 다수결(같으면 앞 것),
 * 부류 1이면 투명(0x10), 아니면 그 부류 칸들의 평균색에 가장 가까운 칸, 그 차이(제곱합)가 0xfff를 넘으면 부류의 색 범위에서 더 가까운 색
 * (0x1000 아래면 거기서 멈춤). 하나라도 0이면 out을 그대로 둔다. palette는 LOGPALETTE 항목(R, G, B, 플래그) 256개.
 * sky면 하늘 판(0x00423651): 받을 줄·칸의 홀짝으로 2 × 2 칸을 읽는 차례를 뒤집고(같은 수일 때 고르는 칸이 바뀐다), 넷의 거리는 평균을 버리지 않고
 * 개수배로 재서 가장 작은 값을 개수²로 나눈 것을 0xfff와 비교한다
 */
export function shrinkChips(chips: Uint8Array, first: number, count: number, palette: Uint8Array, t: ShrinkTables, out: Uint8Array, sky = false): void {
  let s = first * CHIP;
  let o = 0;
  const rgb = (i: number, c: number) => palette[i * 4 + c];
  for (let row = 0; row < count * 6; row++) {
    for (let col = 0; col < 12; col++, s += 2, o++) {
      const q = [chips[s], chips[s + 1], chips[s + CHIP_W], chips[s + CHIP_W + 1]];
      const p = sky ? DITHER[(row & 1) * 2 + (col & 1)].map((i) => q[i]) : q;
      if (p.some((v) => v === 0)) continue;
      const k = p.map((v) => t.classes[v]);
      const counts = new Map<number, number>();
      let lead = k[0];
      counts.set(lead, 1);
      for (let i = 1; i < 4; i++) {
        counts.set(k[i], (counts.get(k[i]) ?? 0) + 1);
        if (counts.get(lead)! < counts.get(k[i])!) lead = k[i];
      }
      if (lead === 1) {
        out[o] = TRANSPARENT;
        continue;
      }
      const n = counts.get(lead)!;
      const sum = [0, 0, 0];
      for (let i = 0; i < 4; i++) if (k[i] === lead) for (let c = 0; c < 3; c++) sum[c] += rgb(p[i], c);
      const mean = sum.map((v) => Math.trunc(v / n));
      const dist = (i: number) => {
        const d0 = rgb(i, 0) - mean[0];
        const d1 = rgb(i, 1) - mean[1];
        const d2 = rgb(i, 2) - mean[2];
        return d0 * d0 + d1 * d1 + d2 * d2;
      };
      let best = 2000000000;
      let pick = 0;
      for (let i = 0; i < 4; i++) {
        if (k[i] !== lead) continue;
        const d = sky ? scaled(rgb, p[i], n, sum) : dist(p[i]);
        if (d < best) {
          pick = p[i];
          best = d;
        }
      }
      if (sky) best = Math.trunc(best / (n * n));
      if (best > 0xfff) {
        for (let c = t.ranges[lead]; c < t.ranges[lead + 1]; c++) {
          const d = dist(c);
          if (d < best) {
            pick = c;
            best = d;
            if (d < 0x1000) break;
          }
        }
      }
      out[o] = pick;
    }
    s += CHIP_W;
  }
}

/** vmv2.exe 0x0040d53d: 지형 칩 0x400개를 줄인 그림에서 칩마다 8색(12 × 6의 (0·3·6·9, 0)·(…, 3)) */
export function minimapSamples(chips: Uint8Array, palette: Uint8Array, t: ReturnType<typeof shrinkTables>, scratch = new Uint8Array(TERRAIN_CHIPS * HALF)): Uint8Array {
  shrinkChips(chips, 0, TERRAIN_CHIPS, palette, t, scratch);
  const samples = new Uint8Array(TERRAIN_CHIPS * 2 * 4);
  for (let e = 0; e < TERRAIN_CHIPS * 2; e++) for (let k = 0; k < 4; k++) samples[e * 4 + k] = scratch[e * 0x24 + k * 3];
  return samples;
}

/** vmv2.exe 0x0040d5ca: 칸 (x, y)마다 부품의 칩 겹(24단 × 2칸)을 (8x + 4(y & 1), 4y + 46)부터 위로 칩당 4 × 2px */
export function minimapTerrain(map: GameMap, grid: Uint16Array, samples: Uint8Array): Uint8Array {
  const out = new Uint8Array(MINIMAP_W * MINIMAP_H).fill(BACKGROUND);
  const parts = new DataView(map.parts.buffer, map.parts.byteOffset);
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      const part = grid[y * GRID + x];
      let at = (y & 1 ? 4 : 0) + (y * 8 + 0x5c) * (MINIMAP_W / 2) + x * 8;
      for (let r = 0; r < 0x18; r++) {
        for (let c = 0; c < 2; c++, at += 4) {
          const chip = parts.getUint16(part * 100 + (r + c * 0x18) * 2, true);
          if (chip === EMPTY) continue;
          for (let row = 0; row < 2; row++) {
            for (let col = 0; col < 4; col++) {
              const v = samples[chip * 8 + col + row * 4];
              if (v !== TRANSPARENT) out[at + row * MINIMAP_W + col] = v;
            }
          }
        }
        at += r === 0x12 && partByte(map, part, 99) & 1 ? 0x2488 : -0x210; // 두 칸 위로, 덮개 부품은 18단에서 36줄 아래로
      }
    }
  }
  return out;
}

/** vmv2.exe 0x0040d977: 유닛 표식 목록(유닛 표 차례): 칩 좌표 (2x + (y & 1), 2y + 0x17 − 칸 높이)와 진영 */
export function minimapMarks(map: GameMap, grid: Uint16Array, state: GameState): { x: number; y: number; side: number }[] {
  return state.units.flatMap((u) => (u ? [{ x: (u.y & 1) + u.x * 2, y: u.y * 2 + 0x17 - partByte(map, grid[u.y * GRID + u.x], 0x61), side: u.side }] : []));
}

/** 미니맵 창 그림(0x40dc9d): 지형 버퍼에 유닛 표식(0x40e0ec)과 보이는 사각형(전장 픽셀 / 6, 펜 0xb 안쪽·0xa 바깥) */
export function drawMinimap(terrain: Uint8Array, marks: readonly { x: number; y: number; side: number }[], view: { left: number; top: number; right: number; bottom: number } | null): Uint8Array {
  const out = terrain.slice();
  const put = (x: number, y: number, v: number) => {
    if (x >= 0 && y >= 0 && x < MINIMAP_W && y < MINIMAP_H) out[y * MINIMAP_W + x] = v;
  };
  for (const m of marks) {
    const x0 = m.x * 4 + 1;
    const y0 = m.y * 2;
    const c = m.side !== 0 ? 0x75 : 0x79;
    for (let r = 0; r < 4; r++) {
      put(x0, y0 - r, 0xb);
      put(x0 + 5, y0 - r, 0xb);
    }
    for (let k = 1; k <= 4; k++) {
      put(x0 + k, y0 + 1, 0xb);
      for (let r = 0; r < 4; r++) put(x0 + k, y0 - r, c);
      put(x0 + k, y0 - 4, 0xb);
    }
  }
  if (view) {
    const l = Math.trunc(view.left / 6);
    const t = Math.trunc(view.top / 6);
    const r = Math.trunc(view.right / 6);
    const b = Math.trunc(view.bottom / 6);
    if (r - l > 0) {
      // MoveToEx·LineTo: 축에 나란한 선, 끝점은 그리지 않는다
      const path = (v: number, ...p: number[]) => {
        for (let i = 2; i < p.length; i += 2) {
          const [x0, y0, x1, y1] = [p[i - 2], p[i - 1], p[i], p[i + 1]];
          for (let x = x0, y = y0; x !== x1 || y !== y1; x += Math.sign(x1 - x0), y += Math.sign(y1 - y0)) put(x, y, v);
        }
      };
      path(0xb, l, t, r - 1, t, r - 1, b - 1, l, b - 1, l, t);
      path(0xa, l, t - 1, r, t - 1);
      path(0xa, r, t, r, b);
      path(0xa, r - 1, b, l - 1, b);
      path(0xa, l - 1, b - 1, l - 1, t - 1);
    }
  }
  return out;
}

