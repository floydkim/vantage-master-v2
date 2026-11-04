// 전장 칩 시트. vmv2.exe 0x483f48 덩어리를 칩(24 × 12 = 288바이트, 8비트 색 번호, 0x10이 투명) 번호 순으로 둔다.
// 0~0x3ff 맵 배경 칩(_BG, 0x401a0c), 0x400~0x7ff 같은 칩의 어두운 판(표 0x473534로 색 바꿈), 0xa00~ 하늘 칩(0x42266c),
// 0x1000~ 그림 페이지(페이지 = 칩 16개, 0x4226eb). 0x800~0x9ff는 원작이 합성 칩 캐시로 쓰지만 결과가 같아 두지 않는다.
import type { ExeImage } from '../../formats/exeImage.ts';
import type { GameMap } from '../../formats/mapData.ts';
import type { ShrinkTables } from './minimap.ts';

export const CHIP_W = 24;
export const CHIP_H = 12;
export const CHIP = CHIP_W * CHIP_H;
export const TRANSPARENT = 0x10;
const BACKGROUND_CHIPS = 0x400;
const DARK = 0x400;
const SKY = 0xa00;
export const PAGES = 0x1000;
export const MASK_SCRATCH = 0x100f; // 0x43ee13이 가린 칩을 두는 자리(그림 페이지 0의 마지막 칩)
const PAGE_CHIPS = 16;
const SHEET_CHIPS = PAGES + 0x2c6 * PAGE_CHIPS + 0x3c0; // 페이지 0x2c6~에 커서·표식 그림 0x3c0칩(0x40ee74). 원작은 이 자리를 CPU 생각 작업 버퍼로도 쓴다
const DARK_REMAP = 0x473534;
const MASK_WORDS = 9; // 칩 288픽셀 = u32 9개
const PARTS = 0x200;
const SKY_ROWS = 20;

/** 리소스 번호(상위 16비트 = DAT 번호) → 풀린 내용 */
export type ReadAny = (id: number) => Uint8Array;

/** 하늘(맵 +0x28 기술 자료, 0x43d433) */
export interface Sky {
  /** 하늘 배치(0x483558, u16 칩 번호. 프레임 × 0x1400바이트 + (줄 × 0x80 + 칸) × 2) */
  readonly layout: Uint16Array;
  /** +0x08: 줄마다 스크롤 한 번까지 틱 수 */
  readonly periods: readonly number[];
  /** +0x58: 줄마다 한 번에 움직이는 픽셀 */
  readonly steps: readonly number[];
  /** +0xa8: 줄마다 반복 길이(칸) */
  readonly lengths: readonly number[];
  /** +0xf8: 배치 프레임 차례(−1 앞까지) */
  readonly frames: readonly number[];
}

/** 확대 x /2인 동안의 반 크기 칩 시트(0x483f44, 칩 12 × 6 = 72바이트)와 줄일 때의 색 부류 표, 지금 논리 팔레트(halfSheet.ts).
 *  x /2인 동안 읽는 그림은 읽는 그때의 팔레트로 줄인다(0x42325f → 0x4232a9) */
export interface HalfSheet {
  readonly chips: Uint8Array;
  readonly tables: ShrinkTables;
  readonly logical: () => Uint8Array;
}

export interface BattleSheet {
  readonly chips: Uint8Array;
  /** x /2인 동안만 있다 */
  half: HalfSheet | null;
  /** 칩 0~0x3ff의 불투명 비트(0x494c1c): 칩마다 u32 9개, 앞 픽셀이 높은 비트 */
  readonly masks: Uint32Array;
  /** 부품마다 칩이 있는 가장 높은 단(0x49dc20, 0x43b6c2) */
  readonly partTops: Uint8Array;
  readonly sky: Sky;
}

// vmv2.exe 0x00401a0c(배경 칩, 어두운 판) + 0x0042266c(하늘) + 0x0043b6c2(마스크, 부품 단)
export function buildSheet(exe: ExeImage, read: ReadAny, map: GameMap): BattleSheet {
  const chips = new Uint8Array(SHEET_CHIPS * CHIP);
  const background = read(map.header.backgroundId);
  chips.set(background.subarray(0, BACKGROUND_CHIPS * CHIP));
  const remap = exe.read(DARK_REMAP, 256);
  for (let i = 0; i < BACKGROUND_CHIPS * CHIP; i++) chips[DARK * CHIP + i] = remap[chips[i]];
  const s = new DataView(map.struct.buffer, map.struct.byteOffset);
  const desc = read(s.getUint32(0x28, true));
  const d = new DataView(desc.buffer, desc.byteOffset, desc.byteLength);
  chips.set(read(d.getUint32(0, true)), SKY * CHIP);
  const layoutBytes = read(d.getUint32(4, true));
  const layout = new Uint16Array(layoutBytes.buffer.slice(layoutBytes.byteOffset, layoutBytes.byteOffset + (layoutBytes.byteLength & ~1)));
  const rows = (at: number) => Array.from({ length: SKY_ROWS }, (_, r) => d.getInt32(at + r * 4, true));
  const frames: number[] = [];
  for (let at = 0xf8; d.getInt32(at, true) !== -1; at += 4) frames.push(d.getInt32(at, true));
  if (frames.length === 0) throw new RangeError('하늘 프레임 차례가 비었습니다');
  const sky: Sky = { layout, periods: rows(0x08), steps: rows(0x58), lengths: rows(0xa8), frames };
  const masks = new Uint32Array(BACKGROUND_CHIPS * MASK_WORDS);
  for (let w = 0; w < masks.length; w++) {
    let v = 0;
    for (let b = 0; b < 32; b++) v = ((v << 1) | (chips[w * 32 + b] !== TRANSPARENT ? 1 : 0)) >>> 0;
    masks[w] = v;
  }
  const partTops = new Uint8Array(PARTS);
  const parts = map.parts;
  const word = (part: number, k: number) => parts[part * 100 + k * 2] | (parts[part * 100 + k * 2 + 1] << 8);
  for (let p = 0; p < PARTS; p++) {
    const h = parts[p * 100 + 0x61];
    const upper = (parts[p * 100 + 0x63] & 1) !== 0;
    let r = 0x17;
    for (; r > 0; r--) {
      let c = 0;
      while (
        c < 2 &&
        (!upper || h + 5 <= r || r < h || word(p, c * 0x18 + 0x13 + r - h) === 0x7ff) &&
        ((0x12 < r && upper) || word(p, c * 0x18 + r) === 0x7ff)
      ) {
        c++;
      }
      if (c < 2) break;
    }
    partTops[p] = r;
  }
  return { chips, half: null, masks, partTops, sky };
}

export { DARK, SKY };
