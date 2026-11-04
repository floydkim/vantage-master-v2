// 전투 상태 창(Information window, CBattleStatus, 260 × 340). 원작은 전투를 시작할 때 바탕(DATA00 0x1b)과 이름표를 그리고(0x40b12a),
// 상태가 바뀔 때마다(0x40aee4 → 0x40b50d) 값이 바뀐 칸만 열 홀짝 무늬로 지우고(0x40cd4a) 다시 그린다. 지우지 않고 덮는 칸도 있어
// 결과가 그린 순서를 따르므로, 같은 캐시를 가진 그림판으로 옮긴다. 유닛 값은 실행 중 유닛 레코드(③a World)에서 읽는다.
import { World } from '../../ai/world.ts';
import type { AiData } from '../../ai/world.ts';
import type { Cell } from '../../engine/command.ts';
import { lightPhase } from '../../engine/rules/light.ts';
import { GRID, partByte, workGrid } from '../../engine/rules/terrain.ts';
import { type GameState, MASTERS } from '../../engine/state.ts';
import type { ExeImage } from '../../formats/exeImage.ts';
import { natialOf } from '../../engine/rules/summon.ts';
import { drawText, readGlyphs } from './font.ts';
import { type RasterTables, readRasterTables } from './raster.ts';
import { CHIP, CHIP_H, CHIP_W, type ReadAny, TRANSPARENT } from './sheet.ts';
import { type BattleArt, loadUnitPages } from './screen.ts';
import { unitPage } from './sprites.ts';
import { NO_LIMIT } from './timeLimit.ts';

export const STATUS_W = 260;
export const STATUS_H = 340;
const PITCH = 0x104;
const BACKGROUND = 0x1b;
const SHADOW = 10;
const TEXT = 0xb;
const BAR_COLORS = 0x45f2ac; // 막대 색 줄들
const EXP_ON = 0x45f2e0; // 경험치 막대 7줄(찬 곳)
const EXP_OFF = 0x45f2e7; // 7줄(빈 곳)
const TERRAIN_NAMES = 0x45f210; // 지형 종류 17개
const MOVE_TYPE_NAMES = 0x45f254; // 이동 타입 5개
const DEFENSE = 0x45f268; // 지형 종류별 방어(%)
const BAR_MAX = 0xec;
const NONE = 0x7ff;
const WORDS = { def: 0x45f458, hei: 0x45f45c, water: 0x45f460, decre: 0x45f468, incre: 0x45f470 }; // "Def" "Hei" "B/H%3d" "Decre" "Incre"
const DEPTH = [0x45f484, 0x45f48c, 0x45f494]; // "Depth 1"~"Depth 3"
const TIME_STRIP = 0x45f2f0; // 시간 칸 17줄 바탕색
const TIME_BAR = 0x45f304; // 시간 막대 3줄 × 3색
const TIME_FLAME_TOP = [0x101f, 0x105e, 0x105f, 0x103f]; // 0x45f310[R & 3]
const TIME_FLAME_BOTTOM = [0x102f, 0x106e, 0x106f, 0x104f]; // 0x45f320[R & 3]

/** C sprintf의 부분: %d, %Nd, %0Nd, %*d, %s, %Ns, %-Ns(왼쪽 맞춤), %% */
export function formatC(format: string, ...args: readonly (number | string)[]): string {
  let i = 0;
  return format.replace(/%(-?)(0?)(\*|\d*)([ds%])/g, (_, left: string, zero: string, width: string, kind: string) => {
    if (kind === '%') return '%';
    const w = width === '*' ? Number(args[i++]) : width ? Number(width) : 0;
    const v = String(args[i++]);
    return left ? v.padEnd(w, ' ') : v.padStart(w, zero && kind === 'd' ? '0' : ' ');
  });
}

export interface StatusEnv {
  readonly exe: ExeImage;
  readonly read: ReadAny;
  readonly art: BattleArt;
  readonly data: AiData;
  /** 맵 이름표(0x5061f0[맵], 실행 중에 채움) */
  readonly mapLabel: string;
}

export interface StatusView {
  readonly state: GameState;
  /** 커서 칸(0x476be0·0x476be4), 없으면 null */
  readonly cursor: Cell | null;
  /** 커서 칸의 유닛(0x476bf8, state.units 번호), 없으면 null */
  readonly unit: number | null;
  /** 물 애니메이션 프레임(0x49de20): 물 부품을 돌린다 */
  readonly water: number;
  /** 커서 유닛 초상의 자세(표시 객체 +0xb, 대기 애니메이션이 바꾼다). 없으면 상태의 자세 */
  readonly pose?: number;
  /** 생각 시간(timeLimit.ts): 타이머 켬(0x476adc), 남은 1/6초(0x476ae0), 아이콘 진영의 연장 횟수(*0x476af0, 없으면 0). 없으면 꺼짐·0 */
  readonly time?: { readonly on: boolean; readonly remaining: number; readonly extensions: number };
}

export class StatusWindow {
  readonly image: Uint8Array;
  private readonly env: StatusEnv;
  private readonly glyphs: Uint8Array;
  private readonly tables: RasterTables;
  private readonly colors: Uint8Array;
  private readonly expOn: Uint8Array;
  private readonly expOff: Uint8Array;
  private readonly terrainNames: readonly string[];
  private readonly moveTypeNames: readonly string[];
  private readonly defense: readonly number[];
  // 0x40b12a가 두는 캐시(창 객체 +0x08~+0x38)
  private time = -1;
  private waterStage = -1;
  private waterMinutes = -1;
  private mp0 = -1;
  private mp1 = -1;
  private recovery0 = -1;
  private recovery1 = -1;
  private upkeep0 = -1;
  private upkeep1 = -1;
  private hadUnit = 1;
  private timeOn = true;
  private timeRemaining = -1;
  private shownExtensions = -1;

  constructor(env: StatusEnv, view: StatusView) {
    this.env = env;
    const { exe, read } = env;
    this.glyphs = readGlyphs(read);
    this.tables = readRasterTables(exe);
    this.colors = exe.read(BAR_COLORS, 0x40);
    this.expOn = exe.read(EXP_ON, 7);
    this.expOff = exe.read(EXP_OFF, 7);
    const strings = (at: number, n: number) => {
      const v = new DataView(exe.read(at, n * 4).buffer);
      return Array.from({ length: n }, (_, i) => exe.cString(v.getUint32(i * 4, true)));
    };
    this.terrainNames = strings(TERRAIN_NAMES, 17);
    this.moveTypeNames = strings(MOVE_TYPE_NAMES, 5);
    const d = new DataView(exe.read(DEFENSE, 17 * 4).buffer);
    this.defense = Array.from({ length: 17 }, (_, i) => d.getInt32(i * 4, true));
    // vmv2.exe 0x0040b12a
    this.image = read(BACKGROUND).slice(0, PITCH * STATUS_H);
    const { state } = view;
    const name = env.data.map.header.name;
    this.text(name, 0xa35, SHADOW);
    this.text(name, 0x930, TEXT);
    this.text(env.mapLabel, 0xad5, SHADOW);
    this.text(env.mapLabel, 0x9d0, TEXT);
    this.text(state.sides[0].name, 0x35e1, SHADOW);
    this.text(state.sides[0].name, 0x34dc, TEXT);
    this.num(state.sides[0].maxMp, 3, 0x35a4);
    this.text(state.sides[1].name, 0x5d7d, SHADOW);
    this.text(state.sides[1].name, 0x5c78, TEXT);
    this.num(state.sides[1].maxMp, 3, 0x5d40);
    this.text(exe.cString(WORDS.def), 0x8893, TEXT);
    this.text(exe.cString(WORDS.hei), 0x9bdf, TEXT);
    this.update(view);
  }

  private text(s: string, at: number, color: number): void {
    drawText(this.image, at, PITCH, s, color, this.glyphs);
  }

  // vmv2.exe 0x00423b8c: sprintf("%*d", width, value)
  private num(value: number, width: number, at: number): void {
    this.text(formatC('%*d', width, value), at, TEXT);
  }

  // vmv2.exe 0x0040cd4a: 칸을 열 홀짝 무늬(짝수 열 0xf5, 홀수 열 10)로
  private restore(x: number, y: number, w: number, h: number): void {
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) this.image[(y + r) * PITCH + x + c] = (x + c) % 2 === 0 ? 0xf5 : 10;
  }

  private fill(at: number, color: number, count: number): void {
    this.image.fill(color, at, at + count);
  }

  // vmv2.exe 0x0043f8f1(통째) · 0x0043f9c3(투명 0x10 건너뜀): 전장 시트의 칩을 창에
  private chip(at: number, id: number, tint: number, transparent = false): void {
    const t = this.tables.tints[tint];
    const src = this.env.art.sheet.chips;
    const s = id * CHIP;
    for (let r = 0; r < CHIP_H; r++) {
      for (let c = 0; c < CHIP_W; c++) {
        const v = src[s + r * CHIP_W + c];
        if (transparent && v === TRANSPARENT) continue;
        this.image[at + r * PITCH + c] = t ? t[v] : v;
      }
    }
  }

  /** vmv2.exe 0x0040b50d: 바뀐 값의 칸을 다시 그린다(생각 시간 칸만은 updateTime 0x40b00c) */
  update(view: StatusView): void {
    const world = new World(this.env.data, view.state, []);
    loadUnitPages(this.env.art, view.state); // 초상은 유닛 그림 페이지의 칩
    this.clockAndWater(view.state);
    this.sideBars(view.state, world);
    this.terrainText(view);
    this.unitText(view, world);
    if (view.state.timeLimit !== NO_LIMIT) this.extensionIcons(view.time?.extensions ?? 0);
    this.pictures(view, world);
    this.timeStrip(view);
  }

  /** vmv2.exe 0x0040b4c5(0x407926이 틱마다 0x40b00c로): 시간 칸만. 다시 그렸으면 true */
  updateTime(view: StatusView): boolean {
    return this.timeStrip(view);
  }

  // vmv2.exe 0x0040b50d 끝: 연장 아이콘 다섯 칸(찬 칸 0x106c, 빈 칸 0x106b)
  private extensionIcons(count: number): void {
    if (this.shownExtensions === count) return;
    this.shownExtensions = count;
    for (let i = 0; i < 5; i++) this.chip(0x140fc + i * 8, i < count ? 0x106c : 0x106b, 0, true);
  }

  // vmv2.exe 0x0040ca6d: 남은 초 숫자와 막대(마지막 60초만 길이), 끝 불꽃
  private timeStrip(view: StatusView): boolean {
    if (view.state.timeLimit === NO_LIMIT) return false;
    const on = view.time?.on ?? false;
    const r = view.time?.remaining ?? 0;
    if ((!this.timeOn && !on) || (this.timeOn && on && this.timeRemaining === r)) return false;
    this.timeOn = on;
    this.timeRemaining = r;
    this.restore(0x40, 0x13c, 0x18, 0x10);
    const strip = this.env.exe.read(TIME_STRIP, 0x11);
    for (let row = 0; row < 0x11; row++) this.fill((row + 0x13b) * PITCH + 0x93, strip[row], 0x59);
    this.chip(0x14067, 0x100e, 0);
    this.chip(0x14c97, 0x101e, 0);
    this.chip(0x140d8, 0x105d, 0);
    this.chip(0x14d08, 0x106d, 0);
    if (!on) return true;
    this.num(Math.trunc((r + 5) / 6), 3, 0x14130);
    const bar = this.env.exe.read(TIME_BAR, 9);
    const length = r < 0x169 ? Math.trunc((r * 2) / 6) - 1 : 0x77;
    for (let row = 0; row < 3; row++) for (let c = length; c > 1; c--) this.image[(row + 0x141) * PITCH + 0x7b + c] = bar[((c - 2) % 3) + row * 3];
    if (r < 0x169) {
      this.chip(0x14067 + Math.trunc((r * 2) / 6), TIME_FLAME_TOP[r & 3], 0, true);
      this.chip(0x14c97 + Math.trunc((r * 2) / 6), TIME_FLAME_BOTTOM[r & 3], 0, true);
    }
    return true;
  }

  /** vmv2.exe 0x0040b47d: 타이머가 4틱마다(애니메이션 옵션 & 6) 지형 그림과 초상만 다시 그린다 */
  tick(view: StatusView): void {
    this.pictures(view, new World(this.env.data, view.state, []));
  }

  // 커서 칸의 부품(물 부품은 물 프레임만큼 돌린다)
  private partAt(view: StatusView): number {
    const { map } = this.env.data;
    let part = workGrid(map, view.state)[view.cursor!.y * GRID + view.cursor!.x];
    if (partByte(map, part, 0x63) & 2) part = (part + view.water) % 0x200;
    return part;
  }

  // vmv2.exe 0x0040b608
  private clockAndWater(state: GameState): void {
    if (this.waterMinutes !== state.waterMinutes) {
      this.waterMinutes = state.waterMinutes;
      this.restore(0xb4, 0x1e, 0x38, 0x10);
      if (state.waterMinutes !== 0) this.text(formatC(this.env.exe.cString(WORDS.water), state.waterMinutes), 0x1f2c, TEXT);
    }
    if (this.waterStage !== state.waterStage) {
      this.waterStage = state.waterStage;
      this.restore(0x7c, 0x1e, 0x30, 0x10);
      if (state.waterStage !== 1) this.text(this.env.exe.cString(state.waterStage === 0 ? WORDS.decre : WORDS.incre), 0x1ef4, TEXT);
    }
    if (this.time !== state.timeOfDay) {
      this.time = state.timeOfDay;
      this.restore(0x24, 0x1e, 0x10, 0x10);
      this.restore(0x3c, 0x1e, 0x10, 0x10);
      this.num((state.timeOfDay / 60) | 0, 2, 0x1e9c);
      this.text(formatC('%02d', state.timeOfDay % 60), 0x1eb4, TEXT);
      const light = lightPhase(state.timeOfDay, this.env.data.map.header); // 0x402272
      this.chip(0x1dc2, light + 0x100b, 0);
      this.chip(0x29f2, light + 0x101b, 0);
      this.text(state.sides[0].name, 0x34dc, TEXT);
    }
  }

  // vmv2.exe 0x0040b871: 진영 MP 숫자·막대, 정각 회복(마스터 마력 × 회복 배수)·유지 막대
  private sideBars(state: GameState, world: World): void {
    const bars = (row: number, value: number, max: number) => {
      const v = Math.min(value, BAR_MAX);
      const m = Math.min(max, BAR_MAX);
      for (let r = 0; r < 8; r++) {
        this.fill((row + r) * PITCH + 0xc, this.colors[r], v);
        this.fill((row + r) * PITCH + 0xc + v, this.colors[r + 8], m - v);
      }
    };
    const strip = (row: number, value: number, color: number) => {
      for (let r = 0; r < 4; r++) this.fill((row + r) * PITCH + 0xc, this.colors[color + r], value);
    };
    const master = (side: number) => world.units.find((u, i) => u && i < MASTERS && u.side === side)!;
    const [s0, s1] = state.sideStates;
    if (this.mp0 !== s0.mp) {
      this.mp0 = s0.mp;
      this.restore(0xb4, 0x34, 0x18, 0x10);
      this.num(s0.mp, 3, 0x3584);
      this.restore(0xc, 0x46, BAR_MAX, 8);
      bars(0x46, s0.mp, state.sides[0].maxMp);
    }
    if (this.mp1 !== s1.mp) {
      this.mp1 = s1.mp;
      this.restore(0xb4, 0x5b, 0x18, 0x10);
      this.num(s1.mp, 3, 0x5d20);
      this.restore(0xc, 0x6d, BAR_MAX, 8);
      bars(0x6d, s1.mp, state.sides[1].maxMp);
    }
    const recovery0 = Math.min(master(0).magic * s0.mpMultiplier, BAR_MAX);
    if (this.recovery0 !== recovery0) {
      this.recovery0 = recovery0;
      this.restore(0xc, 0x51, BAR_MAX, 4);
      strip(0x51, recovery0, 0x10);
    }
    const upkeep0 = Math.min(s0.upkeep, BAR_MAX);
    if (this.upkeep0 !== upkeep0) {
      this.upkeep0 = upkeep0;
      this.restore(0xc, 0x55, BAR_MAX, 4);
      strip(0x55, upkeep0, 0x14);
    }
    const recovery1 = Math.min(master(1).magic * s1.mpMultiplier, BAR_MAX);
    if (this.recovery1 !== recovery1) {
      this.recovery1 = recovery1;
      this.restore(0xc, 0x78, BAR_MAX, 4);
      strip(0x78, recovery1, 0x10);
    }
    const upkeep1 = Math.min(s1.upkeep, BAR_MAX);
    if (this.upkeep1 !== upkeep1) {
      this.upkeep1 = upkeep1;
      this.restore(0xc, 0x7c, BAR_MAX, 4);
      strip(0x7c, upkeep1, 0x14);
    }
  }

  // vmv2.exe 0x0040bd52: 커서 칸 지형 이름·깊이·방어·높이
  private terrainText(view: StatusView): void {
    this.restore(0x40, 0x86, 0x38, 0x10);
    this.restore(0x40, 0x99, 0x38, 0x10);
    this.restore(0x9f, 0x86, 0x10, 0x10);
    this.restore(0x9f, 0x99, 0x10, 0x10);
    if (!view.cursor) {
      this.restore(0xc, 0x86, 0x30, 0x30);
      return;
    }
    const { map } = this.env.data;
    const part = this.partAt(view);
    const kind = partByte(map, part, 0x62);
    this.text(this.terrainNames[kind], 0x8858, TEXT);
    const depth = kind === 7 || kind === 13 ? 1 : kind === 8 || kind === 14 ? 2 : kind === 9 || kind === 15 ? 3 : 0;
    if (depth) this.text(this.env.exe.cString(DEPTH[depth - 1]), 0x9ba4, TEXT);
    this.num(100 - this.defense[kind], 2, 0x88b7);
    this.num(partByte(map, part, 0x61), 2, 0x9c03);
  }

  // vmv2.exe 0x0040c050: 커서 유닛 이름·HP·능력치·OA·차례 순위·아이콘·막대(없으면 빈 칸)
  private unitText(view: StatusView, world: World): void {
    const unit = view.unit !== null ? world.units[view.unit] : null;
    if (!this.hadUnit && !unit) return;
    this.hadUnit = unit ? 1 : 0;
    for (const [x, y, w] of [[0x43, 0xbe, 0x90], [0x53, 0xd5, 0x10], [0x53, 0xec, 0x10], [0x75, 0xec, 0x10], [0x53, 0xfe, 0x10], [0x75, 0xfe, 0x10], [0x75, 0x110, 0x10], [0x53, 0x110, 0x10], [0x93, 0x110, 0x30], [0xa3, 0xec, 0x48], [0xab, 0xfe, 0x10]]) {
      this.restore(x, y, w, 0x10);
    }
    const hpBar = (on: (i: number) => boolean) => {
      for (let i = 0; i < 10; i++) for (let r = 0; r < 9; r++) this.fill((r + 0xd8) * PITCH + 0x74 + i * 0xc, this.colors[r + (on(i) ? 0x18 : 0x21)], 10);
    };
    if (!unit) {
      this.restore(0xc, 199, 0x30, 0x46);
      this.chip(0xbbf0, 0x1022, 0);
      this.chip(0xbc08, 0x1023, 0);
      this.chip(0x1104b, 0x1053, 0);
      this.chip(0x11c7b, 0x1063, 0);
      this.chip(0xc1d0, 0x1050, 0);
      this.chip(0xce00, 0x1060, 0);
      for (let i = 0; i < 10; i++) for (let r = 0; r < 9; r++) this.fill((r + 0xd8) * PITCH + 0x74 + i * 0xc, this.colors[r + 0x2a], 10);
      for (let r = 0; r < 7; r++) this.fill(0x6a + (r + 0x12a) * PITCH, this.expOff[r], 100);
      this.chip(0x12ba8, 0x1024, 0);
      this.chip(0x12bc0, 0x1025, 0);
      return;
    }
    const { state } = view;
    const name = unit.natial ? natialOf(this.env.data.natials, unit.type).name : state.sides[unit.side].name;
    this.text(name, 0xc13b, TEXT);
    this.num(unit.hp, 2, 0xd8a7);
    this.num(unit.speed, 2, 0x11493);
    this.num(unit.movement, 2, 0x114b5);
    this.text(this.moveTypeNames[unit.moveType], 0x114d3, TEXT);
    this.num(unit.attack, 2, 0xf003);
    this.num(unit.defense, 2, 0xf025);
    this.num(unit.magic, 2, 0x1024b);
    this.num(unit.magicDefense, 2, 0x1026d);
    this.text(unit.statusMinutes < 1 ? formatC('%3d', unit.oa) : formatC('%3d(+%3d)', unit.oa, unit.statusMinutes), 0xf053, TEXT);
    this.text(formatC('%2d', this.rank(world, view.unit!) + 1), 0x102a3, TEXT);
    this.chip(0xbbf0, unit.side * 0x10 + 0x1032, 0);
    this.chip(0xbc08, unit.side * 0x10 + 0x1033, 0);
    this.portrait(view, world);
    this.chip(0x1104b, unit.element + 0x1054, 0);
    this.chip(0x11c7b, unit.element + 0x1064, 0);
    this.chip(0xc1d0, unit.lightPreference + 0x1050, 0);
    this.chip(0xce00, unit.lightPreference + 0x1060, 0);
    hpBar((i) => i < unit.hp);
    for (let r = 0; r < 7; r++) {
      this.fill(0x6a + (r + 0x12a) * PITCH, this.expOn[r], unit.exp);
      this.fill((r + 0x12a) * PITCH + 0x6a + unit.exp, this.expOff[r], 100 - unit.exp);
    }
    this.chip(0x12ba8, unit.level * 0x10 + 0x1024, 0);
    this.chip(0x12bc0, unit.level * 0x10 + 0x1025, 0);
  }

  // vmv2.exe 0x00412aa2: OA + 상태 이상 남은 분이 같거나 작은 다른 유닛 수(같으면 소환 순번이 같거나 작은 것)
  private rank(world: World, index: number): number {
    const me = world.units[index]!;
    const key = me.oa + me.statusMinutes;
    return world.units.filter((u, i) => u && i !== index && u.oa + u.statusMinutes <= key && (u.oa + u.statusMinutes !== key || u.summonOrder <= me.summonOrder)).length;
  }

  // vmv2.exe 0x0040c969: 커서 칸 지형 그림, 유닛 초상(앞 함수가 그린 것을 지우고 다시)
  private pictures(view: StatusView, world: World): void {
    if (view.cursor) {
      this.restore(0xc, 0x86, 0x30, 0x30);
      this.terrainPicture(0x8824, this.partAt(view));
    }
    if (view.unit !== null && world.units[view.unit]) {
      this.restore(0xc, 199, 0x30, 0x46);
      this.portrait(view, world);
    }
  }

  // vmv2.exe 0x0040cddd: 부품의 칩 4줄 × 2열(위층 부품은 위층 칩도), 아래 쐐기 무늬
  private terrainPicture(at: number, part: number): void {
    const { parts } = this.env.data.map;
    const word = (k: number) => parts[part * 100 + k * 2] | (parts[part * 100 + k * 2 + 1] << 8);
    const top = parts[part * 100 + 0x60];
    const height = parts[part * 100 + 0x61];
    const upper = (parts[part * 100 + 0x63] & 1) !== 0;
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 2; c++) {
        const k = top + 3 - r;
        if (k < 0x18 && (!upper || k < 0x13) && word(c * 0x18 + k) !== NONE) this.chip(at + r * CHIP_H * PITCH + c * CHIP_W, word(c * 0x18 + k), 0, true);
      }
    }
    if (upper) {
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 2; c++) {
          const k = top - r + 0x16 - height;
          if (k < 0x18 && k > 0x12 && word(c * 0x18 + k) !== NONE) this.chip(at + r * CHIP_H * PITCH + c * CHIP_W, word(c * 0x18 + k), 0, true);
        }
      }
    }
    for (let row = 0x28; row < 0x30; row++) {
      this.image[at + row * PITCH] = 0xf5;
      for (let k = 0; k < (row - 0x28) * 3 + 1; k++) {
        const v = k % 2 === 0 ? 10 : 0xf5;
        this.image[at + row * PITCH + 1 + k] = v;
        this.image[at + row * PITCH + 0x2f - k] = v;
      }
    }
  }

  // vmv2.exe 0x0040d056: 유닛 그림의 배치표(묶음, 자세) 2열 × 6줄, 상태 이상이면 색 바꿈 표 6·4·2
  private portrait(view: StatusView, world: World): void {
    const index = view.unit!;
    const u = world.units[index]!;
    const pose = view.pose ?? view.state.units[index]!.pose;
    const tint = u.status & 1 ? 6 : u.status & 2 ? 4 : u.status & 4 ? 2 : 0;
    const layouts = this.env.art.sprites.layouts;
    const page = unitPage(index); // 확대 1은 유닛 자기 페이지(0x40aefd)
    const at = 0xca28;
    for (let c = 1; c < 3; c++) {
      for (let r = 0; r < 6; r++) {
        const chip = layouts[pose * 32 + r + c * 8];
        this.chip(at + (5 - r) * CHIP_H * PITCH + (c - 1) * CHIP_W, (page * 0x10 + 0x1000 + chip) & 0xffff, tint, true);
      }
    }
  }
}
