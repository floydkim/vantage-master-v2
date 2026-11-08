// 프리 모드 월드 장면(장면 3, 0x4516f4)의 그림: 월드 창(768 × 512, 0x452175), 맵 정보 창(308 × 340, 0x429eec), 마스터 정보 창(416 × 416, 0x42b5c2)과
// 그 판정(0x452385·0x42ab35·0x42bef4). 칩은 월드 칩 기준(0x43f8e4 = 전역 칩 0x1000 + k, 24 × 12)에서 세고 0x10 픽셀은 투명(0x43f9c3).
// 글자는 1바이트 글꼴, 그림자 (x + 1, y + 1) 색 10 뒤 본문 (x, y) 색 0xb. 값은 해독 메모 notes_world.md
import type { SideRecord } from '../../engine/state.ts';
import { readDescriptions, readMapLabel } from '../../formats/descriptions.ts';
import type { ExeImage } from '../../formats/exeImage.ts';
import type { GameMap } from '../../formats/mapData.ts';
import { readNatialTable } from '../../formats/natialTable.ts';
import { readActionNames } from '../../formats/actionTable.ts';
import { u32 } from '../battle/attack.ts';
import { drawText, readGlyphs } from '../battle/font.ts';
import { CHIP, CHIP_H, CHIP_W, type ReadAny, TRANSPARENT } from '../battle/sheet.ts';
import { UNIT_GRAPHICS } from '../battle/sprites.ts';
import { formatC } from '../battle/statusWindow.ts';

export const WORLD_W = 768;
export const WORLD_H = 512;
export const MAP_INFO_W = 308;
export const MAP_INFO_H = 340;
export const MASTER_INFO_W = 416;
export const MASTER_INFO_H = 416;
const MAP_COUNT = 52;
const SHIFT = 0x70;
const POINTS = 0x4759f8; // 맵 점(i32 x, y) 52개
const PAGES: readonly (readonly [number, number])[] = [[0x19, 0], [0x15, 6], [0x17, 0x12], [0x18, 0x2a]]; // DATA00 리소스 → 페이지
const UNIT_PAGES = [0x54, 0x62]; // 마스터 정보 초상(진영 0·1, 0x42af2e)
const PORTRAIT_POSE = 0x10; // 배치표 묶음 0(DATA00 5) 자세 0x10
const LAYOUT_SET0 = 5;
const ITEMS = 0x468d60; // 16바이트 × 30: +0 종류(1 네이티얼), +4 번호, +8 이름
const SHADOW = 10;
const TEXT = 0xb;

export interface WorldArt {
  readonly exe: ExeImage;
  readonly read: ReadAny;
  /** DATA00 0x1c 지도(바이트 + 0x70) */
  readonly map: Uint8Array;
  /** DATA00 0x1e 맵 정보 바탕, 0x1f 깬 맵 덮개(0x38~0x3b만 + 0x70) */
  readonly mapInfo: Uint8Array;
  readonly cover: Uint8Array;
  /** DATA00 0x20 마스터 정보 바탕 416 × 416과 강조판(0x38~0x3b만 + 0x70) */
  readonly masterInfo: Uint8Array;
  /** 월드 칩(k = 0 …), 칩 0x120바이트 */
  readonly chips: Uint8Array;
  /** 배치표 묶음 0 자세 0x10(u16 32칸) */
  readonly portrait: Uint16Array;
  /** 색 바꿈 표 1(꺼진 아이콘: v ≥ 0x11 → + 0x70) */
  readonly dim: Uint8Array;
  readonly glyphs: Uint8Array;
  readonly points: readonly (readonly [number, number])[];
  readonly natialNames: readonly string[];
  readonly actionNames: readonly (string | null)[];
  /** 진영마다 초상을 읽은 마스터(0x42af2e), 없으면 −1 */
  readonly loaded: number[];
}

const shift38 = (b: Uint8Array) => b.map((v) => (v >= 0x38 && v <= 0x3b ? v + SHIFT : v));

/** vmv2.exe 0x004516f4: 월드 장면 그림 재료 */
export function loadWorldArt(exe: ExeImage, read: ReadAny): WorldArt {
  const chips = new Uint8Array((UNIT_PAGES[1] + 0x10) * 16 * CHIP);
  for (const [id, page] of PAGES) chips.set(read(id), page * 16 * CHIP);
  const layout = read(LAYOUT_SET0);
  const v = new DataView(exe.read(POINTS, MAP_COUNT * 8).buffer);
  return {
    exe,
    read,
    map: read(0x1c).slice(0, WORLD_W * WORLD_H).map((b) => (b + SHIFT) & 0xff),
    mapInfo: shift38(read(0x1e).slice(0, MAP_INFO_W * MAP_INFO_H)),
    cover: shift38(read(0x1f).slice(0, MAP_INFO_W * MAP_INFO_H)),
    masterInfo: shift38(read(0x20)),
    chips,
    portrait: new Uint16Array(layout.buffer.slice(layout.byteOffset + PORTRAIT_POSE * 0x40, layout.byteOffset + PORTRAIT_POSE * 0x40 + 0x40)),
    dim: exe.read(u32(exe, 0x473bb4 + 4), 256),
    glyphs: readGlyphs(read),
    points: Array.from({ length: MAP_COUNT }, (_, i) => [v.getInt32(i * 8, true), v.getInt32(i * 8 + 4, true)] as const),
    natialNames: readNatialTable(exe).map((n) => n.name),
    actionNames: readActionNames(exe),
    loaded: [-1, -1],
  };
}

// vmv2.exe 0x0043f9c3: 칩 하나, 0x10 투명, tint면 색 바꿈
function chip(out: Uint8Array, width: number, art: WorldArt, k: number, x: number, y: number, tint?: Uint8Array): void {
  const s = k * CHIP;
  for (let r = 0; r < CHIP_H; r++) {
    const row = (y + r) * width;
    for (let c = 0; c < CHIP_W; c++) {
      if (x + c < 0 || x + c >= width) continue;
      const p = art.chips[s + r * CHIP_W + c];
      if (p !== TRANSPARENT) out[row + x + c] = tint ? tint[p] : p;
    }
  }
}

const shadowed = (out: Uint8Array, width: number, art: WorldArt, x: number, y: number, text: string, color = TEXT) => {
  drawText(out, (y + 1) * width + x + 1, width, text, SHADOW, art.glyphs);
  drawText(out, y * width + x, width, text, color, art.glyphs);
};
const plain = (out: Uint8Array, width: number, art: WorldArt, x: number, y: number, text: string) => drawText(out, y * width + x, width, text, TEXT, art.glyphs);

// 0x452175 모드 이름: 프리 "     Free Battle", 시나리오 Easy·Normal, Expert
const MODE_LABELS = [0x475d28, 0x475d40, 0x475d58];
const FREE_LABEL = 0x475d14;

/** vmv2.exe 0x00452175: 지도, 모드 이름(프리 0x475d14, 시나리오 모드 0x475d28·0x475d40·0x475d58), 맵 점(고른 것 0xa0, 마우스 위 0x88, 그 밖 0x80 + 프레임; 깬 맵 0xa8·0x68·0x60) */
export function worldImage(art: WorldArt, flags: readonly number[], selected: number, hover: number, frame: number, mode: number | null = null): Uint8Array {
  const out = art.map.slice();
  shadowed(out, WORLD_W, art, 296, 460, art.exe.cString(mode === null ? FREE_LABEL : MODE_LABELS[mode]));
  art.points.forEach(([x, y], i) => {
    const f = flags[i];
    if (!f) return;
    const base = f === 1 ? (selected === i ? 0xa0 : hover === i ? 0x88 : 0x80) : selected === i ? 0xa8 : hover === i ? 0x68 : 0x60;
    chip(out, WORLD_W, art, base + frame, x - 12, y - 12);
    chip(out, WORLD_W, art, base + frame + 0x10, x - 12, y);
  });
  return out;
}

/** vmv2.exe 0x00452385: 점 가운데 ±8(16 × 16)의 첫 맵, 없으면 −1 */
export function worldHit(art: WorldArt, flags: readonly number[], x: number, y: number): number {
  return art.points.findIndex(([px, py], i) => flags[i] !== 0 && x >= px - 8 && x < px + 8 && y >= py - 8 && y < py + 8);
}

export interface MapInfoView {
  /** 0 시작 단추, 2~5 시간 제한 단추, −1 없음(0x42ab35) */
  readonly hover: number;
  readonly frame: number;
  /** 블록 +0x14: 0 SHORT, 1 MIDDLE, 2 LONG, 3 ∞ */
  readonly timeLimit: number;
  readonly cleared?: boolean;
  /** 시나리오: 깨면 받는 아이템(0x42da6c, 0x468d60 번호), −1·없음이면 안 그림 */
  readonly reward?: number;
}

/** vmv2.exe 0x00429eec: 바탕, 미리보기(DATA10 0xad + 맵 × 2, 위 168줄), 맵 이름·이름표·시작 시각·밝기, READY/FIGHT, 시간 제한 단추 */
export function mapInfoImage(art: WorldArt, map: GameMap, preview: Uint8Array, view: MapInfoView): Uint8Array {
  const out = art.mapInfo.slice();
  for (let r = 0; r < 168; r++) out.set(preview.subarray(r * 260, r * 260 + 260), (44 + r) * MAP_INFO_W + 24);
  if (view.cleared) for (let i = 0; i < out.length; i++) if (art.cover[i] !== TRANSPARENT) out[i] = art.cover[i];
  const start = new DataView(map.struct.buffer, map.struct.byteOffset).getInt32(0x3c, true);
  shadowed(out, MAP_INFO_W, art, 24, 24, map.header.name);
  shadowed(out, MAP_INFO_W, art, 216, 24, readMapLabel(art.exe, map.index));
  shadowed(out, MAP_INFO_W, art, 24, 220, formatC('%*d', 2, Math.trunc(start / 60)));
  shadowed(out, MAP_INFO_W, art, 48, 220, formatC(art.exe.cString(0x468c44), start % 60));
  shadowed(out, MAP_INFO_W, art, 80, 220, art.exe.cString(map.header.lightChanges ? 0x468c4c : u32(art.exe, 0x468b84 + map.header.fixedLight * 4)));
  const button = (c: number, x: number, y: number) => {
    chip(out, MAP_INFO_W, art, c, x, y);
    chip(out, MAP_INFO_W, art, c + 1, x + 24, y);
    chip(out, MAP_INFO_W, art, c + 0x10, x, y + 12);
    chip(out, MAP_INFO_W, art, c + 0x11, x + 24, y + 12);
  };
  if (view.reward !== undefined && view.reward !== -1) {
    // 0x429bfa: 아이템 그림(칩 2 × 6), 아이템 이름, 그 네이티얼·마법 이름
    const item = view.reward;
    const k = (item >> 3) * 0x60 + 0x120 + (item & 7) * 2;
    for (let r = 0; r < 6; r++) {
      chip(out, MAP_INFO_W, art, k + r * 0x10, 18, 244 + r * 12);
      chip(out, MAP_INFO_W, art, k + 1 + r * 0x10, 42, 244 + r * 12);
    }
    shadowed(out, MAP_INFO_W, art, 72, 260, art.exe.cString(u32(art.exe, ITEMS + item * 0x10 + 8)));
    const kind = u32(art.exe, ITEMS + item * 0x10);
    const value = u32(art.exe, ITEMS + item * 0x10 + 4);
    shadowed(out, MAP_INFO_W, art, 72, 280, kind === 1 ? art.natialNames[value - 1] : (art.actionNames[value] ?? ''));
  }
  if (!view.cleared) button((view.hover === 0 ? 0xe0 : 0xc0) + view.frame * 2, 220, 220);
  for (let i = 0; i < 4; i++) button(0x100 + 4 * i + (i === view.timeLimit ? 2 : 0), 220, 248 + 20 * i);
  return out;
}

/** vmv2.exe 0x0042ab35: 0 시작(220~267 × 220~243), 2 + i 시간 제한(220~267 × 248 + 20i ~ 265 + 20i), 그 밖 −1 */
export function mapInfoHit(x: number, y: number): number {
  if (x < 220 || x > 267) return -1;
  if (y >= 220 && y <= 243) return 0;
  if (y >= 248 && y <= 327 && (y - 248) % 20 < 18) return 2 + Math.trunc((y - 248) / 20);
  return -1;
}

/** 진영 레코드 목록에 아이템 u가 있는지(0x42d69f): 0~23 네이티얼 1~24, 24~29 마법 10~15 */
export const hasItem = (side: SideRecord, u: number): boolean => (u < 24 ? side.natials.includes(u + 1) : side.spells.includes(u - 24 + 10));

/** vmv2.exe 0x0042af2e: 두 진영 마스터의 유닛 그림(0x460704[마스터 × 2 + 진영])을 페이지 0x54·0x62에(바뀐 진영만) */
export function loadMasterPortraits(art: WorldArt, sides: readonly SideRecord[]): void {
  sides.forEach((s, n) => {
    if (art.loaded[n] === s.master) return;
    art.chips.set(art.read(u32(art.exe, UNIT_GRAPHICS + (s.master * 2 + n) * 4)).subarray(0, 0xe0 * CHIP), UNIT_PAGES[n] * 16 * CHIP);
    art.loaded[n] = s.master;
  });
}

/**
 * vmv2.exe 0x0042cb2a: 마스터 편집 대화 상자의 초상. 그 마스터·진영의 유닛 그림(0x4227d5(마스터, 진영, 0x2c6))을 색 바꿈 없이
 * 배치표 묶음 0 자세 0x10의 가운데 두 열(칩 2 × 6) = 48 × 72. 0x10은 투명이고, 원작은 위 48 × 67을 ×2로 그린다
 */
export function masterEditPortrait(art: WorldArt, master: number, side: number): Uint8Array {
  const chips = art.read(u32(art.exe, UNIT_GRAPHICS + (master * 2 + side) * 4));
  const out = new Uint8Array(48 * 72).fill(TRANSPARENT);
  for (let c = 1; c <= 2; c++) {
    for (let r = 0; r < 6; r++) {
      const v = art.portrait[c * 8 + r];
      if (v === 0x7ff) continue;
      for (let y = 0; y < CHIP_H; y++) out.set(chips.subarray(v * CHIP + y * CHIP_W, v * CHIP + (y + 1) * CHIP_W), ((5 - r) * CHIP_H + y) * 48 + (c - 1) * CHIP_W);
    }
  }
  return out;
}

/**
 * vmv2.exe 0x0042b5c2: 마스터 정보 창. hover H = 진영 × 32 + 칸(0 초상·이름, 1 조종, 2 + u 아이콘), −1 없음. 진영마다 초상(묶음 0 자세 0x10, 0x10 투명),
 * 이름, 레벨·최대 MP·능력치(그림자 없음), 아이콘 30개(가진 것이 아니면 색 바꿈 1), 조종 글자. 아이콘 위면 강조 틀·아이템 그림·유닛 그림·이름 두 줄
 */
export function masterInfoImage(art: WorldArt, sides: readonly SideRecord[], controllers: readonly number[], hover: number, editable: boolean): Uint8Array {
  loadMasterPortraits(art, sides);
  const out = art.masterInfo.slice(0, MASTER_INFO_W * MASTER_INFO_H);
  const W = MASTER_INFO_W;
  const s0 = hover >> 5;
  const t = hover & 0x1f;
  const plate = (from: number, w: number, h: number, x: number, y: number) => {
    for (let r = 0; r < h; r++) out.set(art.masterInfo.subarray(from + r * w, from + (r + 1) * w), (y + r) * W + x);
  };
  if (hover !== -1 && t === 0) plate(s0 === 0 ? 0x2a400 : 0x2ec00, 192, 96, s0 === 0 ? 0 : 224, 0);
  if (hover !== -1 && t === 1) plate(s0 === 0 ? 0x33400 : 0x34c00, 192, 32, s0 === 0 ? 0 : 224, 274);
  sides.forEach((side, s) => {
    const bx = s === 0 ? 16 : 240;
    const by = 16;
    // 0x43fb44(받을 곳 (bx − 24, by − 10), 페이지, 묶음 0, 자세 0x10)
    for (let c = 0; c < 4; c++) {
      for (let j = 0; j < 8; j++) {
        const v = art.portrait[c * 8 + j];
        if (v === 0x7ff) continue;
        chip(out, W, art, UNIT_PAGES[s] * 16 + v, bx - 24 + c * CHIP_W, by - 10 + (7 - j) * CHIP_H);
      }
    }
    shadowed(out, W, art, bx, by, side.name);
    const num = (x: number, y: number, v: number, w: number) => plain(out, W, art, bx + x, by + y, formatC('%*d', w, v));
    num(70, 20, side.level + 1, 2);
    num(110, 20, side.maxMp, 3);
    num(70, 38, side.attack, 2);
    num(70, 56, side.defense, 2);
    num(106, 38, side.magic, 2);
    num(106, 56, side.magicDefense, 2);
    num(142, 38, side.speed, 2);
    num(142, 56, side.movement, 2);
    for (let i = 0; i < 30; i++) {
      const x = bx + 8 + 24 * (i % 6);
      const y = by + 78 + 36 * Math.trunc(i / 6);
      const tint = hasItem(side, i) ? undefined : art.dim;
      chip(out, W, art, i, x, y, tint);
      chip(out, W, art, i + 0x20, x, y + 12, tint);
      chip(out, W, art, i + 0x40, x, y + 24, tint);
    }
  });
  controllers.forEach((c, s) => shadowed(out, W, art, s === 0 ? 56 : 280, 282, art.exe.cString(c === 1 ? 0x468d18 : 0x468d34)));
  if (hover !== -1 && t >= 2) {
    const u = t - 2;
    const side = sides[s0];
    if (editable || hasItem(side, u)) {
      const bx = s0 === 0 ? 16 : 240;
      const x = bx + 8 + 24 * (u % 6);
      const y = 16 + 78 + 36 * Math.trunc(u / 6);
      chip(out, W, art, 0x1f, x, y);
      chip(out, W, art, 0x3f, x, y + 12);
      chip(out, W, art, 0x5f, x, y + 24);
      // 0x429bfa(아이템 그림)·0x42b2e2(유닛 그림): 칩 2열 × 6줄
      const picture = (base: number, px: number) => {
        for (let r = 0; r < 6; r++) {
          chip(out, W, art, base + 16 * r, px, 320 + 12 * r);
          chip(out, W, art, base + 16 * r + 1, px + 24, 320 + 12 * r);
        }
      };
      picture(0x120 + Math.trunc(u / 8) * 0x60 + (u % 8) * 2, 80);
      const k = u < 24 ? u + 24 * s0 : u + 24;
      picture(0x2a0 + Math.trunc(k / 8) * 0x60 + (k % 8) * 2, 144);
      const item = ITEMS + u * 16;
      shadowed(out, W, art, 208, 336, art.exe.cString(u32(art.exe, item + 8)));
      const n = u32(art.exe, item + 4);
      shadowed(out, W, art, 208, 356, formatC(art.exe.cString(0x468d3c), u32(art.exe, item) === 1 ? art.natialNames[n - 1] : (art.actionNames[n] ?? '')));
    }
  }
  return out;
}

/** vmv2.exe 0x0042bef4: 진영 × 32 + (0 초상·이름, 1 조종, 2 + 행 × 6 + 열 아이콘), 그 밖 −1. 편집할 수 없으면 아이콘만 */
export function masterInfoHit(x: number, y: number, editable: boolean): number {
  const s = x < 240 ? 0 : 1;
  const px = x - (s ? 240 : 16);
  const py = y - 16;
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 6; c++) {
      if (px >= 8 + 24 * c && px < 32 + 24 * c && py >= 78 + 36 * r && py < 114 + 36 * r) return r * 6 + c + 2 + 32 * s;
    }
  }
  if (!editable) return -1;
  if (px >= 0 && px <= 159 && py >= 0 && py <= 75) return 32 * s;
  if (px >= 40 && px <= 119 && py >= 266 && py <= 281) return 32 * s + 1;
  return -1;
}

/** vmv2.exe 0x0042aa8f: 맵 정보 누르기. READY는 깬 맵이 아닐 때만(+0x10, 0x4514a2의 플래그 ≠ 2), 시간 제한 단추는 늘 */
export function mapInfoClick(hit: number, cleared: boolean): 'start' | 'timeLimit' | null {
  if (hit === 0) return cleared ? null : 'start';
  return hit >= 2 ? 'timeLimit' : null;
}

/** vmv2.exe 0x0042bd5e: 마스터 정보 누르기. 초상은 편집, 조종 칸은 바꾸기, 아이콘은 편집할 수 있을 때만(+8 = 0x42ad13의 프리 모드) 넣고 빼기 */
export function masterInfoClick(hit: number, editable: boolean): 'edit' | 'controller' | 'toggle' | null {
  if (hit < 0) return null;
  const t = hit & 0x1f;
  if (t === 0) return 'edit';
  if (t === 1) return 'controller';
  return editable ? 'toggle' : null;
}

/**
 * 클릭 효과음(0x443d19). hit은 각 창 판정 값. 맵 점 1(0x4514a2), READY 1 + 1(0x45042d·0x429a67), 시간 제한 4(0x429db7, 같은 값도),
 * 초상 1(0x42bd5e), 조종·아이콘 4(0x42b502·0x42b4ab). 빈 곳은 없다(마우스 위도 없음)
 */
export function clickSounds(window: 'world' | 'mapInfo' | 'masterInfo', hit: number): number[] {
  if (hit < 0) return [];
  if (window === 'world') return [1];
  if (window === 'mapInfo') return hit === 0 ? [1, 1] : hit >= 2 ? [4] : [];
  return (hit & 0x1f) === 0 ? [1] : [4];
}

/** 맵 설명(0x424e78): 맵을 고르면 도움말 창에. 시나리오 플래그(*0x5061d8, 시나리오·Expert)가 서 있으면 맵 +0x78, 아니면 +0x1a0 */
export const mapDescription = (map: GameMap, scenario: boolean): string => {
  const bytes = map.struct.subarray(scenario ? 0x78 : 0x1a0);
  const end = bytes.indexOf(0);
  return String.fromCharCode(...bytes.subarray(0, end < 0 ? bytes.length : end)); // 바이트 그대로(맵 이름과 같은 까닭)
};

export { readDescriptions };

/** vmv2.exe 0x004514a2 창 순서(뒤가 위): 새로 만든 맵 정보(0x429883)·마스터 정보(0x42ad13)는 만든 차례로 맨 위, 그 뒤 월드 창이 맨 위면 맨 아래로. 이미 열린 창은 그대로 */
export function mapSelectOrder<T extends string>(order: readonly T[], created: readonly T[], world: T): T[] {
  let out = [...order];
  for (const c of created) out = [...out.filter((k) => k !== c), c];
  if (out[out.length - 1] === world) out = [world, ...out.filter((k) => k !== world)];
  return out;
}
