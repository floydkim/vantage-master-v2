// 오프닝 대본(0x473388)과 장면·동작 함수. 원작 함수 주소를 주석에 둔다. 엔진 필드를 절대 주소로 만지는 곳은 Engine 필드로 옮겼다
import { commonPaletteA, commonPaletteB } from '../../battle/palette.ts';
import type { ExeImage } from '../../../formats/exeImage.ts';
import { msvcRand } from '../../battle/continueData.ts';
import type { ReadAny } from '../../battle/sheet.ts';
import { Engine, type Sprite } from './engine.ts';

const DEG = 0.017453292519943295; // 0x45b950

/** 3 × 3 행렬 곱(0x43ad1b): out[r][c] = A[r][2]·B[6 + c] + A[r][1]·B[3 + c] + A[r][0]·B[c] */
function mul(a: readonly number[], b: readonly number[]): number[] {
  const out: number[] = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) out.push(a[r * 3 + 2] * b[6 + c] + a[r * 3 + 1] * b[3 + c] + a[r * 3] * b[c]);
  return out;
}
const rotZ = (t: number) => [Math.cos(t), Math.sin(t), 0, -Math.sin(t), Math.cos(t), 0, 0, 0, 1]; // 0x43a66d
const rotY = (t: number) => [Math.cos(t), 0, -Math.sin(t), 0, 1, 0, Math.sin(t), 0, Math.cos(t)]; // 0x43a55a
const rotX = (t: number) => [1, 0, 0, 0, Math.cos(t), Math.sin(t), 0, -Math.sin(t), Math.cos(t)]; // 0x43a447
const transpose = (m: readonly number[]) => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]; // 0x43aa76
/** 0x435c71: t = 0에 a, ½에 b, 1에 c를 지나는 2차 곡선 */
const curve = (t: number, a: readonly number[], b: readonly number[], c: readonly number[]) =>
  [0, 1, 2].map((i) => (4 * b[i] + -3 * a[i] - c[i]) * t + (2 * c[i] + (2 * a[i] - 4 * b[i])) * (t * t) + a[i]);
const CHIP_STEP = [0, 1, 2, 1]; // 0x473440: 걸음 프레임
const BUBBLE = [1, 2, 3, 4, 5, 4, 3, 2, 1]; // 0x473450
const SWAY = [0, 1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1]; // 0x473478
/** 0x472e68: 3장 겹 8개의 상자(sx, sy, ex, ey), 그림 0x70079 + 11k + 프레임 → 칸 0x10 + 11k + 프레임 */
/** 2장 이어서: 자리, 서 있는 칸(두 프레임은 +1·+2), 날아가는 그림 칸·걸음, 그 그림의 처음 y 보정 */
const SUMMONS = [
  { at: [150, 50, -200], idle: 0x2f, fly: 0x44, dx: -100, dy: -60, drop: 0 },
  { at: [-150, 0, -200], idle: 0x35, fly: 0x58, dx: 100, dy: 0, drop: 0 },
  { at: [150, -50, -200], idle: 0x3b, fly: 0x70, dx: -100, dy: 50, drop: -10 },
];
type Path = readonly [readonly number[], readonly number[], readonly number[]];
const SIXTH = 1.0471975511965976; // 0x45ba58: π/3
const WAVE = [0, 1, 2, 3, 4, 5, 6, 7, 6, 5, 4, 3, 2, 1]; // 0x4734a8
const SLASH = [1, 2, 4, 5, 7, 8, 10, 11]; // 0x4734e0
const SLASH_END = [13, 14, 16, 17]; // 0x473500
const CH3_LAYERS = [[171, 5, 219, 103], [46, 71, 106, 141], [2, 210, 69, 252], [61, 326, 114, 376], [175, 390, 218, 466], [290, 367, 353, 442], [340, 253, 437, 302], [297, 91, 371, 161]];

export class Opening {
  readonly engine = new Engine();
  private readonly exe: ExeImage;
  private readonly read: ReadAny;
  /** 0x4886d0: 지금 장의 팔레트 리소스(글 카드가 다시 씀) */
  chapterPalette = 0;
  /** 게임 난수 상태(0x452ed9) */
  seed: number;
  /** 카메라·바라볼 점 곡선(0x488770·0x488758·0x488740, 0x4886f8·0x488710·0x488728) */
  private camPath: Path = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  private aimPath: Path = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];

  constructor(exe: ExeImage, read: ReadAny, seed: number) {
    this.exe = exe;
    this.read = read;
    this.seed = seed;
    const e = this.engine;
    const card = () => this.card();
    e.script = [
      [() => this.load1(), () => this.scene1a()],
      [null, () => this.scene1b()],
      [null, card],
      [() => this.load2(), () => this.scene2a()],
      [null, () => this.scene2b()],
      [null, card],
      [() => this.load3(), () => this.scene3a()],
      [null, () => this.scene3b()],
      [null, card],
      [() => this.load4(), () => this.scene4a()],
      [null, () => this.scene4b()],
      [null, card],
      [() => this.load5(), () => this.scene5a()],
      [null, () => this.scene5b()],
      [null, card],
      [() => this.load6(), () => this.scene6a()],
      [null, () => this.scene6b()],
      [null, card],
      [() => this.load7(), () => this.scene7()],
      [() => this.loadLogo(), () => this.logo()],
      [null, () => this.titleScene()],
    ];
    // vmv2.exe 0x00426c24 → 0x0043351b: 첫 칸의 읽기(1장 그림)
    this.loadNext();
  }

  /** vmv2.exe 0x0043351b: 지금 대본 칸의 읽기 함수 */
  loadNext(): void {
    this.engine.script[this.engine.scriptAt]?.[0]?.();
  }

  /** vmv2.exe 0x00426c54: AVI가 끝까지 돌았다 → 화면 전체 고침, 시계 맞춤 */
  start(): void {
    this.engine.dirtyAll();
    this.engine.resetClock();
  }

  private res(id: number): Uint8Array {
    return this.read(id);
  }

  private rand(): number {
    const r = msvcRand(this.seed);
    this.seed = r.state;
    return r.value;
  }

  /** 칸 canvas의 그림 위에 칸 layer를 (가운데 + 원점)에 투명색 없이(0x431d23) */
  private paint(canvas: number, layer: number): void {
    const c = this.engine.slots[canvas];
    const l = this.engine.slots[layer];
    const left = Math.trunc(c.w / 2) + l.ox;
    const top = Math.trunc(c.h / 2) + l.oy;
    Engine.blit(c.data, c.w, l, 0, { left, top, right: left + l.w, bottom: top + l.h }, { left: 0, top: 0, right: c.w, bottom: c.h }, false);
  }

  private slot(n: number, id: number, w: number, h: number, sx: number, sy: number, ex: number, ey: number, shift: number): void {
    this.engine.loadSlot(n, this.res(id), w, h, sx, sy, ex, ey);
    this.engine.shiftSlot(n, shift);
  }

  /** 리소스를 기본 팔레트 칸 index(0 = 10번)부터 */
  private loadPalette(id: number, index: number): void {
    const p = this.res(id);
    const b = this.engine.base;
    b.set(p.subarray(0, Math.min(p.length, b.length - index * 4)), index * 4);
  }

  /** vmv2.exe 0x004340cb(x°, y°, z°): 회전 행렬에 Z·Y·X 차례로 곱하고, 카메라를 뒤집힌 행렬로 돌린다 */
  private turn(a: number, b: number, c: number): void {
    const e = this.engine;
    e.rotation = mul(e.rotation, rotZ(c * DEG));
    e.rotation = mul(e.rotation, rotY(b * DEG));
    e.rotation = mul(e.rotation, rotX(a * DEG));
    Engine.transform(e.camera, transpose(e.rotation));
  }

  // ---- 1장 ----

  /** vmv2.exe 0x00433538: 1장 그림 */
  private load1(): void {
    const e = this.engine;
    e.fullRedraw = 1; // 0x431a85
    this.slot(2, 0x7004b, 800, 600, 0, 500, 800, 600, 0x11);
    this.slot(3, 0x70009, 0x1cc, 0x17c, 0, 0, 0x1cc, 0x17c, 0x11);
    for (let c = 0; c < 0xb; c++) {
      this.slot(c + 4, 0x7000a + c, 0x1cc, 0x17c, 0xf6, 0x49, 0x1cc, 0x120, 0x11);
      this.slot(c + 0xf, 0x70015 + c, 0x1cc, 0x17c, 0xa0, 2, 0xf6, 0x82, 0x11);
      this.slot(c + 0x1a, 0x70020 + c, 0x1cc, 0x17c, 0x86, 0xa4, 0xf4, 0xdf, 0x11);
    }
    let y = 0xf0;
    for (let c = 0; c < 0x18; c++) {
      if (c === 8) y = 0;
      this.slot(c + 0x25, 0x7002b + c, 0x100, 0x1b8, 0, y, 0x100, 0x1b8, 0x11);
    }
    for (let c = 0; c < 8; c++) this.slot(c + 0x3d, 0x70043 + c, 0x100, 0x1b8, 0, 200, 0x100, 0x1b8, 0x11);
    e.loadUnitSet(0x45, this.res(0x10019), this.res(5));
    e.loadUnitSet(0x57, this.res(0x30032), this.res(0x30033));
    e.loadUnitSet(0x69, this.res(0x30094), this.res(0x30095));
    e.loadUnitSet(0x7b, this.res(0xf), this.res(0x10));
    this.slot(1, 0x70001, 500, 0xbe, 0, 0, 500, 0xbe, -0x23);
  }

  /** vmv2.exe 0x0043381d: 소환사 소녀와 마법진 */
  private scene1a(): void {
    const e = this.engine;
    this.chapterPalette = 0x70008;
    commonPaletteB(e.base, this.read);
    this.loadPalette(0x70008, 7);
    e.fadeIn(0x10, 0, 0xec);
    e.setView(60);
    e.camera[0] = e.camera[0] - 100;
    e.camera[1] = e.camera[1] + 10;
    const a = e.alloc();
    a.x = 0;
    a.y = 0;
    a.z = 0;
    a.slot = 3;
    a.flags = 3;
    a.behavior = (s) => this.circle(s);
    const b = e.alloc();
    b.x = -250;
    b.y = 20;
    b.z = 0;
    b.depthAdd = 1;
    b.slot = 0x25;
    b.flags = 3;
    b.behavior = (s) => this.girl(s);
    const c = e.alloc();
    c.x = 0;
    c.y = 512;
    c.z = 0;
    c.depthAdd = 1000;
    c.slot = 2;
    c.flags = 6;
    c.behavior = () => {}; // 0x433dbf
    e.slots[2].ox = -0x180;
    e.slots[2].oy = -0x158;
  }

  /** vmv2.exe 0x00433a7e: 마법진. 칸 3 그림 위에 세 겹(칸 4·0xf·0x1a + 스텝 % 11)을 그려 넣고 위아래로 흔든다 */
  private circle(s: Sprite): void {
    const e = this.engine;
    e.fadeStep();
    s.y = Math.sin(s.counter / 3) * 20;
    for (const base of [4, 0xf, 0x1a]) this.paint(3, base + (e.steps % 0xb));
    if (s.counter === 0x2a) e.fadeOut(8);
    else if (s.counter === 0x31) e.drawNow = 1;
    else if (s.counter >>> 0 > 0x31) {
      e.captureSlot(0);
      e.sceneDone = 0;
    }
  }

  /** vmv2.exe 0x00433d6c·0x00433d99: 소녀 그림 0x25 + 카운터, 0x17 뒤로는 8프레임 반복(0x3d~) */
  private girl(s: Sprite): void {
    s.slot = s.counter + 0x25;
    if (s.counter >>> 0 > 0x17) s.behavior = (t) => void (t.slot = (t.counter >>> 0) % 8 + 0x3d);
  }

  /** vmv2.exe 0x00433dc4: 1장 이어서(돌아가는 카메라, 유닛 그림) */
  private scene1b(): void {
    const e = this.engine;
    commonPaletteA(e.base, this.read);
    commonPaletteB(e.base, this.read);
    e.fadeIn(0x10, 0, 0xec);
    e.setView(60);
    const a = e.alloc();
    a.x = 100;
    a.y = 0;
    a.z = 0;
    a.scaleX = 3;
    a.scaleY = 3;
    a.flags = 3;
    a.behavior = (s) => this.spinUnit(s);
    const b = e.alloc();
    b.x = 100;
    b.y = 0;
    b.z = 0;
    b.scaleX = 3;
    b.scaleY = 3;
    b.depthAdd = -1;
    b.flags = 0;
    b.behavior = null;
    a.ref = b;
  }

  /** vmv2.exe 0x00434030: 카메라를 (카운터°, 카운터 × 10°, 0)으로 돌리고 보이는 방향 0~5 × 3 */
  private facing(s: Sprite): number {
    const d = s.counter * 10;
    this.engine.setView(60);
    this.turn(s.counter, d, 0);
    return (Math.trunc(((d + 30) / 360) * 6) >>> 0) % 6 * 3;
  }

  /** vmv2.exe 0x00433f2a: 도는 유닛(그림 묶음 0x45), 8틱 뒤부터 소환 연출(0x69 묶음), 16틱 뒤 다음 동작 */
  private spinUnit(s: Sprite): void {
    const e = this.engine;
    e.fadeStep();
    const dir = this.facing(s);
    const k = s.counter - 8;
    s.slot = dir + 0x46;
    if (k < 0) return;
    const fx = s.ref!;
    fx.slot = Math.trunc(k / 2) + 0x69;
    fx.flags = 3;
    if (k <= 7) return;
    e.kill(fx);
    s.behavior = (t) => this.spinUnit2(t);
    s.u0 = s.counter;
    const c = e.alloc();
    c.x = -100;
    c.y = 0;
    c.z = 0;
    c.scaleX = 3;
    c.scaleY = 3;
    c.behavior = (t) => this.summonFx(t);
  }

  /** vmv2.exe 0x004341c9: 걷는 유닛(0x57 묶음 + 걸음 표 0x473440), 0x20틱에 페이드 아웃, 0x27 뒤 장면 끝 */
  private spinUnit2(s: Sprite): void {
    const e = this.engine;
    e.fadeStep();
    const dir = this.facing(s);
    const k = (s.counter - s.u0) >>> 0;
    const walk = CHIP_STEP[Math.trunc(k / 3) % 4];
    s.slot = dir + 0x57 + walk;
    if (k === 0x20) e.fadeOut(8);
    else if (k > 0x27) e.sceneDone = 0;
  }

  /** vmv2.exe 0x00434241: 소환 그림 0x7b + 카운터 / 2, 0x10 뒤 사라짐 */
  private summonFx(s: Sprite): void {
    s.flags = 3;
    s.slot = (s.counter >>> 1) + 0x7b;
    if (s.counter >>> 1 > 0x10) {
      s.flags = 0;
      this.engine.kill(s);
    }
  }

  // ---- 글 카드 ----

  /** vmv2.exe 0x00439f89: 앞 장면 갈무리(칸 0)를 반 크기로 날려 보내고 장 제목(칸 1)을 들인다 */
  private card(): void {
    const e = this.engine;
    this.loadPalette(this.chapterPalette, 7);
    this.loadPalette(0x70000, 0xd3);
    e.fadeIn(8, 0, 0xec);
    e.setView(60);
    e.fullRedraw = 1;
    const s = e.alloc();
    s.x = 0;
    s.y = 0;
    s.z = 0;
    s.scaleX = 0.5;
    s.scaleY = 0.5;
    s.slot = 0;
    s.flags = 2;
    s.behavior = (t) => this.cardFly(t, true, false);
  }

  /** vmv2.exe 0x0043a07a·0x004391c8: (0, 0, −600) → (0, 32, −300) → (0, −128, 0)를 40스텝에, 앞장선 것은 페이드하고 0x23에 제목, 0x27 뒤 멈춤 */
  private cardFly(s: Sprite, lead: boolean, screen: boolean): void {
    const e = this.engine;
    [s.x, s.y, s.z] = curve((s.counter >>> 0) / 40, [0, 0, -600], [0, 32, -300], [0, -128, 0]);
    if (lead) {
      e.fadeStep();
      if (s.counter === 0x23) {
        const t = e.alloc();
        t.x = 0;
        t.y = 145;
        t.z = 0;
        t.scaleX = 1;
        t.scaleY = 1;
        t.depthAdd = -1;
        t.slot = 1;
        t.behavior = (u) => this.titleSlide(u, screen);
      }
    }
    if (s.counter >>> 0 > 0x27) s.behavior = null;
  }

  /** vmv2.exe 0x0043a258·0x004393b3: 제목이 왼쪽 밖(−634)에서 5스텝에 가운데로(마지막 카드는 화면 좌표) */
  private titleSlide(s: Sprite, screen: boolean): void {
    s.x = -634 * ((5 - s.counter) / 5);
    s.flags = screen ? 7 : s.flags | 3;
    if (s.counter > 4) {
      s.counter = -1;
      s.behavior = (t) => this.titleWait(t);
    }
  }

  /** vmv2.exe 0x0043a2ba: 10에 다음 장 그림을 읽고 0xf6만큼 쉰다, 11에 16스텝 페이드 아웃, 끝나면 장면 끝 */
  private titleWait(s: Sprite): void {
    const e = this.engine;
    if (s.counter === 10) {
      this.loadNext();
      e.pause(0xf6);
    }
    const fading = e.fadeStep();
    if (s.counter === 0xb) e.fadeOut(0x10);
    if (s.counter >>> 0 > 0xb && !fading) e.sceneDone = 0;
  }

  // ---- 2장 ----

  /** vmv2.exe 0x00434286: 2장 그림 */
  private load2(): void {
    const e = this.engine;
    e.fullRedraw = 1; // 0x431a85
    this.slot(2, 0x70061, 800, 600, 0, 0, 800, 600, 0x11);
    this.slot(3, 0x7004d, 0xd0, 0x1d8, 0, 0, 0xd0, 0x1d8, 0x11);
    for (let c = 0; c < 0xd; c++) this.slot(c + 4, 0x7004e + c, 0xd0, 0x1d8, 0x32, 0x14, 0xbe, 0x8e, 0x11);
    for (let c = 0; c < 6; c++) this.slot(c + 0x11, 0x7005b + c, 0xd0, 0x1d8, 0x32, 0x14, 0xbe, 0x8e, 0x11);
    for (const [n, id] of [[0x17, 0x70062], [0x1e, 0x70069], [0x25, 0x70070]]) {
      for (let c = 0; c < 7; c++) this.slot(n + c, id + c, 0x40, 0x78, 0, 0, 0x40, 0x78, 0x11);
    }
    e.loadUnitSet(0x2c, this.res(0x200aa), this.res(0x200ab));
    e.loadUnitSet(0x3e, this.res(0x400a9), this.res(0x400b5));
    e.loadUnitSet(0x50, this.res(0x400ae), this.res(0x400ba));
    e.loadUnitSet(0x62, this.res(0x400a8), this.res(0x400b4));
    this.slot(1, 0x70002, 500, 0xbe, 0, 0, 500, 0xbe, -0x23);
  }

  /** vmv2.exe 0x00434553: 물속을 오르는 소환사와 거품 넷(난수 4번) */
  private scene2a(): void {
    const e = this.engine;
    this.chapterPalette = 0x7004c;
    commonPaletteB(e.base, this.read);
    this.loadPalette(0x7004c, 7);
    e.fadeIn(0x10, 0, 0xec);
    e.setView(60);
    e.fullRedraw = 0;
    const a = e.alloc();
    a.x = 0;
    a.y = 300;
    a.z = 0;
    a.slot = 3;
    a.flags = 3;
    a.behavior = (s) => this.rise(s);
    for (const [x, y, base] of [[-150, -100, 0x17], [-240, 150, 0x1e], [220, -80, 0x25], [200, 170, 0x17]]) {
      const b = e.alloc();
      b.x = x;
      b.y = y;
      b.z = 0;
      b.depthAdd += 500;
      b.u0 = base;
      b.u1 = this.rand() % 0xc;
      b.flags = 3;
      b.behavior = (s) => this.bubble(s);
    }
    const c = e.alloc();
    c.x = 0;
    c.y = 0;
    c.z = 0;
    c.depthAdd += 1000;
    c.slot = 2;
    c.flags = 6;
    c.behavior = (s) => void (s.y -= 1); // 0x434b36
    e.slots[2].ox = -0x180;
    e.slots[2].oy = -0x100;
  }

  /** vmv2.exe 0x004348ef: 오르며(−4) 칸 3에 프레임 4~16을 그려 넣고, 12 뒤 0x4349f3으로 */
  private rise(s: Sprite): void {
    this.engine.fadeStep();
    s.y -= 4;
    this.paint(3, (s.counter >>> 0) % 0xd + 4);
    s.prevSlot = -1;
    if (s.counter >>> 0 > 0xb) {
      s.counter = -1;
      s.behavior = (t) => this.rise2(t);
    }
  }

  /** vmv2.exe 0x004349f3: 오르며 프레임 0x11 + 표(0x473450), 0x20에 페이드 아웃, 0x27 뒤 갈무리하고 장면 끝 */
  private rise2(s: Sprite): void {
    const e = this.engine;
    e.fadeStep();
    s.y -= 4;
    this.paint(3, BUBBLE[((s.counter >>> 0) >>> 1) % 9] + 0x11);
    s.prevSlot = -1;
    if (s.counter === 0x20) e.fadeOut(8);
    else if (s.counter === 0x27) e.drawNow = 1;
    else if (s.counter >>> 0 > 0x27) {
      e.fullRedraw = 1;
      e.sceneDone = 0;
      e.captureSlot(0);
    }
  }

  /** vmv2.exe 0x00434b4d: 거품 흔들림(표 0x473478) 오르기 −2 */
  private bubble(s: Sprite): void {
    s.slot = s.u0 + SWAY[((s.counter + s.u1) >>> 0) % 0xc];
    s.y -= 2;
  }

  /** vmv2.exe 0x00434b95: 2장 이어서(소환되는 유닛 셋) */
  private scene2b(): void {
    const e = this.engine;
    commonPaletteA(e.base, this.read);
    commonPaletteB(e.base, this.read);
    e.fadeIn(8, 0, 0xec);
    e.setView(60);
    e.fullRedraw = 1;
    const a = e.alloc();
    a.scaleX = 3;
    a.scaleY = 3;
    a.flags = 0;
    a.behavior = (s) => this.summon(s, 0);
  }

  /** vmv2.exe 0x00434c30·0x00434d5e·0x00434e8c: 자리 고정, 4스텝 뒤 보이며 두 프레임 번갈아, 그때 날아가는 그림 하나(0x434fd0·0x43500d·0x435038), 9 뒤 다음(마지막은 장면 끝) */
  private summon(s: Sprite, i: number): void {
    const e = this.engine;
    const m = SUMMONS[i];
    e.fadeStep();
    [s.x, s.y, s.z] = m.at;
    s.slot = m.idle;
    const k = s.counter - 4;
    if (k < 0) return;
    if (k === 0) {
      const f = e.alloc();
      f.x = s.x;
      f.y = s.y + m.drop;
      f.z = s.z;
      f.scaleX = s.scaleX;
      f.scaleY = s.scaleY;
      f.depthAdd = 1;
      f.flags = 0;
      f.behavior = (t) => {
        t.slot = m.fly;
        t.flags = 3;
        t.x += m.dx;
        t.y += m.dy;
      };
      s.ref = f;
    }
    s.flags = 3;
    s.slot = (k & 1) + m.idle + 1;
    if (s.counter >>> 0 > 9) {
      e.kill(s.ref!);
      s.counter = -1;
      if (i < 2) s.behavior = (t) => this.summon(t, i + 1);
      else e.sceneDone = 0;
    }
  }

  // ---- 3장 ----

  /** vmv2.exe 0x00435075: 3장 그림 */
  private load3(): void {
    const e = this.engine;
    e.fullRedraw = 1; // 0x431a85
    this.slot(2, 0x700dd, 800, 600, 0, 0, 800, 600, 0x11);
    this.slot(3, 0x70078, 0x1b8, 0x1d8, 0, 0, 0x1b8, 0x1d8, 0x11);
    CH3_LAYERS.forEach(([sx, sy, ex, ey], k) => {
      for (let c = 0; c < 0xb; c++) this.slot(0x10 + 0xb * k + c, 0x70079 + 0xb * k + c, 0x1b8, 0x1d8, sx, sy, ex, ey, 0x11);
    });
    for (let c = 0; c < 0xc; c++) this.slot(c + 4, 0x700d1 + c, 0x1b8, 0x1d8, 0x4b, 0xd8, 0x109, 0x164, 0x11);
    e.loadUnitSet(0xaa, this.res(0x10037), this.res(5));
    e.loadUnitSet(0xbc, this.res(0x30062), this.res(0x30063));
    e.loadUnitSet(0xce, this.res(0x300a4), this.res(0x300a5));
    e.loadUnitSet(0xe0, this.res(0x10059), this.res(5));
    this.slot(1, 0x70003, 500, 0xbe, 0, 0, 500, 0xbe, -0x23);
  }

  /** vmv2.exe 0x004352a7: 하늘에서 떨어지는 성(카메라 (30°, 40°, 0)) */
  private scene3a(): void {
    const e = this.engine;
    this.chapterPalette = 0x70077;
    commonPaletteB(e.base, this.read);
    this.loadPalette(0x70077, 7);
    e.fadeIn(0x10, 0, 0xec);
    e.setView(60);
    this.turn(30, 40, 0);
    e.fullRedraw = 0;
    const a = e.alloc(); // 0x4353c7
    a.slot = 3;
    a.flags = 3;
    a.behavior = (s) => this.fall(s);
    a.u0 = -0x34;
    const b = e.alloc();
    b.x = 0;
    b.y = 0;
    b.z = 0;
    b.depthAdd = 10000;
    b.slot = 2;
    b.flags = 6;
    b.behavior = (s) => void (s.x -= 0.5); // 0x4357d6
    e.slots[2].ox = -0x180;
    e.slots[2].oy = -0x100;
  }

  /** vmv2.exe 0x00435547 + 0x004355ff: 칸 3에 겹 8개(스텝 % 11)와 빛 프레임(n: 1~12, 19~21은 8·4·0) */
  private castle(n: number): void {
    const e = this.engine;
    for (let k = 0; k < 8; k++) this.paint(3, 0x10 + 0xb * k + (e.steps % 0xb));
    if (n < 1 || (n >= 0xd && (n < 0x13 || n > 0x15))) return;
    this.paint(3, (n < 0xd ? n : 0xc - (n * 4 - 0x48)) + 4);
  }

  /** vmv2.exe 0x00435404: 60스텝 동안 위에서 떨어지며 흔들림, 그 뒤 0x4356c9 */
  private fall(s: Sprite): void {
    this.engine.fadeStep();
    const c = s.counter >>> 0;
    const u = (0x3c - c) >>> 0;
    const d = (u * u) / 60;
    s.x = 0;
    s.y = -Math.sin((u / 60) * 5 * Math.PI) * 60;
    s.z = 50 * d;
    this.castle(s.u0++);
    if (c > 0x3b) {
      s.behavior = (t) => this.hover(t);
      s.counter = -1;
    }
  }

  /** vmv2.exe 0x004356c9: 떠서 흔들림, 0x16에 페이드 아웃, 0x1d 뒤 갈무리하고 장면 끝 */
  private hover(s: Sprite): void {
    const e = this.engine;
    e.fadeStep();
    s.y = Math.sin((s.counter >>> 0) * 0.4) * 10;
    this.castle(s.u0++);
    if (s.counter === 0x16) e.fadeOut(8);
    else if (s.counter === 0x1d) e.drawNow = 1;
    else if (s.counter >>> 0 > 0x1d) {
      e.fullRedraw = 1;
      e.sceneDone = 0;
      e.captureSlot(0);
    }
  }

  /** vmv2.exe 0x004357ed: 3장 이어서(곡선을 도는 카메라, 기사 둘과 내려오는 마법사) */
  private scene3b(): void {
    const e = this.engine;
    commonPaletteA(e.base, this.read);
    commonPaletteB(e.base, this.read);
    e.fadeIn(0x10, 0, 0xec);
    e.setView(60);
    e.fullRedraw = 1;
    const a = e.alloc();
    a.x = 0;
    a.y = 0;
    a.z = 300;
    a.scaleX = 4;
    a.scaleY = 4;
    a.flags = 3;
    a.behavior = (s) => this.orbit(s);
    const b = e.alloc();
    b.x = 0;
    b.y = 0;
    b.z = -100;
    b.scaleX = 4;
    b.scaleY = 4;
    b.flags = 3;
    b.behavior = (s) => void (s.slot = CHIP_STEP[Math.trunc(e.steps / 3) % 4] + ((s.counter >>> 0) < 10 ? 0xe6 : 0xe3)); // 0x435e73
    const c = e.alloc();
    c.x = 0;
    c.y = 0;
    c.z = -100;
    c.scaleX = 4;
    c.scaleY = 4;
    c.slot = 0xce;
    c.flags = 3;
    c.depthAdd = -1;
    c.behavior = (s) => this.descend(s);
    c.u0 = 8;
    c.ref = b;
    this.camPath = [[500, -400, -400], [-500, -200, -300], [-600, 0, 400]];
    this.aimPath = [[0, 0, 0], [0, 0, 150], [0, 0, 300]];
  }

  /** vmv2.exe 0x00435b45: 카메라 곡선을 50스텝에, 기사 걸음(10 전엔 빠르게) */
  private orbit(s: Sprite): void {
    const e = this.engine;
    e.fadeStep();
    const c = s.counter >>> 0;
    this.aim(c / 50);
    s.slot = c < 10 ? CHIP_STEP[e.steps % 4] + 0xcb : CHIP_STEP[Math.trunc(e.steps / 3) % 4] + 0xb6;
    if (c === 0x2a) e.fadeOut(8);
    else if (c > 0x29 && !e.fadeStep()) e.sceneDone = 0;
  }

  /** vmv2.exe 0x00435eea: u0스텝 뒤 위(−500)에서 4스텝에 내려오고, 다 내려오면 ref를 지운다 */
  private descend(s: Sprite): void {
    const k = s.counter - s.u0;
    if (k < 0) s.y = -500;
    else if (k < 5) s.y = (4 - k) * -125;
    if (k === 4) this.engine.kill(s.ref!);
  }

  /** vmv2.exe 0x00435c48 + 0x00435dd8: 카메라를 곡선 camPath(0x488770·0x488758·0x488740) 위 t로, aimPath(0x4886f8·0x488710·0x488728) 위 점을 바라보게 */
  private aim(t: number): void {
    const e = this.engine;
    e.camera = curve(t, ...this.camPath);
    const at = curve(t, ...this.aimPath);
    const d = [at[0] - e.camera[0], at[1] - e.camera[1], at[2] - e.camera[2]];
    const len = Math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]); // 0x43af4a
    e.rotation = lookAt(d.map((v) => v / len));
  }

  /** vmv2.exe 0x00436fc8: 방향 v를 회전한 뒤 수평으로 눕혀 +z와 이루는 각(acos, x < 0이면 360 − 각) + 120°를 6방향으로 × 3 */
  private heading(v0: readonly number[]): number {
    const v = [...v0];
    Engine.transform(v, this.engine.rotation);
    v[1] = 0;
    const len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
    const x = v[0] / len;
    const z = v[2] / len;
    let a = (acos(z) / Math.PI) * 180;
    if (x < 0) a = 360 - a;
    a += 120;
    return ((Math.trunc((a / 360) * 6) >>> 0) % 6) * 3;
  }

  /** vmv2.exe 0x00437733·0x004384c7: n = u0++가 0~limit − 1이면 칸 4에 프레임 n × mul / div + 5를 그려 넣는다 */
  private reveal(s: Sprite, limit: number, mul: number, div: number): void {
    const n = s.u0++;
    if (n < 0 || n >= limit) return;
    this.paint(4, Math.trunc((n * mul) / div) + 5);
    s.prevSlot = -1;
  }

  // ---- 4장 ----

  /** vmv2.exe 0x00435f53: 4장 그림 */
  private load4(): void {
    const e = this.engine;
    e.fullRedraw = 1; // 0x431a85
    this.slot(2, 0x700f8, 800, 600, 0, 0x1a6, 800, 600, 0x11);
    this.slot(3, 0x700ef, 0xb6, 0x200, 0, 0, 0xb6, 0x200, 0x11);
    this.slot(0x1c, 0x70109, 0x5c, 0x100, 0, 0, 0x5c, 0x100, 0x11);
    this.slot(0x35, 0x70122, 0x30, 0x80, 0, 0, 0x30, 0x80, 0x11);
    for (let c = 0; c < 8; c++) {
      this.slot(c + 4, 0x700f0 + c, 0xb6, 0x200, 0x13, 0, 0xa6, 0x122, 0x11);
      this.slot(c + 0x1d, 0x7010a + c, 0x5c, 0x100, 10, 0, 0x53, 0x93, 0x11);
      this.slot(c + 0x36, 0x70123 + c, 0x30, 0x80, 7, 0, 0x2a, 0x49, 0x11);
    }
    for (let c = 0; c < 0x10; c++) {
      this.slot(c + 0xc, 0x700df + c, 0xb6, 0x200, 0, 0, 0xb6, 0x200, 0x11);
      this.slot(c + 0x25, 0x700f9 + c, 0x5c, 0x100, 0, 0, 0x5c, 0x100, 0x11);
      this.slot(c + 0x3e, 0x70112 + c, 0x30, 0x80, 0, 0, 0x30, 0x80, 0x11);
    }
    e.loadUnitSet(0x4e, this.res(0x30076), this.res(0x30077));
    e.loadUnitSet(0x60, this.res(0x300ae), this.res(0x300af));
    e.loadUnitSet(0x72, this.res(0x1004b), this.res(5));
    this.slot(1, 0x70004, 500, 0xbe, 0, 0, 500, 0xbe, -0x23);
  }

  /** vmv2.exe 0x0043627c: 다가가는 카메라, 마법사 셋이 차례로 나타남 */
  private scene4a(): void {
    const e = this.engine;
    this.chapterPalette = 0x700de;
    commonPaletteB(e.base, this.read);
    this.loadPalette(0x700de, 7);
    e.fadeIn(0x10, 0, 0xec);
    e.setView(60);
    e.fullRedraw = 1;
    const a = e.alloc();
    a.x = 0;
    a.y = 0;
    a.z = -e.camera[2] * 1.0416666666666667 + e.camera[2];
    a.depthAdd = 1000;
    a.slot = 2;
    a.flags = 2;
    a.behavior = (s) => this.approach(s);
  }

  /** vmv2.exe 0x00436373: 카메라 z += 10(0x436596), 배경 z += 5, 10·15·30에 마법사, 0x28에 갈무리, 0x34에 페이드 아웃 */
  private approach(s: Sprite): void {
    const e = this.engine;
    e.fadeStep();
    e.camera[2] += 10;
    s.z += 5;
    const mage = (x: number, y: number, z: number, scale: number, first: number, canvas: number) => {
      const m = e.alloc();
      m.x = x;
      m.y = y;
      m.z = z;
      m.scaleX = scale;
      m.scaleY = scale;
      m.slot = canvas;
      m.behavior = (t) => this.grow(t, first, canvas);
    };
    if (s.counter === 10) mage(150, 30, 100, 1, 0xc, 3);
    else if (s.counter === 0xf) mage(-220, 80, -e.camera[2] + 100, 2, 0x25, 0x1c);
    else if (s.counter === 0x1e) mage(-180, 80, -e.camera[2] * 4 + 100, 4, 0x3e, 0x35);
    if (s.counter === 0x27) e.drawNow = 1;
    else if (s.counter === 0x28) e.captureSlot(0);
    else if (s.counter === 0x34) e.fadeOut(8);
    else if (s.counter >>> 0 > 0x3b) e.sceneDone = 0;
  }

  /** vmv2.exe 0x004365ad·0x004366d6·0x004367ff: 나타나는 프레임(first + 카운터) 15개, 그 뒤 칸 canvas에 프레임 canvas + 1 + (u0 % 8)을 그려 넣으며(0x4365e8·0x436711·0x43683a) */
  private grow(s: Sprite, first: number, canvas: number): void {
    s.flags = 3;
    s.slot = s.counter + first;
    if (s.counter >>> 0 <= 0xe) return;
    s.u0 = 0;
    s.behavior = (t) => {
      t.slot = canvas;
      this.paint(canvas, (t.u0++ % 8) + canvas + 1);
      t.prevSlot = -1;
    };
  }

  /** vmv2.exe 0x00436928: 4장 이어서(위에서 내려다보며 도는 카메라, 세 부대) */
  private scene4b(): void {
    const e = this.engine;
    commonPaletteA(e.base, this.read);
    commonPaletteB(e.base, this.read);
    e.fadeIn(8, 0, 0xec);
    e.setView(60);
    this.turn(60, 0, 0);
    e.fullRedraw = 1;
    const z = (e.camera[2] = e.camera[2] + e.camera[2]);
    this.camPath = [[1, 0, z], [Math.sin(Math.PI / 4) * -z, Math.cos(Math.PI / 4) * z, 0], [1, 0, -z]];
    this.aimPath = [[0, -130, 0], [0, 0, 0], [0, -130, 0]];
    for (const [x, z2, u0] of [[0, -100, 5], [-150, 80, 0x11], [150, 80, 0x1d]]) {
      const s = e.alloc();
      s.x = x;
      s.y = 0;
      s.z = z2;
      s.u0 = u0;
      this.squad(s);
    }
    const m = e.alloc();
    m.x = 0;
    m.y = 0;
    m.z = 0;
    m.depthAdd = 10000;
    m.flags = 0;
    m.behavior = (s) => {
      // 0x436ccf
      e.fadeStep();
      this.aim((s.counter >>> 0) / 60);
      if (s.counter === 0x34) e.fadeOut(8);
      else if (s.counter >>> 0 > 0x3b) e.sceneDone = 0;
    };
  }

  /** vmv2.exe 0x00436d42: 대장(2배, 0x4e) 둘레 100에 60°마다 소환 빛 여섯(u0 + 12스텝 뒤) */
  private squad(s: Sprite): void {
    const e = this.engine;
    s.scaleX = 2;
    s.scaleY = 2;
    s.slot = 0x4e;
    s.flags = 3;
    s.behavior = (t) => {
      // 0x436ee7
      const k = t.counter - t.u0;
      const dir = this.heading([0, 0, -1]);
      t.slot = k < 0 || k > 0xc ? dir + 0x72 + CHIP_STEP[((t.counter >>> 0) >>> 2) % 4] : dir + 0x4e + CHIP_STEP[k & 3];
    };
    for (let k = 0; k < 6; k++) {
      const v = [100, 0, 0];
      Engine.transform(v, rotY(((k * 60) / 180) * Math.PI));
      const f = e.alloc();
      f.x = v[0] + s.x;
      f.y = v[1] + s.y;
      f.z = v[2] + s.z;
      f.scaleX = s.scaleX;
      f.scaleY = s.scaleY;
      f.slot = 0x6e;
      f.flags = 0;
      f.u0 = s.u0 + 0xc;
      f.behavior = (t) => {
        // 0x4370f1
        const n = t.counter - t.u0;
        if (n < 0 || Math.trunc(n / 3) > 3) t.flags = 0;
        else {
          t.flags = 3;
          t.slot = Math.trunc(n / 3) + 0x6e;
        }
      };
    }
  }

  // ---- 5장 ----

  /** vmv2.exe 0x00437148: 5장 그림 */
  private load5(): void {
    const e = this.engine;
    e.fullRedraw = 1; // 0x431a85
    this.slot(2, 0x70141, 800, 600, 0, 0, 400, 600, 0x11);
    this.slot(3, 0x70142, 800, 600, 400, 0, 800, 600, 0x11);
    this.slot(4, 0x7012c, 0x1e0, 0x200, 0, 0, 0x1e0, 0x200, 0x11);
    for (let c = 0; c < 0xc; c++) this.slot(c + 5, 0x7012d + c, 0x1e0, 0x200, 0xb4, 0, 0x14a, 0x138, 0x11);
    for (let c = 0; c < 8; c++) this.slot(c + 0x11, 0x70139 + c, 0x74, 0x80, 0, 0, 0x74, 0x80, 0x11);
    e.loadUnitSet(0x19, this.res(0x10019), this.res(5));
    e.loadUnitSet(0x2b, this.res(0x30032), this.res(0x30033));
    e.loadUnitSet(0x3d, this.res(0x30094), this.res(0x30095));
    e.loadUnitSet(0x4f, this.res(0xf), this.res(0x10));
    e.loadUnitSet(0x61, this.res(0x1004d), this.res(5));
    e.shiftSlot(0x61, 0x70);
    e.loadUnitSet(0x73, this.res(0x3007a), this.res(0x3007b));
    e.loadUnitSet(0x85, this.res(0x400f0), this.res(0x400fc));
    this.slot(1, 0x70005, 500, 0xbe, 0, 0, 500, 0xbe, -0x23);
  }

  /** vmv2.exe 0x00437398: 떠오르는 소환사와 마법진 */
  private scene5a(): void {
    const e = this.engine;
    this.chapterPalette = 0x7012b;
    commonPaletteB(e.base, this.read);
    this.loadPalette(0x7012b, 7);
    e.fadeIn(0x10, 0, 0xec);
    e.setView(60);
    e.fullRedraw = 0;
    const a = e.alloc();
    a.x = 0;
    a.y = 0;
    a.z = 0;
    a.slot = 4;
    a.flags = 3;
    a.u0 = -0x14;
    a.behavior = (s) => {
      // 0x4376c5
      this.reveal(s, 0x15, 0xb, 0x14);
      s.y = 256 - Math.sin((Math.PI / 2) * ((s.counter >>> 0) / 40)) * 256;
      if (s.counter === 0x28) s.behavior = null;
    };
    const b = e.alloc();
    b.x = 0;
    b.y = 0;
    b.z = 0;
    b.depthAdd = -1;
    b.flags = 3;
    b.behavior = (s) => this.float5(s);
    for (const slot of [2, 3]) {
      const c = e.alloc();
      c.x = 0;
      c.y = 0;
      c.z = 0;
      c.depthAdd = 1000;
      c.slot = slot;
      c.flags = 2;
      c.behavior = null;
    }
  }

  /** vmv2.exe 0x004375ce: 떠 흔들리는 소환사(표 0x4734a8), 0x2a에 페이드 아웃, 0x31 뒤 갈무리하고 장면 끝 */
  private float5(s: Sprite): void {
    const e = this.engine;
    e.fadeStep();
    const c = s.counter >>> 0;
    s.x = 0;
    s.y = 0;
    s.z = 0;
    s.y = Math.sin(c * 0.15) * 10 + 140;
    s.slot = WAVE[(c >>> 1) % 0xe] + 0x11;
    if (c === 0x2a) e.fadeOut(8);
    else if (c === 0x31) e.drawNow = 1;
    else if (c > 0x31) {
      e.fullRedraw = 1;
      e.captureSlot(0);
      e.sceneDone = 0;
    }
  }

  /** vmv2.exe 0x00437826: 5장 이어서(소환사가 불러낸 기사가 적을 벤다) */
  private scene5b(): void {
    const e = this.engine;
    commonPaletteA(e.base, this.read);
    commonPaletteB(e.base, this.read);
    e.base.copyWithin(0xa2 * 4, 0x32 * 4, 0x32 * 4 + 0x110);
    e.fadeIn(8, 0, 0xec);
    e.setView(60);
    e.fullRedraw = 1;
    const a = e.alloc();
    a.x = 100;
    a.y = 0;
    a.z = 0;
    a.scaleX = 3;
    a.scaleY = 3;
    a.flags = 3;
    a.behavior = (s) => this.summon5(s);
    const b = e.alloc();
    b.x = 100;
    b.y = 0;
    b.z = 0;
    b.scaleX = 3;
    b.scaleY = 3;
    b.depthAdd = -1;
    b.flags = 0;
    b.behavior = null;
    a.ref = b;
    const c = e.alloc();
    c.depthAdd = 1000;
    c.behavior = (s) => {
      // 0x4379d5
      e.fadeStep();
      const n = s.counter >>> 0;
      if (n < 0x47) {
        const d1 = n / 70;
        const d2 = 290 * d1 + -180;
        e.setView(60);
        e.camera[2] = e.camera[2] - (d1 * 700 - 200);
        this.turn(30, -d2, 0);
      }
      if (n === 0x3e) e.fadeOut(0x10);
      else if (n > 0x45) e.sceneDone = 0;
    };
  }

  /** vmv2.exe 0x00437a9b: 소환사(0x1a), 8스텝 뒤 소환 연출(ref, 0x3d~), 16 뒤 걷기(0x437bfd)와 기사 */
  private summon5(s: Sprite): void {
    const e = this.engine;
    const k = s.counter - 8;
    s.slot = this.heading([-1, 0, 0]) + 0x1a;
    if (k < 0) return;
    const fx = s.ref!;
    fx.slot = Math.trunc(k / 2) + 0x3d;
    fx.flags = 3;
    if (k <= 7) return;
    e.kill(fx);
    s.u0 = s.counter;
    s.behavior = (t) => {
      // 0x437bfd
      const n = (t.counter - t.u0) >>> 0;
      const dir = this.heading([-1, 0, 0]);
      t.slot = dir + 0x2b + CHIP_STEP[Math.trunc(n / 3) % 4];
      if (n > 0x27) t.slot = dir + 0x1a;
    };
    const f = e.alloc();
    f.x = -100;
    f.y = 0;
    f.z = 0;
    f.scaleX = 3;
    f.scaleY = 3;
    f.behavior = (t) => this.burst5(t);
  }

  /** vmv2.exe 0x00437cc1: 소환 빛(0x4f~), 반 카운터 6에 기사와 흰 번쩍임(0xa2~0xe5번), 0x11 뒤 사라짐 */
  private burst5(s: Sprite): void {
    const e = this.engine;
    const h = (s.counter >>> 0) >>> 1;
    s.flags = 3;
    s.slot = h + 0x4f;
    if (h >= 0x11) {
      s.flags = 0;
      e.kill(s);
      return;
    }
    if (h !== 6) return;
    this.copy(s).behavior = (t) => this.knight5(t);
    e.fade(0xff, 0x100, 0, 0x20, 0xa2, 0xe6);
  }

  /** 새 스프라이트에 자리·배율을 베낀다 */
  private copy(s: Sprite): Sprite {
    const f = this.engine.alloc();
    f.x = s.x;
    f.y = s.y;
    f.z = s.z;
    f.scaleX = s.scaleX;
    f.scaleY = s.scaleY;
    return f;
  }

  /** vmv2.exe 0x00437de1: 기사(0x61), 10스텝 뒤 칼 든 기사(0x73)와 베기 */
  private knight5(s: Sprite): void {
    const k = s.counter - 10;
    const dir = this.heading([-1, 0, 0]);
    s.flags = 3;
    s.depthAdd = 1;
    if (k < 0) {
      s.slot = dir + 0x61;
      return;
    }
    if (k === 0) this.copy(s).behavior = (t) => this.slash5(t);
    s.slot = dir + 0x73;
  }

  /** vmv2.exe 0x00437efa: 베기(표 0x4734e0), 0x14에 앞으로 100 나가며 칼바람(0x437fe7), 4 뒤 사라짐(표 0x473500) */
  private slash5(s: Sprite): void {
    const e = this.engine;
    s.flags = 3;
    const k = s.counter - 0x14;
    if (k < 0) s.slot = SLASH[(s.counter >>> 0) % 8] + 0x73;
    else if (k < 4) {
      if (k === 0) {
        s.x -= 100;
        this.copy(s).behavior = (t) => {
          t.x -= 50;
          t.flags = 3;
          t.slot = CHIP_STEP[(t.counter >>> 0) % 4] + 0x85;
        };
      }
      s.slot = SLASH_END[k & 3] + 0x73;
    } else e.kill(s);
  }

  // ---- 6장 ----

  /** vmv2.exe 0x0043802a: 6장 그림 */
  private load6(): void {
    const e = this.engine;
    e.fullRedraw = 1; // 0x431a85
    this.slot(2, 0x70159, 800, 600, 0, 0, 800, 300, 0x11);
    this.slot(3, 0x7015a, 800, 600, 0, 300, 800, 600, 0x11);
    this.slot(4, 0x70144, 0x150, 0x1d8, 0, 0, 0x150, 0x1d8, 0x11);
    for (let c = 0; c < 0x14; c++) this.slot(c + 5, 0x70145 + c, 0x150, 0x1d8, 0, 0, 0x150, 0x8c, 0x11);
    e.loadUnitSet(0x19, this.res(0x1005b), this.res(5));
    e.loadUnitSet(0x2b, this.res(0x3008e), this.res(0x3008f));
    e.loadUnitSet(0x3d, this.res(0x300ba), this.res(0x300bb));
    for (let c = 0; c < 5; c++) e.slots[c * 2 + 0x3d].oy -= 0x60;
    this.slot(1, 0x70006, 500, 0xbe, 0, 0, 500, 0xbe, -0x23);
  }

  /** vmv2.exe 0x004381fd: 땅에서 솟는 탑 */
  private scene6a(): void {
    const e = this.engine;
    this.chapterPalette = 0x70143;
    commonPaletteB(e.base, this.read);
    this.loadPalette(0x70143, 7);
    e.fadeIn(0x10, 0, 0xec);
    e.setView(60);
    e.fullRedraw = 0;
    const a = e.alloc();
    a.x = 0;
    a.y = 0;
    a.z = 0;
    a.slot = 4;
    a.flags = 3;
    a.u0 = -0x14;
    a.behavior = (s) => {
      // 0x438414
      e.fadeStep();
      this.reveal(s, 0x29, 0x13, 0x28);
      s.y = Math.sin((Math.PI / 2) * ((s.counter >>> 0) / 60)) * 256 + -200;
      if (s.counter === 0x34) e.fadeOut(8);
      else if (s.counter === 0x3b) e.drawNow = 1;
      else if (s.counter >>> 0 > 0x3b) {
        e.fullRedraw = 1;
        e.captureSlot(0);
        e.sceneDone = 0;
      }
    };
    for (const slot of [2, 3]) {
      const b = e.alloc();
      b.x = 0;
      b.y = -88;
      b.z = 0;
      b.depthAdd = 1000;
      b.slot = slot;
      b.flags = 2;
      b.behavior = (s) => void (s.y += 0.5); // 0x4385ba
    }
    e.slots[2].ox = -0x180;
    e.slots[2].oy = -0x100;
    e.slots[3].ox = -0x180;
    e.slots[3].oy = 0x2c;
  }

  /** vmv2.exe 0x004385d1: 6장 이어서(마법사가 불러낸 별 무리) */
  private scene6b(): void {
    const e = this.engine;
    commonPaletteA(e.base, this.read);
    commonPaletteB(e.base, this.read);
    e.fadeIn(8, 0, 0xec);
    e.setView(60);
    e.fullRedraw = 1;
    this.camPath = [[200, 0, -50], [50, -100, -400], [0, -1000, -600]];
    this.aimPath = [[200, 0, 0], [50, 0, 0], [0, 0, -200]];
    const a = e.alloc();
    a.x = 0;
    a.y = 0;
    a.z = 0;
    a.scaleX = 3;
    a.scaleY = 3;
    a.flags = 3;
    a.behavior = (s) => {
      // 0x43887f
      s.slot = CHIP_STEP[((s.counter >>> 0) >>> 2) % 4] + 0x28;
      if (s.counter >>> 0 > 0x13) {
        s.counter = -1;
        s.behavior = (t) => this.cast6(t);
      }
    };
    const m = e.alloc();
    m.depthAdd = 1000;
    m.behavior = (s) => {
      // 0x438821
      e.fadeStep();
      this.aim((s.counter >>> 0) / 55);
      if (s.counter >>> 0 > 0x36) e.sceneDone = 0;
    };
  }

  /** vmv2.exe 0x004388c3: 주문(0x3a·0x3b), 5에 마법(0x4389ce), 10 뒤 날아오름(0x438978) */
  private cast6(s: Sprite): void {
    const c = s.counter >>> 0;
    s.slot = (c % 2) + 0x3a;
    if (c === 5) {
      const f = this.copy(s);
      f.depthAdd = -1;
      f.flags = 0;
      f.behavior = (t) => this.bloom6(t);
    }
    if (c > 10) {
      s.counter = -1;
      s.behavior = (t) => {
        const n = t.counter >>> 0;
        t.slot = (n % 6) * 3 + 0x19 + CHIP_STEP[(n >>> 2) % 4];
        t.y -= 50;
      };
    }
  }

  /** vmv2.exe 0x004389ce: 마법 빛(0x2d + 3h), 4에 고리 둘(0x438b09, u0 1·0), 반 카운터 2 뒤 사라짐 */
  private bloom6(s: Sprite): void {
    const h = (s.counter >>> 0) >>> 1;
    s.flags = 3;
    s.slot = h * 3 + 0x2d;
    if (s.counter === 4) {
      for (const u0 of [1, 0]) {
        const f = this.copy(s);
        f.depthAdd = 1;
        f.flags = 0;
        f.u0 = u0;
        f.behavior = (t) => this.ring6(t);
      }
    } else if (h > 2) this.engine.kill(s);
  }

  /** vmv2.exe 0x00438b09: 고리(0x3d + u0 + 2h), u0 1은 0x42 + h로 이어지고, u0 0은 반 카운터 5에 별 여섯(위 96 × 배율, 둘레 200)을 뿌리고 사라짐 */
  private ring6(s: Sprite): void {
    const e = this.engine;
    const h = (s.counter >>> 0) >>> 1;
    s.flags = 3;
    if (h < 5) s.slot = s.u0 + 0x3d + h * 2;
    else if (s.u0 === 1) s.slot = h + 0x42;
    else {
      for (let k = 0; k < 6; k++) {
        const v = [-200, 0, 0];
        Engine.transform(v, rotY(k * SIXTH));
        const f = e.alloc();
        f.x = s.x;
        f.y = s.y;
        f.z = s.z;
        f.y = 96 * s.scaleY + f.y;
        f.x = v[0] + f.x;
        f.y = f.y + v[1];
        f.z = f.z + v[2];
        f.scaleX = s.scaleX;
        f.scaleY = s.scaleY;
        f.flags = 0;
        f.u0 = k;
        f.behavior = (t) => this.star6(t);
      }
      e.kill(s);
    }
    if (h > 7) e.kill(s);
  }

  /** vmv2.exe 0x00438ced: 별(0x4b + h), 4에 자기 각·다음 각 방향 200에 작은 별 둘(0x438f45), 반 카운터 3 뒤 사라짐 */
  private star6(s: Sprite): void {
    const e = this.engine;
    const h = (s.counter >>> 0) >>> 1;
    s.flags = 3;
    s.slot = h + 0x4b;
    if (s.counter === 4) {
      for (const k of [s.u0, s.u0 + 1]) {
        const v = [-200, 0, 0];
        Engine.transform(v, rotY(k * SIXTH));
        const f = e.alloc();
        f.x = v[0] + s.x;
        f.y = s.y + v[1];
        f.z = s.z + v[2];
        f.scaleX = s.scaleX;
        f.scaleY = s.scaleY;
        f.flags = 0;
        f.behavior = (t) => {
          // 0x438f45
          const n = (t.counter >>> 0) >>> 1;
          t.flags = 3;
          t.slot = n + 0x4b;
          if (n > 3) e.kill(t);
        };
      }
    } else if (h > 3) e.kill(s);
  }

  // ---- 7장(마지막 카드) ----

  /** vmv2.exe 0x00438f82: 마지막 그림 위·아래 반쪽과 제목 */
  private load7(): void {
    const e = this.engine;
    e.fullRedraw = 1; // 0x431a85
    this.slot(1, 0x70007, 500, 0xbe, 0, 0, 500, 0xbe, -0x23);
    this.slot(2, 0x701a5, 0x300, 0x200, 0, 0, 0x300, 0x100, 0x11);
    this.slot(3, 0x701a6, 0x300, 0x200, 0, 0x100, 0x300, 0x200, 0x11);
  }

  /** vmv2.exe 0x0043903c: 글 카드처럼 위·아래 반쪽이 날아오고(앞쪽만 페이드·제목), 제목은 화면 좌표 */
  private scene7(): void {
    const e = this.engine;
    this.loadPalette(0x701a4, 7);
    this.loadPalette(0x70000, 0xd3);
    e.fadeIn(8, 0, 0xec);
    e.setView(60);
    e.fullRedraw = 1;
    for (const [slot, lead] of [[2, true], [3, false]] as const) {
      const s = e.alloc();
      s.x = 0;
      s.y = 0;
      s.z = 0;
      s.scaleX = 0.5;
      s.scaleY = 0.5;
      s.slot = slot;
      s.flags = 2;
      s.behavior = (t) => this.cardFly(t, lead, true);
    }
  }

  // ---- 로고와 타이틀 ----

  /** exe의 i32 상자 표(sx, sy, ex, ey) n개 */
  private boxes(addr: number, n: number): number[][] {
    const v = new DataView(this.exe.read(addr, n * 16).buffer);
    return Array.from({ length: n }, (_, i) => [0, 1, 2, 3].map((k) => v.getInt32(i * 16 + k * 4, true)));
  }

  /** vmv2.exe 0x0043946e: 로고 왼쪽(0x7015c~)·오른쪽(0x70173~) 23장(4열 판의 상자 0x472f08·0x473078에서 판 위치를 뺀다)과 0x439c0b */
  private loadLogo(): void {
    const e = this.engine;
    const left = this.boxes(0x472f08, 0x17);
    const right = this.boxes(0x473078, 0x17);
    for (let u = 0; u < 0x17; u++) {
      const dx = (u % 4) * -0x218;
      const dy = Math.trunc(u / 4) * -0xe4;
      e.loadSlot(u + 4, this.res(0x7015c + u), 0x248, 0xe4, left[u][0] + dx, left[u][1] + dy, left[u][2] + dx, left[u][3] + dy);
      const rx = (u % 4) * -0x1f2 + 0x56;
      const ry = Math.trunc(u / 4) * 0x98 + 0x558;
      e.loadSlot(u + 0x1c, this.res(0x70173 + u), 0x248, 0x98, right[u][0] + rx, right[u][1] - ry, right[u][2] + rx, right[u][3] - ry);
    }
    this.loadTitle();
  }

  /** vmv2.exe 0x00439c0b: 로고 반짝임 26장(0x7018a~, 상자 0x4731e8, 투명색 0x10)과 바탕 위·아래(0x701a8·0x701a9 − 7) */
  loadTitle(): void {
    const e = this.engine;
    e.fullRedraw = 1; // 0x431a85
    this.boxes(0x4731e8, 0x1a).forEach(([sx, sy, ex, ey], k) => {
      e.loadSlot(k + 0x34, this.res(0x7018a + k), 0x248, 0x128, sx, sy, ex, ey);
      e.slots[k + 0x34].key = 0x10;
    });
    this.slot(0x4e, 0x701a8, 0x300, 0x200, 0, 0, 0x300, 0x100, -7);
    this.slot(0x4f, 0x701a9, 0x300, 0x200, 0, 0x100, 0x300, 0x200, -7);
  }

  /** 0x439756·0x439d23 앞부분: 공통 팔레트, 0x7015b(7번~)·0x701a7(0xbf번~), 5번 파랑, 페이드 없이, 시야 60° */
  private titlePalette(): void {
    const e = this.engine;
    this.chapterPalette = 0x7015b;
    commonPaletteA(e.base, this.read);
    commonPaletteB(e.base, this.read);
    this.loadPalette(0x7015b, 7);
    this.loadPalette(0x701a7, 0xbf);
    e.base.set([0, 0, 0xff], 5 * 4);
    e.resetFade();
    e.setView(60);
  }

  /** 바탕 위·아래 반쪽(깊이 +2) */
  private backdrop(): void {
    for (const slot of [0x4e, 0x4f]) {
      const b = this.engine.alloc();
      b.x = 0;
      b.y = 0;
      b.z = 0;
      b.flags = 2;
      b.slot = slot;
      b.depthAdd = 2;
      b.behavior = null;
    }
  }

  /** vmv2.exe 0x00439756: 로고 두 쪽이 날아와 맞물림 */
  private logo(): void {
    const e = this.engine;
    this.titlePalette();
    e.fullRedraw = 1;
    for (const behavior of [(s: Sprite) => this.logoLeft(s), (s: Sprite) => this.logoRight(s)]) {
      const a = e.alloc();
      a.x = -25;
      a.y = 0;
      a.z = 0;
      a.flags = 3;
      a.behavior = behavior;
    }
  }

  /** vmv2.exe 0x004398a3: 왼쪽 조각(4 + k % 23), k = 40 − 카운터가 1이면 완성 로고·바탕과 0xbf~0xe5번 32스텝 페이드 인 */
  private logoLeft(s: Sprite): void {
    const e = this.engine;
    const k = 0x28 - s.counter;
    if (k >= 0) {
      s.slot = (k % 0x17) + 4;
      s.y = k * -2.5 - 77;
      s.z = k * -7.5;
    }
    if (k < 1) e.kill(s);
    else if (k === 1) {
      const g = e.alloc();
      g.x = -25;
      g.y = 0;
      g.z = 0;
      g.slot = 0x34;
      g.depthAdd = 1;
      g.behavior = (t) => this.logoShine(t);
      this.backdrop();
      e.fullRedraw = 0;
      e.fadeIn(0x20, 0xbf, 0xe6);
    }
  }

  /** vmv2.exe 0x00439a95: 오른쪽 조각(0x32 − k % 23) */
  private logoRight(s: Sprite): void {
    const k = 0x28 - s.counter;
    if (k >= 0) {
      s.slot = 0x32 - (k % 0x17);
      s.y = k * 2.5 + 60;
      s.z = k * -7.5;
    }
    if (k < 1) this.engine.kill(s);
  }

  /** vmv2.exe 0x00439b04: 완성 로고, 10 뒤 올라감(0x439b35: 10스텝에 y −9.1씩, 10에 반짝임, 0x27 뒤 장면 끝) */
  private logoShine(s: Sprite): void {
    const e = this.engine;
    s.flags = 3;
    e.fadeStep();
    if (s.counter >>> 0 <= 9) return;
    s.counter = -1;
    s.behavior = (t) => {
      e.fadeStep();
      const c = t.counter >>> 0;
      if (c < 0xb) {
        t.y = c * -9.1;
        if (c === 10) this.spark(t);
      } else if (c > 0x27) e.sceneDone = 0;
    };
  }

  /** 자리를 베낀 반짝임(0x439bb8: 0x35~0x4d, 0x19 뒤 사라짐) */
  private spark(s: Sprite): void {
    const g = this.engine.alloc();
    g.x = s.x;
    g.y = s.y;
    g.z = s.z;
    g.behavior = (t) => {
      if (t.counter === 0) t.flags = 0;
      else {
        t.flags = 3;
        t.slot = t.counter + 0x34;
      }
      if (t.counter >>> 0 > 0x19) this.engine.kill(t);
    };
  }

  /** vmv2.exe 0x00439d23: 타이틀(로고 (−25, −91), 200스텝마다 반짝임 0x439f40), 계속 플래그를 내려 메뉴로 */
  titleScene(): void {
    const e = this.engine;
    this.titlePalette();
    e.fullRedraw = 0;
    e.drawNow = 1;
    e.dirtyAll();
    const a = e.alloc();
    a.x = -25;
    a.y = -91;
    a.z = 0;
    a.slot = 0x34;
    a.depthAdd = 1;
    a.flags = 3;
    a.counter = 1;
    a.behavior = (s) => {
      if ((s.counter >>> 0) % 200 === 0) this.spark(s);
    };
    this.backdrop();
    e.keepGoing = 0;
  }
}

/** vmv2.exe 0x0043a780: 방향 d를 바라보는 회전(요·피치) */
function lookAt(d: readonly number[]): number[] {
  const h = Math.sqrt(d[0] * d[0] + d[2] * d[2]);
  const [s, c] = h === 0 ? [0, 1] : [-d[0] / h, d[2] / h];
  return [c, s * d[1], -s * h, 0, h, d[1], s, -c * d[1], c * h];
}

/** vmv2.exe 0x00453074(acos): x87 fpatan(√((1 + x)(1 − x)), x) */
function acos(x: number): number {
  return Math.abs(x) < 1 ? Math.atan2(Math.sqrt((1 + x) * (1 - x)), x) : Math.acos(x);
}
