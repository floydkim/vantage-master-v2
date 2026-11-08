// 결과 창(Battle results window, CBtlRepWnd 0x407d43)과 전투 끝 문구(0x401ec3·0x402020). 608 × 420 DIB에 바탕(DATA00 0x22·0x23, 바이트 + 0x6f),
// 쪽 글자(그림자 (x + 1, y + 1) 색 10 뒤 본문), 마스터 그림(자세 8 이긴 진영, 9 그 밖), 단추(Prev·Next/END, 칩 2 × 2)를 그린다.
// 값은 모두 상태 블록에 있다: 누적 분, 마정석(MP 배수 − 2), 통계 칸(STAT_*), 진영 레코드(이름·마스터·네이티얼·마법 목록)
import type { GameState, SideRecord } from '../../engine/state.ts';
import { readActionNames } from '../../formats/actionTable.ts';
import type { ExeImage } from '../../formats/exeImage.ts';
import { readNatialTable } from '../../formats/natialTable.ts';
import { koreanLayout } from '../../i18n/hangul.ts';
import { u32 } from './attack.ts';
import { drawText, readGlyphs } from './font.ts';
import { CHIP, CHIP_H, CHIP_W, type ReadAny, TRANSPARENT } from './sheet.ts';
import { loadLayoutSet } from './sprites.ts';
import { formatC } from './statusWindow.ts';

export const RESULT_W = 608;
export const RESULT_H = 420;
/** 프리 배틀의 마지막 쪽(+0xc): 0 요약, 1·2 진영 0 네이티얼·마법, 3·4 진영 1. 시나리오에서 이기면 5 레벨 업(0x408447) */
export const LAST_PAGE = 4;
const BACKGROUNDS = [0x22, 0x23, 0x24];
const ITEM_CHIPS = 0x17; // 칩 0x120부터(0x4226eb(0x17, 0x12))
const ITEMS = 0x468d60; // 0x10바이트 × 30: +8 이름, +0xc 설명
const ACQUIRED = 0x45f1fc; // "%s is acquired."
const UP = 0x7b; // 쪽 5: 오른 능력치
const SHIFT = 0x6f; // 바탕 바이트에 더한다(DATA00 0x21이 118번부터)
const BUTTONS = 0x16; // 단추 칩 224개(줄 × 0x20 + 프레임 × 2 + {0, 1, 0x10, 0x11})
const MASTER_GRAPHICS = 0x461eac; // [마스터 × 2 + 진영] → 리소스
const MASTER_LAYOUTS = 0x461f84;
const POSE = 0x20; // u16 칸
const LAYOUT_SET = 0x480 / 2;
const PREV = { x: 480, y: 372 };
const NEXT = { x: 540, y: 372 };
const SHADOW = 10;
const TEXT = 0xb;
const OFF = 0x79; // 진영 목록에 없는 네이티얼·마법(0x42d69f)

export interface ResultArt {
  readonly backgrounds: readonly Uint8Array[];
  /** 단추 칩(투명 픽셀은 바탕 0x22의 그 자리로 미리 채움, 0x43fac3) */
  readonly buttons: Uint8Array;
  /** 진영마다 마스터 그림 칩(그 진영 페이지부터)과 배치 묶음(자세 18개) */
  readonly masters: readonly { readonly chips: Uint8Array; readonly layout: Uint16Array }[];
  readonly glyphs: Uint8Array;
  readonly text: (va: number) => string;
  readonly natialNames: readonly string[];
  readonly actionNames: readonly (string | null)[];
  readonly itemChips: Uint8Array;
  readonly items: readonly { readonly name: string; readonly description: string }[];
}

/** 쪽 5(시나리오 레벨 업): 레벨 + 1로 다시 계산한 진영 0, 보상 아이템(−1 없음) */
export interface ResultLevelUp {
  readonly after: SideRecord;
  readonly reward: number;
}

/** vmv2.exe 0x004080ac: 바탕 + 0x6f, 단추 칩과 바탕 합성, 진영마다 마스터 그림(페이지 0x2c6·0x2e4, 묶음 6·7) */
export function loadResultArt(exe: ExeImage, read: ReadAny, sides: readonly SideRecord[]): ResultArt {
  const backgrounds = BACKGROUNDS.map((id) => read(id).slice(0, RESULT_W * RESULT_H).map((v) => (v + SHIFT) & 0xff));
  const buttons = read(BUTTONS).slice();
  for (let row = 0; row < 7; row++) {
    const at = row < 3 ? PREV : NEXT;
    for (let frame = 0; frame < 8; frame++) {
      [0, 1, 0x10, 0x11].forEach((k, q) => {
        const s = (row * 0x20 + frame * 2 + k) * CHIP;
        const bx = at.x + (q & 1) * CHIP_W;
        const by = at.y + (q >> 1) * CHIP_H;
        for (let r = 0; r < CHIP_H; r++) {
          for (let c = 0; c < CHIP_W; c++) if (buttons[s + r * CHIP_W + c] === TRANSPARENT) buttons[s + r * CHIP_W + c] = backgrounds[0][(by + r) * RESULT_W + bx + c];
        }
      });
    }
  }
  const masters = sides.map((side, n) => {
    const layouts = new Uint16Array((8 + n) * LAYOUT_SET);
    loadLayoutSet(read, layouts, u32(exe, MASTER_LAYOUTS + (side.master * 2 + n) * 4), 6 + n);
    return { chips: read(u32(exe, MASTER_GRAPHICS + (side.master * 2 + n) * 4)), layout: layouts.subarray((6 + n) * LAYOUT_SET) };
  });
  const items = Array.from({ length: 30 }, (_, k) => ({ name: exe.cString(u32(exe, ITEMS + k * 0x10 + 8)), description: exe.cString(u32(exe, ITEMS + k * 0x10 + 0xc)) }));
  return { backgrounds, buttons, masters, glyphs: readGlyphs(read), text: (va) => exe.cString(va), natialNames: readNatialTable(exe).map((n) => n.name), actionNames: readActionNames(exe), itemChips: read(ITEM_CHIPS), items };
}

/** vmv2.exe 0x0040aa34: 단추 판정. 0 Prev(0쪽이면 없음), 1 Next·END, 그 밖 −1 */
export function resultHit(x: number, y: number, page: number): number {
  if (y < 372 || y > 395) return -1;
  if (x >= 480 && x <= 527) return page === 0 ? -1 : 0;
  if (x >= 540 && x <= 587) return 1;
  return -1;
}

/** vmv2.exe 0x0040a55e: Prev는 0쪽이면 빈칸(줄 2), 아니면 줄 0. Next는 마지막 쪽이 아니면 줄 3, 마지막이면 END 줄 5. 마우스 위면 +1(노랑) */
export function drawResultButtons(art: ResultArt, image: Uint8Array, page: number, hover: number, frame: number, last = LAST_PAGE): void {
  const put = (at: { x: number; y: number }, row: number) =>
    [0, 1, 0x10, 0x11].forEach((k, q) => {
      const s = (row * 0x20 + frame * 2 + k) * CHIP;
      for (let r = 0; r < CHIP_H; r++) image.set(art.buttons.subarray(s + r * CHIP_W, s + (r + 1) * CHIP_W), (at.y + (q >> 1) * CHIP_H + r) * RESULT_W + at.x + (q & 1) * CHIP_W);
    });
  put(PREV, (page === 0 ? 2 : 0) + (hover === 0 ? 1 : 0));
  put(NEXT, (page < last ? 3 : 5) + (hover === 1 ? 1 : 0));
}

/** 경과 일·시(2자리 수)와 분 글의 x(0x408614). 한국어판은 그 판 글의 빈칸에 맞춰 옮겼다(0x40b5c4·0x40b628·0x40b669) */
export const elapsedColumns = (): readonly [number, number, number] => (koreanLayout() ? [128, 160, 184] : [143, 215, 242]);

/** vmv2.exe 0x004084c4: 쪽 하나(바탕, 쪽 글자·그림, 단추). winner는 0·1, 무승부 −1. levelUp이 있으면 쪽 5까지 */
export function drawResultPage(art: ResultArt, state: GameState, winner: number, page: number, hover = -1, frame = 0, levelUp: ResultLevelUp | null = null): Uint8Array {
  const image = art.backgrounds[page === 0 ? 0 : page === 5 ? 2 : 1].slice();
  // vmv2.exe 0x0040abb0 → 0x00423bc9: 그림자 뒤 본문, 줄바꿈마다 20줄 아래
  const write = (x: number, y: number, text: string, color = TEXT) =>
    text.split('\n').forEach((line, i) => {
      drawText(image, (y + 20 * i + 1) * RESULT_W + x + 1, RESULT_W, line, SHADOW, art.glyphs);
      drawText(image, (y + 20 * i) * RESULT_W + x, RESULT_W, line, color, art.glyphs);
    });
  const num = (x: number, y: number, value: number, width: number, color = TEXT) => write(x, y, formatC('%*d', width, value), color);
  // vmv2.exe 0x0040a51a → 0x0043fb44: 4열 × 8줄, 0x7ff는 건너뛰고 0x10은 투명
  const master = (x: number, y: number, side: number) => {
    const m = art.masters[side];
    const pose = (winner !== side ? 1 : 0) + 8;
    for (let c = 0; c < 4; c++) {
      for (let j = 0; j < 8; j++) {
        const v = m.layout[pose * POSE + c * 8 + j];
        if (v === 0x7ff) continue;
        for (let r = 0; r < CHIP_H; r++) {
          for (let k = 0; k < CHIP_W; k++) {
            const p = m.chips[v * CHIP + r * CHIP_W + k];
            if (p !== TRANSPARENT) image[(y + (7 - j) * CHIP_H + r) * RESULT_W + x + c * CHIP_W + k] = p;
          }
        }
      }
    }
  };
  const stat = (side: number, k: number) => state.stats[side][k];
  const sum = (side: number, from: number, to: number) => {
    let s = 0;
    for (let k = from; k <= to; k++) s += stat(side, k);
    return s;
  };
  if (page === 0) {
    // vmv2.exe 0x00408614: 경과 일·시·분
    const e = state.elapsedMinutes;
    const [days, hours, minutes] = elapsedColumns();
    write(56, 28, art.text(0x45f0fc));
    num(days, 28, Math.trunc(e / 1440), 2);
    num(hours, 28, Math.trunc((e % 1440) / 60), 2);
    write(minutes, 28, formatC(art.text(0x45f114), e % 60));
    [0, 1].forEach((side) => {
      // vmv2.exe 0x00408826
      const x0 = side === 0 ? 100 : 336;
      [0x45f11c, 0x45f12c, 0x45f134, 0x45f144, 0x45f150, 0x45f158, 0x45f160, 0x45f168, 0x45f17c, 0x45f184, 0x45f18c, 0x45f194].forEach((va, i) => write(x0, 156 + 20 * i, art.text(va)));
      master(x0 - 24, 36, side);
      write(x0 + 64, 108, state.sides[side].name);
      num(x0 + 96, 156, state.sideStates[side].mpMultiplier - 2, 5);
      num(x0 + 96, 176, stat(side, 0), 5);
      num(x0 + 96, 216, stat(side, 1), 5);
      num(x0 + 96, 236, stat(side, 2), 5);
      num(x0 + 96, 256, sum(side, 3, 8), 5);
      const total = sum(side, 9, 32);
      num(x0 + 96, 276, total, 5);
      for (let j = 0; j < 4; j++) {
        const g = sum(side, 9 + 6 * j, 14 + 6 * j);
        const t = total || 1;
        num(x0 + 64, 316 + 20 * j, Math.trunc((g * 100) / t), 3);
        num(x0 + 96, 316 + 20 * j, Math.trunc((Math.trunc((g * 10000) / t) + 5) / 10) % 10, 1);
      }
    });
  } else if (page === 5 && levelUp) {
    // vmv2.exe 0x00409c6d: 레벨(1부터)·능력치 7가지의 전(x 272)·후(x 308), 오르면 색 0x7b. 보상: 아이템 그림(0x429bfa, 칩 2 × 6)·"%s is acquired."·설명
    const before = state.sides[0];
    const after = levelUp.after;
    num(272, 60, before.level + 1, 2);
    num(308, 60, after.level + 1, 2);
    (['maxMp', 'attack', 'defense', 'magic', 'magicDefense', 'speed', 'movement'] as const).forEach((k, i) => {
      num(272, 80 + 20 * i, before[k], 2);
      num(308, 80 + 20 * i, after[k], 2, after[k] > before[k] ? UP : TEXT);
    });
    const item = levelUp.reward;
    if (item !== -1) {
      const k = (item >> 3) * 0x60 + (item & 7) * 2;
      for (let r = 0; r < 6; r++) {
        for (let q = 0; q < 2; q++) {
          const s = (k + q + r * 0x10) * CHIP;
          for (let y = 0; y < CHIP_H; y++) {
            for (let x = 0; x < CHIP_W; x++) {
              const p = art.itemChips[s + y * CHIP_W + x];
              if (p !== TRANSPARENT) image[(240 + r * CHIP_H + y) * RESULT_W + 48 + q * CHIP_W + x] = p;
            }
          }
        }
      }
      write(112, 240, formatC(art.text(ACQUIRED), art.items[item].name));
      write(112, 260, art.items[item].description);
    }
  } else {
    const side = page < 3 ? 0 : 1;
    const record = state.sides[side];
    if (page % 2 === 1) {
      // vmv2.exe 0x00409688: 네이티얼 24종, 두 열 × 12줄
      write(24, 100, art.text(0x45f19c));
      write(312, 100, art.text(0x45f1c0));
      master(0, 0, side);
      write(88, 72, record.name);
      for (let i = 0; i < 24; i++) {
        const t = i + 1;
        const r = i % 12;
        const y = 124 + 20 * r + 4 * Math.trunc(r / 6);
        const xo = 288 * Math.trunc(i / 12);
        const color = record.natials.includes(t) ? TEXT : OFF;
        const times = stat(side, 8 + t);
        const sat = stat(side, 32 + t);
        write(24 + xo, y, art.natialNames[t - 1], color);
        num(176 + xo, y, times, 4, color);
        num(216 + xo, y, sat, 6, color);
        num(272 + xo, y, times === 0 ? 0 : Math.trunc((Math.trunc((sat * 10) / times) + 5) / 10), 3, color);
      }
    } else {
      // vmv2.exe 0x00409a5c: 마스터 마법 6가지(행동 10~15)
      write(48, 124, art.text(0x45f1e4));
      master(0, 0, side);
      write(88, 72, record.name);
      for (let i = 0; i < 6; i++) {
        const color = record.spells.includes(10 + i) ? TEXT : OFF;
        write(48, 148 + 20 * i, art.actionNames[10 + i] ?? '', color);
        num(168, 148 + 20 * i, stat(side, 3 + i), 4, color);
      }
    }
  }
  drawResultButtons(art, image, page, hover, frame, levelUp ? 5 : LAST_PAGE);
  return image;
}

/** 승패 문구와 "이김"(0x476b6c: 결과 창·BGM 2/3) */
export interface BattleEnd {
  readonly text: string;
  readonly won: boolean;
}

/**
 * vmv2.exe 0x00401ec3·0x00402020: 무승부(−1)는 "You have come to a confrontation.". 아니면 이름을 쓸 진영 = 승자가 사람이면 승자, 아니고 진 쪽이
 * 사람이면 진 쪽, 둘 다 CPU면 승자이고 "<이름> has　<Won|Lost>ed"(원작 철자). 항복은 "<항복 진영> has surrendered", 이김은 항복 진영이 사람이고 다른 진영이
 * 사람이 아닐 때만 거짓
 */
export function battleEndText(exe: ExeImage, state: GameState, winner: number, surrendered: number | null = null): BattleEnd {
  const human = (side: number) => state.sideStates[side].controller === 0;
  if (surrendered !== null) {
    return { text: formatC(exe.cString(0x45e48c), state.sides[surrendered].name), won: !(human(surrendered) && !human(1 - surrendered)) };
  }
  if (winner !== 0 && winner !== 1) return { text: exe.cString(0x45e468), won: false };
  const side = human(winner) ? winner : human(1 - winner) ? 1 - winner : winner;
  const won = side === winner;
  return { text: formatC(exe.cString(0x45e458), state.sides[side].name, exe.cString(won ? 0x45e44c : 0x45e450)), won };
}
