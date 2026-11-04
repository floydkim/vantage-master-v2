// 표시 객체(vmv2.exe 0x47c2b0 풀, 0x16바이트)와 그것을 겹 목록에 넣는 일. 0x43d636의 뒷부분: 숨기지 않은 객체마다 그림자(0x43dd39),
// 이어서 정렬 키(+7) 오름차순(같으면 풀 순서)으로 몸(0x43daab). 칸에 걸친 칩은 0x43de8b가 이웃 화면 칩에도 넣는다.
import { GRID, partByte } from '../../engine/rules/terrain.ts';
import type { Cell } from '../../engine/command.ts';
import { MASTERS, type UnitRecord } from '../../engine/state.ts';
import type { ExeImage } from '../../formats/exeImage.ts';
import type { GameMap } from '../../formats/mapData.ts';
import { addLayer, CHIPS_X, CHIPS_Y, type Lists } from './field.ts';
import { placeHalfArt, UI_BLOCKS, UI_HALF_GRAPHICS } from './halfSheet.ts';
import { shrinkChips } from './minimap.ts';
import { type BattleSheet, CHIP, PAGES } from './sheet.ts';

const PAGE_CHIPS = 16;
const NONE = 0x7ff;
const SHADOW = [0x1020, 0x1021, 0x1030, 0x1031, 0x1040, 0x1041];
const SPRITE_TINTS = 0x473bec; // [객체 +0x0f | 커서] → 색 바꿈 표 번호
export const UNIT_GRAPHICS = 0x460704; // [그림 번호 × 2 + 진영] → 리소스(DATA01)
const COMMON_GRAPHICS = 6; // 페이지 0(그림자 등, 0x422cd8)
const UI_GRAPHICS = 8; // 커서·표식(0x422f9a, 확대 1)
const UI_PAGE = 0x2c6;
const LAYOUT_RESOURCES = [5, 10, 11, 12, 13, 14]; // 배치표 묶음 0~5(0x422a11)
const LAYOUT_SET = 0x480; // 자세 18개 × 0x40바이트(4열 × 8줄 u16)
const LAYOUT_SETS = 16; // 0~5 전투 시작, 6 공격·소멸, 7 소멸(진영 1)·효과, 8 투사체(0x422a11로 그때그때)
const POSES = 0x12;
const OVERLAY = 0x56;
const GRAPHIC_KINDS = 0x1a + 25;

/** 표시 객체(+0x00~+0x15) */
export interface Sprite {
  readonly x: number;
  readonly y: number;
  /** +2·+3 화면 칩 좌표(부호 있는 바이트) */
  readonly chipX: number;
  readonly chipY: number;
  /** +4·+5 칩 안 픽셀 어긋남, +6 들림(부호 있음) */
  readonly px: number;
  readonly py: number;
  readonly lift: number;
  /** +7 정렬 키(부호 있음) */
  readonly key: number;
  /** +8 그릴 높이(부호 있음), +9 칸 높이 */
  readonly level: number;
  readonly height: number;
  readonly direction: number;
  /** +0x0b 자세 = 방향 × 3 + 프레임 */
  readonly pose: number;
  /** +0x0c 그림 페이지(u16) */
  readonly page: number;
  /** +0x0e 배치표 묶음 */
  readonly set: number;
  /** +0x0f 색 바꿈 선택, +0x10 가림 무늬 */
  readonly tint: number;
  readonly mask: number;
  /** +0x11 종류(1 유닛, 3·5 표식, 6 차례 유닛: 0x412f6d가 틱마다 움직임) */
  readonly kind: number;
  /** +0x12 애니메이션 카운터 */
  readonly counter: number;
  /** +0x13 플래그(0x80 빈 칸, 0x02·0x04 숨김) */
  readonly flags: number;
  /** +0x14·+0x15 덧그림(상태 표시 등) */
  readonly overlay: number;
  readonly overlayFrame: number;
}

const s8 = (v: number) => (v << 24) >> 24;

export function decodeSprite(b: Uint8Array): Sprite {
  return {
    x: b[0],
    y: b[1],
    chipX: s8(b[2]),
    chipY: s8(b[3]),
    px: b[4],
    py: b[5],
    lift: s8(b[6]),
    key: s8(b[7]),
    level: s8(b[8]),
    height: b[9],
    direction: b[0xa],
    pose: b[0xb],
    page: b[0xc] | (b[0xd] << 8),
    set: b[0xe],
    tint: b[0xf],
    mask: b[0x10],
    kind: b[0x11],
    counter: b[0x12],
    flags: b[0x13],
    overlay: b[0x14],
    overlayFrame: b[0x15],
  };
}

export interface SpriteGraphics {
  /** 배치표(0x48355c): 묶음 × 자세 × 32칸 u16 */
  readonly layouts: Uint16Array;
  /** [객체 +0x0f | 커서] → 색 바꿈 표 번호 */
  readonly tints: Uint8Array;
}

/** 공통 그림(페이지 0), 커서·표식 그림(페이지 0x2c6, 사람 차례마다 0x40546d → 0x422f9a)과 배치표를 시트에 둔다 (vmv2.exe 0x00422cd8) */
export function loadSpriteGraphics(exe: ExeImage, read: (id: number) => Uint8Array, sheet: BattleSheet): SpriteGraphics {
  placePage(sheet, read(COMMON_GRAPHICS), 0, false);
  placePage(sheet, read(UI_GRAPHICS), UI_PAGE, false);
  const layouts = new Uint16Array(LAYOUT_SETS * (LAYOUT_SET / 2));
  LAYOUT_RESOURCES.forEach((id, k) => loadLayoutSet(read, layouts, id, k));
  return { layouts, tints: exe.read(SPRITE_TINTS, 0xc0) }; // 차례 유닛 깜빡임(0x412f6d 종류 6)이 0x40·0x80 비트를 켠다
}

/** 커서·표식 그림을 페이지 0x2c6~에 다시(vmv2.exe 0x00422f9a, 차례 입력 시작 0x40546d마다). 공격·투사체 그림이 덮은 자리다.
 *  x /2면 반 크기 그림(리소스 9)을 반 시트에만 */
export function loadUiGraphics(read: (id: number) => Uint8Array, sheet: BattleSheet): void {
  if (sheet.half) placeHalfArt(read(UI_HALF_GRAPHICS), UI_BLOCKS, sheet.half.chips, PAGES + UI_PAGE * 16);
  else placePage(sheet, read(UI_GRAPHICS), UI_PAGE, false);
}

/** 배치표 리소스를 묶음 set에 (vmv2.exe 0x00422a11) */
export function loadLayoutSet(read: (id: number) => Uint8Array, layouts: Uint16Array, id: number, set: number): void {
  const b = read(id);
  layouts.set(new Uint16Array(b.buffer.slice(b.byteOffset, b.byteOffset + LAYOUT_SET)), (set * LAYOUT_SET) / 2);
}

/** 그림을 페이지에 푼다 (vmv2.exe 0x004226eb). half는 플래그 0(연출·유닛 그림): x /2인 동안 반 시트에도 줄여 넣는다(0x42325f).
 *  원작은 x /2에서 페이지 0x2c6 아래를 반 시트에만 쓰지만 TS는 온 시트에도 쓴다(x 1로 돌아갈 때 다시 읽지 않아도 된다) */
export function placePage(sheet: BattleSheet, bytes: Uint8Array, page: number, half = true): void {
  const first = PAGES + page * PAGE_CHIPS;
  (sheet.chips as Uint8Array).set(bytes, first * CHIP);
  const h = sheet.half;
  if (half && h) shrinkChips(sheet.chips, first, Math.ceil(bytes.length / CHIP), h.logical(), h.tables, h.chips.subarray(first * (CHIP / 4)));
}

/** 유닛 표 칸 slot의 그림 페이지(0x40f42f) */
export const unitPage = (slot: number) => slot * 0xe + 10;

// vmv2.exe 0x00412b50: 상태 이상(유닛 +0x58 하위 비트, 앞 비트가 이긴다) → 종류, 색 바꿈 선택, 덧그림
const STATUS_LOOKS = [
  { bit: 1, kind: 0, tint: 8, overlay: 1 },
  { bit: 2, kind: 0, tint: 4, overlay: 2 },
  { bit: 4, kind: 0, tint: 2, overlay: 3 },
];

/** 상태 이상 비트(유닛 +0x58)에 따른 종류·색 바꿈 선택·덧그림 */
export const unitLook = (status: number): Pick<Sprite, 'kind' | 'tint' | 'overlay'> => {
  const { kind, tint, overlay } = STATUS_LOOKS.find((l) => status & l.bit) ?? { kind: 1, tint: 0, overlay: 0 };
  return { kind, tint, overlay };
};

/** 유닛 그림 번호(유닛 +7): 마스터는 마스터 번호, 네이티얼은 종류 + 0x1a (0x40f696·0x40fc66) */
export const unitGraphic = (u: UnitRecord, slot: number) => (slot < MASTERS ? u.type : u.type + 0x1a);

/** 칸 (x, y)에 선 표시 객체의 위치(vmv2.exe 0x00417542): 칩 좌표와 그릴 높이 = 칸 높이(부품 +0x61) */
export function placeSprite(map: GameMap, grid: Uint16Array, x: number, y: number): Pick<Sprite, 'x' | 'y' | 'chipX' | 'chipY' | 'level' | 'height'> {
  const height = partByte(map, grid[y * GRID + x], 0x61);
  return { x, y, chipX: s8((y & 1) + x * 2), chipY: s8(y * 2 + 0x17 - height), level: s8(height), height };
}

/** 서 있는 유닛의 표시 객체. 칸 slot은 유닛 표 칸(그림 페이지). 모습은 0x412b50 */
export function unitSprite(map: GameMap, grid: Uint16Array, u: UnitRecord, slot: number): Sprite {
  return {
    ...placeSprite(map, grid, u.x, u.y),
    px: 0,
    py: 0,
    lift: 0,
    key: 0,
    direction: u.direction,
    pose: u.pose,
    page: unitPage(slot),
    set: 0,
    ...unitLook(u.status),
    mask: 0,
    counter: u.animation,
    flags: 0,
    overlayFrame: 0,
  };
}

/** 유닛 그림을 그 칸의 페이지에 둔다 (vmv2.exe 0x004227d5). graphic은 마스터 번호 또는 네이티얼 종류 + 0x1a */
export function loadUnitGraphics(exe: ExeImage, read: (id: number) => Uint8Array, sheet: BattleSheet, slot: number, graphic: number, side: number): void {
  if (graphic < 0 || graphic >= GRAPHIC_KINDS) throw new RangeError(`유닛 그림 번호 범위 밖: ${graphic}`);
  const id = new DataView(exe.read(UNIT_GRAPHICS + (graphic * 2 + side) * 4, 4).buffer).getUint32(0, true);
  placePage(sheet, read(id), unitPage(slot));
}

// vmv2.exe 0x0043de8b: 화면 칩 (cx, cy)에, 어긋남이 이웃 칩으로 넘치면 그 칩들에도
function put(lists: Lists, cx: number, cy: number, ox: number, oy: number, lift: number, level: number, chip: number, tint: number, mask: number): void {
  const depth = level * 0x1b + 0xd + lift;
  const dx = s8(ox);
  const dy = (oy & 0x1f) << 27 >> 27; // 5비트 부호
  const fits = (x: number, y: number) => x >= 0 && x < CHIPS_X && y >= 0 && y < CHIPS_Y;
  const add = (x: number, y: number, d: number, ax: number, ay: number) =>
    addLayer(lists[y * CHIPS_X + x], { chip: chip & 0xffff, depth: d & 0xffff, cellX: 0, cellY: 0, tint, mask, dx: s8(ax), dy: ((ay & 0x1f) << 27) >> 27 });
  if (fits(cx, cy)) add(cx, cy, depth, dx, dy);
  if (ox > 0 && fits(cx + 1, cy)) add(cx + 1, cy, depth, ox - 0x18, oy);
  if (oy > 0 && fits(cx, cy + 1)) add(cx, cy + 1, depth - 0x1b, ox, oy - 0xc);
  if (ox > 0 && oy > 0 && fits(cx + 1, cy + 1)) add(cx + 1, cy + 1, depth - 0x1b, ox - 0x18, oy - 0xc);
}

// vmv2.exe 0x0043dd39
function shadow(lists: Lists, sx: number, sy: number, px: number, py: number, h: number, mask: number): void {
  let oy = py;
  if (py < 0) {
    oy = py + 0xc;
    sy--;
    h++;
  }
  const rows = [
    [sy - 2, h + 2],
    [sy - 1, h + 1],
    [sy, h],
  ];
  rows.forEach(([y, level], r) => {
    put(lists, sx, y, px, oy, py, level, SHADOW[r * 2], 0, mask);
    put(lists, sx + 1, y, px, oy, py, level, SHADOW[r * 2 + 1], 0, mask);
  });
}

// vmv2.exe 0x0043daab. 깜빡이는 커서(프레임 < 2) 칸의 유닛(종류 1·6)은 색 바꿈 선택에 1을 더한다
function body(lists: Lists, g: SpriteGraphics, s: Sprite, blink: Cell | null): void {
  const on = (s.kind === 1 || s.kind === 6) && blink !== null && blink.x === s.x && blink.y === s.y ? 1 : 0;
  const draw = (start: number, base: number, tint: number) => {
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 8; r++) {
        const chip = g.layouts[start + c * 8 + r];
        if (chip !== NONE) put(lists, s.chipX - 1 + c, s.chipY - r, s.px, s.py, s.lift, s.level + r, base + chip, tint, s.mask);
      }
    }
  };
  draw((s.set * POSES + s.pose) * 32, s.page * PAGE_CHIPS + PAGES, g.tints[s.tint | on]);
  if (s.overlay !== 0 && (s.flags & 8) === 0) draw((s.overlayFrame + OVERLAY + s.overlay * 4) * 32, PAGES, g.tints[(s.tint & 0x11) | on]);
}

/** 풀 순서의 표시 객체를 겹 목록에 넣는다 (vmv2.exe 0x0043d636 뒷부분). blink는 깜빡이는 커서 칸(켜져 있고 커서 프레임 < 2) */
export function addSprites(lists: Lists, g: SpriteGraphics, pool: readonly Sprite[], blink: Cell | null = null): void {
  for (const s of pool) if ((s.flags & 0x86) === 0) shadow(lists, s.chipX, s.chipY + (s.level - s.height), s.px, s.lift, s.height, s.mask);
  const shown = pool.filter((s) => (s.flags & 0x82) === 0);
  const sorted: Sprite[] = [];
  for (const s of shown) {
    let j = sorted.length;
    while (j > 0 && s.key < sorted[j - 1].key) j--;
    sorted.splice(j, 0, s);
  }
  for (const s of sorted) body(lists, g, s, blink);
}
