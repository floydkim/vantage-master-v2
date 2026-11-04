// 전장 팔레트. 기본 팔레트(vmv2.exe 0x483568, PALETTEENTRY 236개)를 맵 _PL(7번부터, 0x4224a0)과 공통 리소스 1·2(0x422c32·0x422ca9)로
// 짓고, 하루 중 시각에 따라 6번부터 다시 계산한다(0x4029ab). DIB 색 표에는 10번부터 236개가 들어간다(0x41b08f → 0x42edec).
import { cdiv } from '../../engine/rules/cint.ts';
import type { ExeImage } from '../../formats/exeImage.ts';
import type { GameMap } from '../../formats/mapData.ts';

export const GAME_COLORS = 236;
export const FIRST_COLOR = 10;
const COMMON_A = 1; // 0xa0바이트: 0~5번, 0xe6~0xeb번, 0x5a~0x75번
const COMMON_B = 2; // 0x32번부터
const HOUR_R = 0x45e124;
const HOUR_G = 0x45e1e4;
const HOUR_B = 0x45e184;

/** 맵을 읽은 뒤의 기본 팔레트(0x483568): 시작 팔레트 위에 맵 _PL을 7번부터 (0x4224a0) */
export function basePalette(read: (id: number) => Uint8Array, map: GameMap): Uint8Array {
  const p = commonPalette(read);
  const s = new DataView(map.struct.buffer, map.struct.byteOffset);
  const own = read(s.getUint32(0x1c, true));
  p.set(own.subarray(0, Math.min(own.length, p.length - 7 * 4)), 7 * 4);
  return p;
}

// 프로그램 시작 때의 기본 팔레트(0x422cd8 → 0x422c32·0x422ca9)
function commonPalette(read: (id: number) => Uint8Array): Uint8Array {
  const p = new Uint8Array(GAME_COLORS * 4);
  commonPaletteA(p, read);
  commonPaletteB(p, read);
  return p;
}

/** vmv2.exe 0x00422c32: 공통 리소스 1(0~5번, 0xe6~0xeb번, 0x5a~0x75번) */
export function commonPaletteA(p: Uint8Array, read: (id: number) => Uint8Array): void {
  const a = read(COMMON_A);
  p.set(a.subarray(0, 0x18), 0);
  p.set(a.subarray(0x18, 0x30), 0xe6 * 4);
  p.set(a.subarray(0x30, 0xa0), 0x5a * 4);
}

/** vmv2.exe 0x00422ca9: 6번 검정, 공통 리소스 2(0x32번부터) */
export function commonPaletteB(p: Uint8Array, read: (id: number) => Uint8Array): void {
  p[6 * 4] = 0;
  p[6 * 4 + 1] = 0;
  p[6 * 4 + 2] = 0;
  const b = read(COMMON_B);
  p.set(b.subarray(0, Math.min(b.length, p.length - 200)), 200);
}

const clamp = (v: number) => Math.max(0, Math.min(0xff, v));

/** 하루 중 시각(분, GameState.timeOfDay)의 팔레트(0x482a0c). 계산하지 않는 칸(0~5번, 0x76번~)은 기본 팔레트 그대로 (vmv2.exe 0x004029ab) */
export function timePalette(exe: ExeImage, map: GameMap, base: Uint8Array, minute: number): Uint8Array {
  const out = new Uint8Array(base);
  const s = new DataView(map.struct.buffer, map.struct.byteOffset);
  const i32 = (o: number) => s.getInt32(o, true);
  const table = (va: number) => Array.from({ length: 24 }, (_, i) => new DataView(exe.read(va + i * 4, 4).buffer).getInt32(0, true));
  const hours = [table(HOUR_R), table(HOUR_G), table(HOUR_B)];
  const m = minute % 0x3c;
  const h = (minute / 0x3c) | 0;
  const next = (h + 1) % 0x18;
  const scaled = (i: number, c: number) => clamp(cdiv(Math.imul(base[i * 4 + c], i32(0x44 + c * 8)) + i32(0x48 + c * 8) * 0x100, 0x100));
  const copy = (from: number, to: number) => out.set(base.subarray(from * 4, to * 4), from * 4);
  if (i32(0x34) === 0) {
    for (let i = 6; i < 0x5a; i++) for (let c = 0; c < 3; c++) out[i * 4 + c] = scaled(i, c);
    copy(0x5a, 0x76);
    return out;
  }
  const end = i32(0x40) + 6;
  let i = 6;
  for (; i < end; i++) {
    for (let c = 0; c < 3; c++) {
      const t = hours[c];
      out[i * 4 + c] = Math.min(0xff, cdiv(base[i * 4 + c] * (t[h] * (0x3c - m) + t[next] * m), 6000));
    }
  }
  for (; i < 0x32; i++) out.set(base.subarray(i * 4, i * 4 + 4), i * 4);
  for (; i < 0x5a; i++) {
    for (let c = 0; c < 3; c++) {
      const t = hours[c];
      const k = (cdiv(t[h] * 3, 4) + 0x19) * (0x3c - m) + (cdiv(t[next] * 3, 4) + 0x19) * m;
      out[i * 4 + c] = Math.min(0xff, cdiv(scaled(i, c) * k, 6000));
    }
  }
  copy(0x5a, 0x76);
  return out;
}

/** DIB 색 표(RGBQUAD 256개: B, G, R, 0)의 10~245번 */
export function dibColors(palette: Uint8Array): Uint8Array {
  const q = new Uint8Array(256 * 4);
  for (let i = 0; i < GAME_COLORS; i++) {
    q[(FIRST_COLOR + i) * 4] = palette[i * 4 + 2];
    q[(FIRST_COLOR + i) * 4 + 1] = palette[i * 4 + 1];
    q[(FIRST_COLOR + i) * 4 + 2] = palette[i * 4];
  }
  return q;
}

const DARK_FIRST = 0x76;
const DARK_END = 0xe6;
const DARK_FROM = 0x70; // 0x76번은 6번에서

/** 사람 입력 중 어두운 칸(vmv2.exe 0x004027e3): 0x76~0xe5번 = 6~0x75번 색을 채널마다 (v − 20)/3(20 미만 0). 처음에는 어느 팔레트 자료도
 *  이 칸을 채우지 않아 검정이고, 입력 시작(0x4055cf)·범위 보이기(0x43d3a6)·유닛 메뉴 닫기(0x405e1d) 때 지금 시각 팔레트로 다시 계산한다 */
export function darkenPalette(palette: Uint8Array, from = palette): Uint8Array {
  const out = new Uint8Array(palette);
  for (let i = DARK_FIRST; i < DARK_END; i++) {
    for (let c = 0; c < 3; c++) {
      const v = from[(i - DARK_FROM) * 4 + c];
      out[i * 4 + c] = v < 20 ? 0 : cdiv(v - 20, 3);
    }
  }
  return out;
}

/** 어두운 칸(0x76~0xe5번)의 상태: 처음엔 검정, 사람 입력 중엔 어두운 판(0x4027e3), 공격·마법 연출을 시작하면 밝은 사본(0x402954),
 *  정보 대화 상자를 열면 기본 팔레트(시각 보정 없음) 사본(0x402902) */
export type Shade = 'black' | 'dark' | 'bright' | 'base';

/** vmv2.exe 0x00402954: 0x76~0xe5번 = 6~0x75번 색 그대로 */
export function brightenPalette(palette: Uint8Array, from = palette): Uint8Array {
  const out = new Uint8Array(palette);
  out.set(from.subarray((DARK_FIRST - DARK_FROM) * 4, (DARK_END - DARK_FROM) * 4), DARK_FIRST * 4);
  return out;
}

const trunc8 = (v: number) => Math.trunc(v / 0x100);

/**
 * 팔레트 번쩍임(vmv2.exe 0x0041b284 걸기, 0x0041b421 틱마다). 칸마다 걸 때의 섞임 색(from)에서 목표 색·알파(target)로 t를 256에서 step씩 줄이며 옮기고,
 * 그 색을 기본 색과 알파로 섞는다. t가 0이 된 칸은 마지막 섞임을 그대로 둔다
 */
export class Flash {
  private readonly target = new Int32Array(GAME_COLORS * 4); // r, g, b, 알파(0x482210·0x481350·0x480bf0·0x480490)
  private readonly from = new Int32Array(GAME_COLORS * 4); // 0x481e60·0x480840·0x48265c·0x481ab0
  private readonly t = new Int32Array(GAME_COLORS); // 0x481700
  private readonly step = new Int32Array(GAME_COLORS); // 0x480fa0
  private readonly mix = new Int32Array(GAME_COLORS * 4); // 지난 틱의 섞임 색과 알파
  private readonly touched = new Uint8Array(GAME_COLORS);

  /** vmv2.exe 0x0041b284: first~end − 1번에 목표 (r, g, b, 알파), 틱마다 step */
  start(r: number, g: number, b: number, a: number, step: number, first: number, end: number): void {
    for (let i = first; i < end; i++) {
      const t = this.t[i];
      for (let c = 0; c < 4; c++) this.from[i * 4 + c] = trunc8(this.target[i * 4 + c] * (0x100 - t) + this.from[i * 4 + c] * t);
      this.target.set([r, g, b, a], i * 4);
      this.t[i] = 0x100;
      this.step[i] = step;
    }
  }

  /** vmv2.exe 0x0041b166: first~end − 1번을 (r, g, b)·알파로 바로(진행 없음) */
  set(r: number, g: number, b: number, a: number, first: number, end: number): void {
    for (let i = first; i < end; i++) {
      this.target.set([r, g, b, a], i * 4);
      this.t[i] = 0;
      this.step[i] = 0;
      this.mix.set([r, g, b, a], i * 4);
      this.touched[i] = 1;
    }
  }

  /** vmv2.exe 0x0041b421: 진행 중인 칸이 있으면 true(0x402785로 색 표를 다시) */
  tick(): boolean {
    let active = false;
    for (let i = 0; i < GAME_COLORS; i++) {
      if (this.t[i] === 0) continue;
      active = true;
      const t = (this.t[i] = Math.max(this.t[i] - this.step[i], 0));
      for (let c = 0; c < 4; c++) this.mix[i * 4 + c] = trunc8(this.from[i * 4 + c] * t + this.target[i * 4 + c] * (0x100 - t));
      this.touched[i] = 1;
    }
    return active;
  }

  /** vmv2.exe 0x0041b117(공격·마법 연출 시작 0x402954): 진행·알파를 지운다. 0x76~0xe5번은 0x402954가 기본 색으로 되돌린다 */
  reset(): void {
    this.t.fill(0);
    this.step.fill(0);
    for (let i = 0; i < GAME_COLORS; i++) this.target[i * 4 + 3] = 0;
    this.touched.fill(0, DARK_FIRST, DARK_END);
  }

  /** 섞은 칸을 기본 색과 알파로 섞어 쓴다(0x41b421의 0x482a0c) */
  apply(palette: Uint8Array): Uint8Array {
    const out = new Uint8Array(palette);
    for (let i = 0; i < GAME_COLORS; i++) {
      if (!this.touched[i]) continue;
      const a = this.mix[i * 4 + 3];
      for (let c = 0; c < 3; c++) out[i * 4 + c] = trunc8(palette[i * 4 + c] * (0x100 - a) + this.mix[i * 4 + c] * a) & 0xff;
    }
    return out;
  }
}

const RESULT_COLORS = 0x21; // DATA00: 111색 → 118~228번

/** vmv2.exe 0x00407d43 앞부분: 결과 창 팔레트. 전투 끝 팔레트(battle) 위에 공통 리소스 1·2(0x422c32·0x422ca9)와 DATA00 0x21(118~228번)을 덮는다.
 *  7~49번과 229번은 전투 값이 남는다 */
export function resultPalette(read: (id: number) => Uint8Array, battle: Uint8Array): Uint8Array {
  const p = new Uint8Array(battle);
  const common = commonPalette(read);
  const b = read(COMMON_B);
  for (const [from, to] of [[0, 7], [50, 50 + b.length / 4], [0x5a, 0x76], [0xe6, 0xec]]) p.set(common.subarray(from * 4, to * 4), from * 4);
  const r = read(RESULT_COLORS);
  p.set(r.subarray(0, Math.min(r.length, (229 - 118) * 4)), 118 * 4);
  return p;
}

const WORLD_COLORS = 0x1d; // DATA00: 44색 → 118~161번

/** vmv2.exe 0x004516f4·0x00429a8e: 월드 장면 팔레트. 공통 리소스 1·2, DATA00 0x1d(118~161번), 50~117번의 채널마다 v / 3(162~229번), 고른 맵의 _PL(7~49번) */
export function worldPalette(read: (id: number) => Uint8Array, mapPl: Uint8Array | null, cleared = false): Uint8Array {
  const p = commonPalette(read);
  const w = read(WORLD_COLORS);
  p.set(w.subarray(0, Math.min(w.length, 44 * 4)), 118 * 4);
  for (let i = 50; i < 118; i++) for (let c = 0; c < 3; c++) p[(i + 0x70) * 4 + c] = Math.trunc(p[i * 4 + c] / 3);
  if (mapPl) p.set(mapPl.subarray(0, Math.min(mapPl.length, 43 * 4)), 7 * 4);
  // 0x429a8e: 깬 맵(시나리오)은 미리보기 7~0x31번을 2/3로
  if (cleared) for (let i = 7; i < 0x32; i++) for (let c = 0; c < 3; c++) p[i * 4 + c] = Math.trunc((p[i * 4 + c] * 2) / 3);
  return p;
}
