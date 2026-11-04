// 타이틀 장면(장면 1, CMainMenuWnd)의 그림: 오프닝 엔진의 마지막 장면(0x439c0b·0x439d23) 위에 메뉴(0x42626f). 해독 메모 notes_title.md §3·§4
import type { ExeImage } from '../../formats/exeImage.ts';
import { drawText, readGlyphs } from '../battle/font.ts';
import { type ReadAny, TRANSPARENT } from '../battle/sheet.ts';
import type { Point, Size } from '../frame/layout.ts';

export const TITLE_W = 768;
export const TITLE_H = 512;
const AVI_W = 320;
const AVI_H = 240;
const LOGO = 0x18a; // DATA07 584 × 296, 반짝임 0x18b~0x1a3
const LOGO_W = 584;
const LOGO_AT = { x: 67, y: 17 }; // 768/2 − 292 − 25, 512/2 − 148 − 91
const GLINT_RECTS = 0x4731e8; // i32 (sx, sy, ex, ey) × 26, 로고 안 좌표
const GLINT_FRAMES = 25;
const GLINT_PERIOD = 200;
const MENU = { x: 0x13c, y: 0x150, step: 20, width: 136, height: 16 };
const SHADOW = 10;
const TEXT = 0xb;
const HOVER = 0xf; // (0, 0, 255)
const data07 = (id: number) => (7 << 16) | id;

/** 메뉴 글자(0x465cf8부터 0x14바이트 간격, 공백으로 17글자) */
export const MENU_ITEMS: readonly string[] = ['  Scenario Mode  ', '   Expert Mode   ', '   Free Battle   ', ' Network Battle  ', '    Load Data    ', '      Quit       '];

export interface TitleArt {
  /** 바탕과 로고(메뉴 없음) */
  readonly base: Uint8Array;
  readonly logo: Uint8Array;
  readonly glints: readonly { readonly image: Uint8Array; readonly sx: number; readonly sy: number; readonly w: number; readonly h: number }[];
  readonly glyphs: Uint8Array;
  /** DIB 색 표(RGBQUAD 256개) */
  readonly colors: Uint8Array;
}

/** vmv2.exe 0x00439c0b·0x00439d23: 그림과 팔레트 */
export function loadTitleArt(exe: ExeImage, read: ReadAny): TitleArt {
  const base = new Uint8Array(TITLE_W * TITLE_H);
  const top = read(data07(0x1a8));
  const bottom = read(data07(0x1a9));
  for (let i = 0; i < TITLE_W * 256; i++) {
    base[i] = (top[i] - 7) & 0xff;
    base[TITLE_W * 256 + i] = (bottom[i] - 7) & 0xff;
  }
  const logo = read(data07(LOGO));
  overlay(base, logo, LOGO_W, 296, LOGO_AT.x, LOGO_AT.y);
  const v = new DataView(exe.read(GLINT_RECTS, (GLINT_FRAMES + 1) * 16).buffer);
  const glints = Array.from({ length: GLINT_FRAMES }, (_, n) => {
    const k = n + 1;
    const [sx, sy, ex, ey] = [0, 4, 8, 12].map((o) => v.getInt32(k * 16 + o, true));
    return { image: read(data07(LOGO + k)), sx, sy, w: ex - sx, h: ey - sy };
  });
  return { base, logo, glints, glyphs: readGlyphs(read), colors: palette(read) };
}

// 0x10은 투명
function overlay(out: Uint8Array, image: Uint8Array, w: number, h: number, x: number, y: number): void {
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const p = image[r * w + c];
      if (p !== TRANSPARENT) out[(y + r) * TITLE_W + x + c] = p;
    }
  }
}

// vmv2.exe 0x00439d23: 0x422c32(DATA00 1번: 6칸 → 10, 6칸 → 240, 28칸 → 100), 0x422ca9(16 검정, DATA00 2번 → 60), DATA07 0x15b → 17, 0x1a7 → 201, 15 파랑
function palette(read: ReadAny): Uint8Array {
  const out = new Uint8Array(256 * 4);
  const put = (rgbx: Uint8Array, at: number) => {
    for (let i = 0; i < rgbx.length / 4; i++) out.set([rgbx[i * 4 + 2], rgbx[i * 4 + 1], rgbx[i * 4], 0], (at + i) * 4);
  };
  const common = read(1);
  put(common.subarray(0, 0x18), 10);
  put(common.subarray(0x18, 0x30), 240);
  put(common.subarray(0x30, 0xa0), 100);
  out.set([0, 0, 0, 0], 16 * 4);
  put(read(2), 60);
  put(read(data07(0x15b)), 17);
  put(read(data07(0x1a7)), 201);
  out.set([255, 0, 0, 0], 15 * 4);
  return out;
}

export const titlePalette = (art: TitleArt): Uint8Array => art.colors;

/** 타이틀 DIB: 바탕·로고, 반짝임 프레임(0 없음, 1~25), 메뉴(그림자 10 → 본문 0xb, 마우스 위 0xf) */
export function titleImage(art: TitleArt, hover: number, glint: number): Uint8Array {
  const out = art.base.slice();
  if (glint > 0) {
    const g = art.glints[glint - 1];
    overlay(out, g.image, g.w, g.h, LOGO_AT.x + g.sx, LOGO_AT.y + g.sy);
  }
  MENU_ITEMS.forEach((label, i) => {
    const y = MENU.y + MENU.step * i;
    drawText(out, (y + 1) * TITLE_W + MENU.x + 1, TITLE_W, label, SHADOW, art.glyphs);
    drawText(out, y * TITLE_W + MENU.x, TITLE_W, label, hover === i ? HOVER : TEXT, art.glyphs);
  });
  return out;
}

/** 메뉴 항목의 다음 단계(0x426a3a): Select Level 0x426727, 마스터 만들기 0x450e35, 월드 0x450ed7, 네트워크 0x44f2e0, 이어 하기·게임 데이터 0x441c62, 프레임 닫기 */
export type TitleAction = 'selectLevel' | 'expertMode' | 'freeBattle' | 'networkBattle' | 'loadData' | 'quit';
const TITLE_ACTIONS: readonly TitleAction[] = ['selectLevel', 'expertMode', 'freeBattle', 'networkBattle', 'loadData', 'quit'];
export const titleAction = (hit: number): TitleAction | null => TITLE_ACTIONS[hit] ?? null;

/** vmv2.exe 0x004269d0: 항목 0~5, 그 밖 −1 */
export function titleHit(x: number, y: number): number {
  if (x < MENU.x || x >= MENU.x + MENU.width) return -1;
  const i = Math.floor((y - MENU.y) / MENU.step);
  return i >= 0 && i < MENU_ITEMS.length && y - MENU.y - i * MENU.step < MENU.height ? i : -1;
}

/** 반짝임(0x439f40): j = 틱 − 메뉴가 뜬 틱. 200틱마다 25프레임, 첫 번째는 j = 201 */
export const glintFrame = (j: number): number => (j > GLINT_PERIOD && j % GLINT_PERIOD >= 1 && j % GLINT_PERIOD <= GLINT_FRAMES ? j % GLINT_PERIOD : 0);

/** 팝업 그림 원점(0x43b255): (화면 − 768) / 2, C 나눗셈 */
export const titleOrigin = (screen: Size): Point => ({ x: Math.trunc((screen.width - TITLE_W) / 2), y: Math.trunc((screen.height - TITLE_H) / 2) });

/** FALCOM.AVI(MCIWnd) 화면 가운데 */
export const aviOrigin = (screen: Size): Point => ({ x: Math.trunc((screen.width - AVI_W) / 2), y: Math.trunc((screen.height - AVI_H) / 2) });
