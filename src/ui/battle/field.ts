// 전장 화면 칩(65 × 84)마다 그릴 겹 목록. 원작은 칩마다 연결 목록을 깊이 내림차순으로 두고(0x43e05b), 앞 겹이 이긴다.
// 지형은 물 애니메이션 프레임(0~3)마다 미리 짓고(0x43b8a8 → 0x43be78), 그릴 때마다 어둡게 하기·하늘·표시 객체를 더한다(0x43d636).
import type { GameMap } from '../../formats/mapData.ts';
import { GRID } from '../../engine/rules/terrain.ts';
import { type BattleSheet, DARK, SKY, type Sky } from './sheet.ts';

export const CHIPS_X = 0x41;
export const CHIPS_Y = 0x54;
const NONE = 0x7ff;
const SKY_ROWS = 20;
const SKY_STRIDE = 0x80;
const SKY_FRAME = 0x1400 / 2;

export interface Layer {
  readonly chip: number;
  readonly depth: number;
  /** 어둡게 하기 판정에 쓰는 맵 칸 */
  readonly cellX: number;
  readonly cellY: number;
  /** 색 바꿈 표 번호(0x473bb4) */
  readonly tint: number;
  /** 가림 무늬 번호 + 1(0이면 없음, 0x473cec) */
  readonly mask: number;
  readonly dx: number;
  readonly dy: number;
}

export type Lists = Layer[][];

/** vmv2.exe 0x0043e05b: 깊이가 더 큰 겹들 뒤, 같거나 작은 겹들 앞에 넣는다 */
export function addLayer(list: Layer[], layer: Layer): void {
  let i = 0;
  while (i < list.length && layer.depth < list[i].depth) i++;
  list.splice(i, 0, layer);
}

const layer = (chip: number, depth: number, cellX: number, cellY: number): Layer => ({ chip, depth, cellX, cellY, tint: 0, mask: 0, dx: 0, dy: 0 });

// vmv2.exe 0x0043c1e1: 새 칩이 아직 안 가린 픽셀을 가리면 1. cover.open은 가릴 곳이 남았는지(0이면 다 가림)
function covers(sheet: BattleSheet, chip: number, acc: Uint32Array, cover: { open: number }): boolean {
  const m = sheet.masks.subarray(chip * 9, chip * 9 + 9);
  if (cover.open === 0) {
    acc.set(m);
    for (let i = 0; i < 9; i++) {
      if (acc[i] !== 0xffffffff) {
        cover.open = 1;
        return true;
      }
    }
    return true;
  }
  cover.open = 0;
  let i = 0;
  let v = 0;
  for (; ; i++) {
    if (i > 8) return false;
    v = (acc[i] | m[i]) >>> 0;
    if (v !== 0xffffffff) cover.open = 1;
    if (acc[i] !== v) break;
  }
  acc[i] = v;
  if (v !== 0xffffffff) cover.open = 1;
  i++;
  if (cover.open === 1) {
    for (; i < 9; i++) acc[i] = (acc[i] | m[i]) >>> 0;
  } else {
    for (; i < 9; i++) {
      acc[i] = (acc[i] | m[i]) >>> 0;
      if (acc[i] !== 0xffffffff) cover.open = 1;
    }
  }
  return true;
}

const cmod2 = (v: number) => v % 2; // C의 % 2(음수면 음수)

const LAST_WATER_FRAME = 3;

/** 물 프레임 frame의 지형 겹 목록과, 하늘이 쓰는 다 가려지지 않은 칩 표시(0x48f6c8). 원작은 프레임 0~3을 차례로 지어(0x43b8a8)
 *  표시는 마지막 프레임 것이 남는다 */
export function terrainLists(sheet: BattleSheet, map: GameMap, grid: Uint16Array, frame: number): { lists: Lists; open: Uint8Array } {
  const built = buildFrame(sheet, map, grid, frame);
  return { lists: built.lists, open: frame === LAST_WATER_FRAME ? built.open : buildFrame(sheet, map, grid, LAST_WATER_FRAME).open };
}

// vmv2.exe 0x0043be78를 모든 화면 칩에
function buildFrame(sheet: BattleSheet, map: GameMap, grid: Uint16Array, frame: number): { lists: Lists; open: Uint8Array } {
  const lists: Lists = Array.from({ length: CHIPS_X * CHIPS_Y }, () => []);
  const open = new Uint8Array(CHIPS_X * CHIPS_Y);
  const parts = map.parts;
  const word = (part: number, k: number) => parts[part * 100 + k * 2] | (parts[part * 100 + k * 2 + 1] << 8);
  for (let y = 0; y < CHIPS_Y; y++) {
    for (let x = 0; x < CHIPS_X; x++) {
      const list = lists[y * CHIPS_X + x];
      const acc = new Uint32Array(9);
      const cover = { open: 0 };
      let uncovered = 1;
      let row = 0x17 - cmod2(y);
      let top = ((y + 0x18) / 2) | 0;
      const bottom = Math.max((y / 2) | 0, 0xb);
      if (0x2b < top) {
        row -= top * 2 - 0x56;
        top = 0x2b;
      }
      let cy = top - 0xc;
      for (;;) {
        if (top <= bottom) break;
        const cx = cmod2(cy) === 0 ? (x / 2) | 0 : (((x + 1) / 2) | 0) - 1;
        top--;
        if (cx >= 0 && cx < GRID) {
          let part = grid[cy * GRID + cx];
          if (parts[part * 100 + 0x63] & 2) part = (part + frame) % 0x200;
          if (row <= sheet.partTops[part]) {
            const h = parts[part * 100 + 0x61];
            const col = cmod2(cy + x) * 0x18 + row;
            const upper = (parts[part * 100 + 0x63] & 1) !== 0;
            let chip: number;
            if (upper && row < h + 5 && h <= row && (chip = word(part, col + 0x13 - h)) !== NONE) {
              if (covers(sheet, chip, acc, cover)) addLayer(list, layer(chip, row * 0x1b + 0x19, cx, cy));
              if (cover.open === 0) {
                uncovered = 0;
                break;
              }
            }
            if ((row < 0x13 || !upper) && (chip = word(part, col)) !== NONE) {
              if (covers(sheet, chip, acc, cover)) {
                const depth = row < h ? row * 0x1b : row === h || row === h + 1 ? h * 0x1b + 1 : (row - 2) * 0x1b + 0x1a;
                addLayer(list, layer(chip, depth, cx, cy));
              }
              if (cover.open === 0) {
                uncovered = 0;
                break;
              }
            }
          }
        }
        row -= 2;
        cy--;
      }
      open[y * CHIPS_X + x] = uncovered;
    }
  }
  return { lists, open };
}

/** 어두운 칸의 지형 칩을 어두운 판(+0x400)으로. 하늘·표시 객체를 넣기 전에 (vmv2.exe 0x0043d636) */
export function dimTerrain(lists: Lists, dark: (x: number, y: number) => boolean): void {
  for (const list of lists) {
    for (let i = 0; i < list.length; i++) if (dark(list[i].cellX, list[i].cellY)) list[i] = { ...list[i], chip: list[i].chip + DARK };
  }
}

/** 하늘 움직임(0x48f664 스크롤, 0x49df44 틱 수, 0x48e650 프레임 차례) */
export interface SkyMotion {
  readonly scroll: readonly number[];
  readonly ticks: readonly number[];
  readonly at: number;
}

export const SKY_START: SkyMotion = { scroll: new Array(SKY_ROWS).fill(0), ticks: new Array(SKY_ROWS).fill(0), at: 0 };

/** vmv2.exe 0x0043d535: 타이머 한 번(애니메이션 옵션 비트 1일 때, 0x403020) */
export function skyTick(sky: Sky, m: SkyMotion): SkyMotion {
  const scroll = [...m.scroll];
  const ticks = m.ticks.map((t, r) => {
    if (t + 1 < sky.periods[r]) return t + 1;
    const wrap = sky.lengths[r] * 0x18;
    scroll[r] = (scroll[r] + sky.steps[r] + wrap) % wrap;
    return 0;
  });
  return { scroll, ticks, at: (m.at + 1) % sky.frames.length };
}

/** vmv2.exe 0x0043d913: 위 20줄의 다 가려지지 않은 칩에 하늘 칩 */
export function addSky(sheet: BattleSheet, lists: Lists, open: Uint8Array, motion: SkyMotion): void {
  const { layout, lengths } = sheet.sky;
  const frame = sheet.sky.frames[motion.at];
  const scroll = motion.scroll;
  for (let r = 0; r < SKY_ROWS; r++) {
    const sub = scroll[r] % 0x18;
    const base = ((scroll[r] / 0x18) | 0);
    for (let x = 0; x < CHIPS_X; x++) {
      if (!open[r * CHIPS_X + x]) continue;
      const list = lists[r * CHIPS_X + x];
      const at = (i: number) => layout[frame * SKY_FRAME + r * SKY_STRIDE + (i % lengths[r])];
      const a = at(base + x);
      if (a !== NONE) addLayer(list, { ...layer((a + SKY) & 0xffff, 1, 0, 0), dx: (-sub << 24) >> 24 });
      if (sub !== 0) {
        const b = at(base + x + 1);
        if (b !== NONE) addLayer(list, { ...layer((b + SKY) & 0xffff, (sub / 0xc) | 0, 0, 0), dx: ((0x18 - sub) << 24) >> 24 });
      }
    }
  }
}
