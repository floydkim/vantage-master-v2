// 칩 그리기. vmv2.exe 0x0043ef06(합성 칩 캐시를 쓰지 않는 갈래: 원작도 캐시가 비면 이 갈래이고 결과 픽셀이 같다)와
// 0x43e639·0x43e71e·0x43ea67·0x43ecb5·0x43ee13·0x43e853. 첫 겹은 통째로 놓고, 다음 겹들은 아직 투명(0x10)인 픽셀만 채운다.
import type { ExeImage } from '../../formats/exeImage.ts';
import { CHIPS_X, CHIPS_Y, type Layer, type Lists } from './field.ts';
import { type BattleSheet, CHIP_H, CHIP_W, MASK_SCRATCH, TRANSPARENT } from './sheet.ts';

export const FIELD_W = CHIPS_X * CHIP_W;
export const FIELD_H = CHIPS_Y * CHIP_H;
const TINTS = 0x473bb4; // 색 바꿈 표 포인터: 0번은 없음, 1~13번은 0x473534부터 0x80 간격(표 256바이트가 겹침). 14·15번 자리는 다른 자료
const TINT_COUNT = 14;
const MASKS = 0x473cec; // 가림 무늬: 무늬마다 줄 12개 × u32(낮은 비트가 왼쪽 픽셀, 1이면 투명)

export interface RasterTables {
  /** 표 번호 → 256바이트 색 바꿈 표(없으면 null) */
  readonly tints: readonly (Uint8Array | null)[];
  readonly masks: readonly Uint32Array[];
}

export function readRasterTables(exe: ExeImage): RasterTables {
  const ptr = new DataView(exe.read(TINTS, TINT_COUNT * 4).buffer);
  const tints = Array.from({ length: TINT_COUNT }, (_, i) => {
    const at = ptr.getUint32(i * 4, true);
    return at ? exe.read(at, 256) : null;
  });
  const m = new DataView(exe.read(MASKS, 8 * 0x30).buffer);
  const masks = Array.from({ length: 8 }, (_, k) => Uint32Array.from({ length: CHIP_H }, (_, r) => m.getUint32(k * 0x30 + r * 4, true)));
  return { tints, masks };
}

/** 그릴 칩 시트와 칩 크기(전장 창 +0x3c·+0x40·+0x4c, 0x40f03c): 확대 1·2는 온 시트 24 × 12, x /2는 반 시트 12 × 6. pitch는 받을 곳 한 줄 */
interface Target {
  readonly chips: Uint8Array;
  readonly w: number;
  readonly h: number;
  readonly pitch: number;
}

const source = (t: Target, chip: number) => chip * t.w * t.h;

// vmv2.exe 0x0043e639: 통째로(색 바꿈 있으면 표로)
function put(out: Uint8Array, at: number, t: Target, chip: number, tint: Uint8Array | null): void {
  let s = source(t, chip);
  for (let r = 0; r < t.h; r++, at += t.pitch, s += t.w) {
    for (let c = 0; c < t.w; c++) out[at + c] = tint ? tint[t.chips[s + c]] : t.chips[s + c];
  }
}

// vmv2.exe 0x0043e71e: 투명 픽셀만
function fill(out: Uint8Array, at: number, t: Target, chip: number, tint: Uint8Array | null): void {
  let s = source(t, chip);
  for (let r = 0; r < t.h; r++, at += t.pitch, s += t.w) {
    for (let c = 0; c < t.w; c++) if (out[at + c] === TRANSPARENT) out[at + c] = tint ? tint[t.chips[s + c]] : t.chips[s + c];
  }
}

// vmv2.exe 0x0043ea67(투명 픽셀만)·0x0043e853(먼저 투명으로 채우고 통째로): dx·dy만큼 어긋나게. 반 크기는 어긋남을 (d + 칩)/2 − 칩/2로 줄이고
// 칩 하나만큼(−12·−6) 밀리면 그리지 않는다
function shifted(out: Uint8Array, at: number, t: Target, chip: number, dx: number, dy: number, tint: Uint8Array | null, opaque: boolean): void {
  if (opaque) for (let r = 0; r < t.h; r++) out.fill(TRANSPARENT, at + r * t.pitch, at + r * t.pitch + t.w);
  if (t.w < CHIP_W) {
    dx = Math.trunc((dx + CHIP_W) / 2) - t.w;
    if (dx === -t.w) return;
    dy = Math.trunc((dy + CHIP_H) / 2) - t.h;
    if (dy === -t.h) return;
  }
  let s = source(t, chip);
  let w = t.w;
  let h = t.h;
  if (dx < 0) {
    s -= dx;
    w += dx;
  }
  if (dx > 0) {
    at += dx;
    w -= dx;
  }
  if (dy < 0) {
    s += t.w * -dy;
    h += dy;
  }
  if (dy > 0) {
    at += t.pitch * dy;
    h -= dy;
  }
  for (let r = 0; r < h; r++, at += t.pitch, s += t.w) {
    for (let c = 0; c < w; c++) {
      const v = tint ? tint[t.chips[s + c]] : t.chips[s + c];
      if (opaque || out[at + c] === TRANSPARENT) out[at + c] = v;
    }
  }
}

// vmv2.exe 0x0043ecb5: 앞 칩의 불투명 픽셀, 아니면 뒤 칩 픽셀
function over(out: Uint8Array, at: number, t: Target, front: number, back: number): void {
  const f = source(t, front);
  const b = source(t, back);
  for (let r = 0; r < t.h; r++, at += t.pitch) {
    for (let c = 0; c < t.w; c++) {
      const v = t.chips[f + r * t.w + c];
      out[at + c] = v === TRANSPARENT ? t.chips[b + r * t.w + c] : v;
    }
  }
}

// vmv2.exe 0x0043ee13: 가림 무늬(앞 h줄, 줄마다 낮은 w비트)로 칩을 가려 0x100f 자리에
function masked(t: Target, tables: RasterTables, chip: number, mask: number): number {
  const s = source(t, chip);
  const d = source(t, MASK_SCRATCH);
  for (let r = 0; r < t.h; r++) {
    let bits = tables.masks[mask][r];
    for (let c = 0; c < t.w; c++, bits >>>= 1) t.chips[d + r * t.w + c] = bits & 1 ? TRANSPARENT : t.chips[s + r * t.w + c];
  }
  return MASK_SCRATCH;
}

// vmv2.exe 0x0043ef06(캐시 없는 갈래): 화면 칩 하나
function drawChip(out: Uint8Array, at: number, t: Target, tables: RasterTables, list: readonly Layer[]): void {
  if (list.length === 0) {
    for (let r = 0; r < t.h; r++) out.fill(TRANSPARENT, at + r * t.pitch, at + r * t.pitch + t.w);
    return;
  }
  let first = true;
  let pending = -1;
  for (const l of list) {
    const tint = tables.tints[l.tint];
    if (tint === undefined) throw new RangeError(`색 바꿈 표 번호 범위 밖: ${l.tint}`);
    const chip = l.mask === 0 ? l.chip : masked(t, tables, l.chip, l.mask - 1);
    const plain = l.dx === 0 && l.dy === 0;
    if (!first) {
      if (pending === -1) {
        if (plain) fill(out, at, t, chip, tint);
        else shifted(out, at, t, chip, l.dx, l.dy, tint, false);
      } else {
        if (plain) {
          if (!tint) over(out, at, t, pending, chip);
          else {
            put(out, at, t, pending, null);
            fill(out, at, t, chip, tint);
          }
        } else {
          put(out, at, t, pending, null);
          shifted(out, at, t, chip, l.dx, l.dy, tint, false);
        }
        pending = -1;
      }
    } else {
      if (plain) {
        if (!tint && l.mask === 0) pending = chip;
        else put(out, at, t, chip, tint);
      } else shifted(out, at, t, chip, l.dx, l.dy, tint, true);
      first = false;
    }
  }
  if (pending !== -1) put(out, at, t, pending, null);
}

/** 모든 화면 칩을 그린 전장 화면(색 번호): 온 시트 1560 × 1008, half면 반 시트(x /2)로 780 × 504 */
export function drawField(sheet: BattleSheet, tables: RasterTables, lists: Lists, half = false): Uint8Array {
  const h = half ? sheet.half : null;
  if (half && !h) throw new Error('반 크기 칩 시트가 없습니다(x /2로 바꾸지 않음)');
  const t: Target = h ? { chips: h.chips, w: CHIP_W / 2, h: CHIP_H / 2, pitch: FIELD_W / 2 } : { chips: sheet.chips as Uint8Array, w: CHIP_W, h: CHIP_H, pitch: FIELD_W };
  const out = new Uint8Array(t.pitch * t.h * CHIPS_Y);
  for (let y = 0; y < CHIPS_Y; y++) {
    for (let x = 0; x < CHIPS_X; x++) drawChip(out, y * t.h * t.pitch + x * t.w, t, tables, lists[y * CHIPS_X + x]);
  }
  return out;
}
