// 오프닝 애니메이션 엔진(vmv2.exe 객체 0x4887d8, 0x431900~0x43a320). 원근 투영 스프라이트 32개, 그림 칸 256개, 고친 사각형 16개, 팔레트 섞기.
// 원작 메모리 배치를 그대로 따른다: 스프라이트는 풀에서 다시 쓰일 때 0x43258c가 지우는 칸만 지운다(나머지는 옛 값). 해독 메모 notes_title.md §5
import { Flash, GAME_COLORS } from '../../battle/palette.ts';
import { TRANSPARENT } from '../../battle/sheet.ts';

export const SCREEN_W = 768;
export const SCREEN_H = 512;
const SPRITES = 32;
const DIRTY_MAX = 16;
const CHIP = 0x120; // 24 × 12

/** 그림 칸(0x24바이트): 0 한 장, 1 칩 2 × … 묶음(0x4321d9) */
export interface Slot {
  kind: number;
  /** 픽셀(종류 0) 또는 칩 시트(종류 1). 장면이 직접 그려 넣기도 한다 */
  data: Uint8Array;
  /** 종류 1: 배치(u16 32칸, 4열 × 8줄) */
  layout: Uint16Array | null;
  size: number;
  ox: number;
  oy: number;
  w: number;
  h: number;
  key: number;
}

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export type Behavior = (s: Sprite) => void;

/** 스프라이트(0x70바이트) */
export class Sprite {
  next: Sprite | null = null; // +0 활성·빈 목록
  next2: Sprite | null = null; // +4 지울 목록
  x = 0; // +8
  y = 0; // +0x10
  z = 0; // +0x18
  depthAdd = 0; // +0x20
  depth = 0; // +0x28 정렬 깊이
  scaleX = 1; // +0x30
  scaleY = 1; // +0x38
  rect: Rect = { left: 0, top: 0, right: 0, bottom: 0 }; // +0x40
  slot = 0; // +0x50
  prevSlot = 0; // +0x54
  flags = 8; // +0x58: 1 투명, 2 보임, 4 화면 좌표, 8 지움
  prevFlags = 0; // +0x5c
  counter = 0; // +0x60
  behavior: Behavior | null = null; // +0x64
  /** +0x68·+0x6c 동작별 칸(정수 또는 스프라이트) */
  u0 = 0;
  u1 = 0;
  ref: Sprite | null = null;
}

/** vmv2.exe 0x00452538(__ftol) 앞의 반올림: 0 이상이면 +0.5, 아니면 −0.5 뒤 0 쪽으로 자름 */
export const roundAway = (v: number): number => Math.trunc(v >= 0 ? v + 0.5 : v - 0.5);

export class Engine {
  sceneDone = 0; // +0
  fullRedraw = 0; // +4
  keepGoing = 1; // +8
  drawNow = 0; // +0xc
  readonly dib: Uint8Array; // +0x10
  readonly clip: Rect = { left: 0, top: 0, right: SCREEN_W, bottom: SCREEN_H }; // +0x14
  readonly slots: Slot[] = []; // +0x24
  readonly sprites: Sprite[];
  active: Sprite | null = null; // +0x30
  free: Sprite | null; // +0x34
  erase: Sprite | null = null; // +0x38
  focal = 0; // +0xe3c
  steps = 0; // +0xe44
  vclock = 0x34bc0; // +0xe48
  vwait = 0x34bc0; // +0xe4c
  /** 고친 사각형(0x483428, 16개) */
  readonly dirty: Rect[] = [];
  /** 카메라 0x4886d8 */
  camera = [0, 0, 0];
  /** 회전 행렬 0x488790(3 × 3) */
  rotation = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  /** 기본 팔레트 0x4800e0(r, g, b, x 236개) */
  readonly base = new Uint8Array(GAME_COLORS * 4);
  private readonly flash = new Flash();
  /** 0x4886f0: 페이드 중 */
  fading = false;
  /** 마지막으로 실현한 섞인 팔레트(0x482a0c) */
  colors: Uint8Array = new Uint8Array(GAME_COLORS * 4);

  constructor() {
    this.dib = new Uint8Array(SCREEN_W * SCREEN_H);
    this.sprites = Array.from({ length: SPRITES }, () => new Sprite());
    // vmv2.exe 0x0043193c: 빈 목록 0 → 1 → … → 31, 깃발 8, 동작 없음
    this.sprites.forEach((s, i) => {
      s.next = this.sprites[i + 1] ?? null;
      s.flags = 8;
      s.behavior = null;
    });
    this.free = this.sprites[0];
    this.fullRedraw = 1; // 0x431a85
  }

  /** vmv2.exe 0x0041b08f + 0x0042ef47: 0x482a0c를 팔레트·DIB 색 표에 */
  private realize(): void {
    this.colors = this.flash.apply(this.base);
  }

  /** vmv2.exe 0x00431abe: 리소스를 칸에(원점 = (sx − 폭/2, sy − 높이/2), 크기 = (ex − sx, ey − sy), 투명색 = 첫 바이트) */
  loadSlot(n: number, bytes: Uint8Array, width: number, height: number, sx: number, sy: number, ex: number, ey: number): void {
    const data = bytes.slice();
    this.slots[n] = { kind: 0, data, layout: null, size: data.length, ox: sx - Math.trunc(width / 2), oy: sy - Math.trunc(height / 2), w: ex - sx, h: ey - sy, key: data[0] };
  }

  /** vmv2.exe 0x004321d9: 유닛 그림 묶음 18칸(칩 시트·배치, 96 × 96 상자 원점 −48) */
  loadUnitSet(n: number, sheet: Uint8Array, layout: Uint8Array): void {
    const data = sheet.slice();
    const v = new DataView(layout.buffer, layout.byteOffset, layout.byteLength);
    for (let k = 0; k < 0x12; k++) {
      const frame = new Uint16Array(32);
      for (let i = 0; i < 32; i++) frame[i] = v.getUint16(k * 0x40 + i * 2, true);
      this.slots[n + k] = { kind: 1, data, layout: frame, size: data.length, ox: -48, oy: -48, w: 0x60, h: 0x60, key: TRANSPARENT };
    }
  }

  /** vmv2.exe 0x00431c69: 칸 픽셀(종류 1은 시트 전체)과 투명색에 delta(바이트 덧셈) */
  shiftSlot(n: number, delta: number): void {
    const s = this.slots[n];
    for (let i = 0; i < s.size; i++) s.data[i] = (s.data[i] + delta) & 0xff;
    if (s.kind === 0) s.key = (s.key + delta) & 0xff;
    else for (let k = 0; k < 0x12; k++) this.slots[n + k].key = (this.slots[n + k].key + delta) & 0xff;
  }

  /** vmv2.exe 0x00431b81: 지금 DIB(자르기 영역 전체)를 칸에 */
  captureSlot(n: number): void {
    const w = this.clip.right - this.clip.left;
    const h = this.clip.bottom - this.clip.top;
    this.slots[n] = { kind: 0, data: this.dib.slice(0, w * h), layout: null, size: w * h, ox: Math.trunc(-w / 2), oy: Math.trunc(-h / 2), w, h, key: TRANSPARENT };
  }

  /** vmv2.exe 0x0043258c */
  alloc(): Sprite {
    const s = this.free!;
    this.free = s.next;
    s.next = this.active;
    this.active = s;
    s.next2 = null;
    s.depthAdd = 0;
    s.rect = { left: 0, top: 0, right: 0, bottom: 0 };
    s.scaleX = 1;
    s.scaleY = 1;
    s.flags = 0;
    s.counter = 0;
    s.prevSlot = -1;
    return s;
  }

  /** vmv2.exe 0x00432799: 활성 목록에서 빼 빈 목록 앞으로 */
  private release(s: Sprite): void {
    if (s === this.active) this.active = s.next;
    else {
      let p = this.active!;
      while (p.next !== s) p = p.next!;
      p.next = s.next;
    }
    s.next = this.free;
    this.free = s;
  }

  /** vmv2.exe 0x00432647: 지울 목록에 넣고 지금 자리를 고친 사각형에 */
  kill(s: Sprite): void {
    if (s.flags & 8) return;
    s.next2 = this.erase;
    this.erase = s;
    s.flags = 8;
    const r = this.clipped(s.rect);
    if (r.left < r.right && r.top < r.bottom) this.addDirty(r);
  }

  /** vmv2.exe 0x00432767: 활성 스프라이트를 모두 지운다 */
  killAll(): void {
    for (let s = this.active; s; s = s.next) this.kill(s);
  }

  private clipped(r: Rect): Rect {
    return { left: Math.max(r.left, this.clip.left), top: Math.max(r.top, this.clip.top), right: Math.min(r.right, this.clip.right), bottom: Math.min(r.bottom, this.clip.bottom) };
  }

  /** vmv2.exe 0x00421c36: 화면 전체 하나 */
  dirtyAll(): void {
    this.dirty.length = 0;
    this.dirty.push({ left: 0, top: 0, right: SCREEN_W, bottom: SCREEN_H });
  }

  /** vmv2.exe 0x00421c6d: 합친 넓이가 따로 둘보다 크지 않은 첫 사각형과 합치고, 없으면 새로(16개 넘으면 마지막과 합침) */
  addDirty(r: Rect): void {
    if (!(r.left < r.right || r.top < r.bottom)) return;
    for (const d of this.dirty) {
      const left = Math.min(d.left, r.left);
      const right = Math.max(d.right, r.right);
      const top = Math.min(d.top, r.top);
      const bottom = Math.max(d.bottom, r.bottom);
      if ((right - left) * (bottom - top) <= (d.right - d.left) * (d.bottom - d.top) + (r.right - r.left) * (r.bottom - r.top)) {
        Object.assign(d, { left, top, right, bottom });
        return;
      }
    }
    if (this.dirty.length < DIRTY_MAX) {
      this.dirty.push({ ...r });
      return;
    }
    const last = this.dirty[DIRTY_MAX - 1];
    last.left = Math.min(last.left, r.left);
    last.right = Math.max(last.right, r.right);
    last.top = Math.min(last.top, r.top);
    last.bottom = Math.max(last.bottom, r.bottom);
  }

  /** vmv2.exe 0x0043ae50: 행 벡터 × 행렬 */
  static transform(v: number[], m: readonly number[]): void {
    const [x, y, z] = v;
    v[0] = z * m[6] + y * m[3] + x * m[0];
    v[1] = z * m[7] + y * m[4] + x * m[1];
    v[2] = z * m[8] + y * m[5] + x * m[2];
  }

  /** vmv2.exe 0x004327fb: 투영, 화면 사각형, 바뀌었으면 옛·새 자리를 고친 사각형에 */
  project(s: Sprite): void {
    const v = [s.x, s.y, s.z];
    if (!(s.flags & 4)) {
      v[0] = v[0] - this.camera[0];
      v[1] = v[1] - this.camera[1];
      v[2] = v[2] - this.camera[2];
      Engine.transform(v, this.rotation);
    } else v[2] = v[2] + this.focal;
    s.depth = v[2] + s.depthAdd;
    const k = this.focal / v[2];
    const sx = k * s.scaleX;
    const sy = k * s.scaleY;
    let px = v[0] * k;
    let py = v[1] * k;
    const old = { ...s.rect };
    if (s.flags & 2) {
      const slot = this.slots[s.slot];
      px = slot.ox * sx + Math.trunc(SCREEN_W / 2) + px;
      py = slot.oy * sy + Math.trunc(SCREEN_H / 2) + py;
      s.rect = { left: roundAway(px), top: roundAway(py), right: roundAway(px + slot.w * sx), bottom: roundAway(py + slot.h * sy) };
    }
    if (s.slot === s.prevSlot && s.flags === s.prevFlags && s.rect.left === old.left && s.rect.top === old.top && s.rect.right === old.right && s.rect.bottom === old.bottom) return;
    const n = this.clipped(s.rect);
    const o = this.clipped(old);
    if (s.prevFlags & 2 && o.left < o.right && o.top < o.bottom) this.addDirty(o);
    if (s.flags & 2 && n.left < n.right && n.top < n.bottom) this.addDirty(n);
    s.prevSlot = s.slot;
    s.prevFlags = s.flags;
  }

  /** vmv2.exe 0x00432ed1: 먼 것(깊이 큰 것) 먼저 */
  private sort(): void {
    if (!this.active) return;
    for (let cur: Sprite = this.active; cur.next; cur = cur.next) {
      const nx: Sprite = cur.next;
      if (cur.depth < nx.depth) {
        cur.next = nx.next;
        let prev: Sprite | null = null;
        let at: Sprite | null = this.active;
        while (at && nx.depth < at.depth) {
          prev = at;
          at = at.next;
        }
        nx.next = at;
        if (prev) prev.next = nx;
        else this.active = nx;
        if (!cur.next) return;
      }
    }
  }

  /** vmv2.exe 0x00433473: 고친 사각형을 0x10으로 */
  private clear(): void {
    for (const d of this.dirty) for (let y = d.top; y < d.bottom; y++) this.dib.fill(TRANSPARENT, y * SCREEN_W + d.left, y * SCREEN_W + d.right);
  }

  /** vmv2.exe 0x00431d23: 같은 크기(src 폭 = slot.w), 자르기 rect ∩ clip */
  static blit(dst: Uint8Array, pitch: number, slot: { data: Uint8Array; w: number; key: number }, srcBase: number, r: Rect, clip: Rect, transparent: boolean): void {
    const left = Math.max(r.left, clip.left);
    const top = Math.max(r.top, clip.top);
    const right = Math.min(r.right, clip.right);
    const bottom = Math.min(r.bottom, clip.bottom);
    if (!(left < right && top < bottom)) return;
    for (let y = top; y < bottom; y++) {
      let src = srcBase + slot.w * (y - r.top) + (left - r.left);
      let at = y * pitch + left;
      if (!transparent) {
        dst.set(slot.data.subarray(src, src + right - left), at);
        continue;
      }
      for (let x = left; x < right; x++, src++, at++) {
        const c = slot.data[src];
        if (c !== slot.key) dst[at] = c;
      }
    }
  }

  /** vmv2.exe 0x00431f29: 늘리고 줄이기(16.16 고정소수, 반 칸 중심) */
  static stretch(dst: Uint8Array, pitch: number, slot: { data: Uint8Array; w: number; h: number; key: number }, srcBase: number, r: Rect, clip: Rect, transparent: boolean): void {
    const left = Math.max(r.left, clip.left);
    const top = Math.max(r.top, clip.top);
    const right = Math.min(r.right, clip.right);
    const bottom = Math.min(r.bottom, clip.bottom);
    if (!(left < right && top < bottom)) return;
    const dx = Math.trunc((slot.w << 16) / (r.right - r.left));
    const dy = Math.trunc((slot.h << 16) / (r.bottom - r.top));
    const x0 = (dx * (left - r.left) + Math.trunc(dx / 2)) | 0;
    let fy = (dy * (top - r.top) + Math.trunc(dy / 2)) | 0;
    for (let y = top; y < bottom; y++) {
      let at = y * pitch + left;
      let fx = x0;
      const row = srcBase + slot.w * (fy >> 16);
      for (let x = left; x < right; x++, at++) {
        const c = slot.data[row + (fx >> 16)];
        if (!transparent || c !== slot.key) dst[at] = c;
        fx = (fx + dx) | 0;
      }
      fy = (fy + dy) | 0;
    }
  }

  /** vmv2.exe 0x004322e6·0x00432410: 칩 묶음(4열 × 8줄, 열마다 아래 줄부터). 같은 크기면 칩 24 × 12, 아니면 몫(÷4·÷8)으로 나눈 칸에 늘려 */
  private drawChips(slot: Slot, r: Rect, clip: Rect, transparent: boolean, same: boolean): void {
    const chip = { data: slot.data, w: 0x18, h: 0xc, key: slot.key };
    const w = r.right - r.left;
    const h = r.bottom - r.top;
    const div = (v: number, n: number) => (v + ((v >> 31) & (n - 1))) >> Math.log2(n);
    let i = 0;
    for (let col = 0; col < 4; col++) {
      for (let row = 7; row >= 0; row--) {
        const c = slot.layout![i++];
        if ((c & 0xff) === 0xff) continue;
        const cell = same
          ? { left: r.left + col * 0x18, top: r.top + row * 0xc, right: r.left + col * 0x18 + 0x18, bottom: r.top + row * 0xc + 0xc }
          : { left: r.left + div(w * col, 4), top: r.top + div(h * row, 8), right: r.left + div((col + 1) * w, 4), bottom: r.top + div(h * (row + 1), 8) };
        if (same) Engine.blit(this.dib, SCREEN_W, chip, c * CHIP, cell, clip, transparent);
        else Engine.stretch(this.dib, SCREEN_W, chip, c * CHIP, cell, clip, transparent);
      }
    }
  }

  /** vmv2.exe 0x00432f83: 보이고 지우지 않을 스프라이트를 고친 사각형마다 */
  private draw(s: Sprite): void {
    if (!(s.flags & 2) || s.flags & 8) return;
    const slot = this.slots[s.slot];
    const same = s.rect.right - s.rect.left === slot.w && s.rect.bottom - s.rect.top === slot.h;
    const transparent = (s.flags & 1) !== 0;
    for (const d of this.dirty) {
      if (slot.kind === 1) this.drawChips(slot, s.rect, d, transparent, same);
      else if (same) Engine.blit(this.dib, SCREEN_W, slot, 0, s.rect, d, transparent);
      else Engine.stretch(this.dib, SCREEN_W, slot, 0, s.rect, d, transparent);
    }
  }

  /** 장면 함수 표(0x473388): [다음 장 읽기, 장면] */
  script: readonly (readonly [(() => void) | null, () => void])[] = [];
  scriptAt = 0;

  /** vmv2.exe 0x004330fa: 한 스텝(48ms). 계속이면 true(+8) */
  step(counter: number): boolean {
    let list = this.erase;
    this.erase = null;
    for (; list; list = list.next2) this.release(list);
    if (this.sceneDone === 0) {
      const scene = this.script[this.scriptAt][1];
      this.scriptAt++;
      scene();
      this.sceneDone = 1;
    }
    for (let s = this.active; s; s = s.next) {
      s.behavior?.(s);
      s.counter++;
    }
    for (let s = this.active; s; s = s.next) this.project(s);
    let draw = this.drawNow;
    this.drawNow = 0;
    if (this.sceneDone === 0 || (this.vclock - 0x3c) >>> 0 <= counter) draw = 1;
    if (this.fullRedraw === 0 || this.sceneDone !== 0) {
      this.sort();
      if (draw) {
        if (this.fullRedraw) this.clear();
        for (let s = this.active; s; s = s.next) this.draw(s);
      }
    } else if (this.fullRedraw) {
      this.dirtyAll();
      this.clear();
    }
    if (this.sceneDone === 0) this.killAll();
    if (draw) this.dirty.length = 0; // 0x421eb9: 무효화 뒤 비움
    this.steps++;
    const going = this.keepGoing;
    this.keepGoing = 1;
    return going !== 0;
  }

  /** 16ms 카운터(0x503dec, 내려감) */
  counter = 0x34bc0;

  /** vmv2.exe 0x0043307e(48ms 콜백마다): 대기 시각까지 쉬고, 뒤지면 그리지 않고 따라잡는다. 끝이면 false */
  tick(): boolean {
    for (;;) {
      if (this.vwait >>> 0 < this.counter >>> 0) return true;
      if (this.counter === 0) {
        this.vclock = 0x34bc0;
        this.counter = 0x34bc0;
      }
      this.vclock -= 3;
      if (!this.step(this.counter)) return false;
      if ((this.vclock - 0x3c) >>> 0 <= this.counter >>> 0) return true;
    }
  }

  /** vmv2.exe 0x0044e9b1: 지난 16ms 수만큼 카운터를 줄이되 0에서 멈춘다(0이면 그대로, 0x43307e가 다시 맞춤) */
  elapse(n: number): void {
    if (this.counter !== 0) this.counter = n < this.counter ? this.counter - n : 0;
  }

  /** vmv2.exe 0x004332d5 */
  resetClock(): void {
    this.vwait = 0x34bc0;
    this.vclock = 0x34bc0;
    this.counter = 0x34bc0;
  }

  /** vmv2.exe 0x00433304: n단위 동안 스텝 없음(장 읽기 멈춤) */
  pause(n: number): void {
    this.vwait = this.vclock - n;
    this.vclock = this.vwait;
  }

  /** 0x41b166으로 (c, c, c)·알파 from에 두고 0x41b284로 알파 to까지 step씩, 실현하고 페이드 중으로 */
  fade(c: number, from: number, to: number, step: number, first: number, end: number): void {
    this.flash.set(c, c, c, from, first, end);
    this.flash.start(c, c, c, to, step, first, end);
    this.realize();
    this.fading = true;
  }

  /** vmv2.exe 0x00433a1c: 검정에서 n스텝 페이드 인(first~end − 1번) */
  fadeIn(n: number, first: number, end: number): void {
    this.fade(0, 0x100, 0, Math.trunc(0x100 / n), first, end);
  }

  /** vmv2.exe 0x00433cb6: n스텝 페이드 아웃(전체) */
  fadeOut(n: number): void {
    this.fade(0, 0, 0x100, Math.trunc(0x100 / n), 0, GAME_COLORS);
  }

  /** vmv2.exe 0x004333b2: 섞임 없이 기본 팔레트 그대로, 페이드 끔 */
  resetFade(): void {
    this.flash.set(0, 0, 0, 0, 0, GAME_COLORS);
    this.realize();
    this.fading = false;
  }

  /** vmv2.exe 0x00433d15: 페이드 한 스텝. 아직 페이드 중이면 true */
  fadeStep(): boolean {
    if (!this.fading) return false;
    this.fading = this.flash.tick();
    if (this.fading) this.realize();
    return this.fading;
  }

  /** vmv2.exe 0x004333ed: 시야각(도)으로 초점 거리, 카메라 (0, 0, −초점), 회전 단위 행렬 */
  setView(degrees: number): void {
    this.focal = Math.trunc(this.clip.right / 2) / Math.tan((degrees / 2) * 0.017453292519943295);
    this.camera = [0, 0, -this.focal];
    this.rotation = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  }
}
