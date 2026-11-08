// 장면 창(CEndingWnd, vmv2.exe 0x0041becb)의 이벤트 엔진. 장 사이 장면(종류 0~5, DATA08)과 엔딩(종류 6, DATA09 ED)의 스크립트를 돈다.
// 스케줄러 0x41d843, 해석기 0x41da0d(명령 0~0x31), 객체 갱신 0x41f1fa·영역 0x420014. 해독 메모 re/scene.md
import { u32 } from '../battle/attack.ts';
import { drawText, readGlyphs } from '../battle/font.ts';
import { commonPaletteA, commonPaletteB, dibColors, Flash, GAME_COLORS } from '../battle/palette.ts';
import type { ReadAny } from '../battle/sheet.ts';
import { formatC } from '../battle/statusWindow.ts';
import { readActionNames } from '../../formats/actionTable.ts';
import { readNatialTable } from '../../formats/natialTable.ts';
import type { ExeImage } from '../../formats/exeImage.ts';
import { koreanLayout } from '../../i18n/hangul.ts';

export const SCENE_W = 0x300;
export const SCENE_H = 0x200;

/** 보고서 쪽 0의 경과 일(3자리)·시(2자리)·분 글의 x(64줄, 0x41c62f). 한국어판은 그 판 글의 빈칸에 맞춰 옮겼다(0x41ce65·0x41cec9·0x41cf2b) */
export const reportElapsedColumns = (): readonly [number, number, number] => (koreanLayout() ? [0x168, 0x190, 0x1a8] : [0x177, 0x1c7, 0x1e2]);
export const SCENE_START = 0x34bc0; // 0x41becb: 가상 시계·글 시계·16ms 카운터
const KINDS = 0x460168; // [종류 0~5] → DATA08
const ENDINGS = 0x460180; // [마스터] → DATA09 ED
const MORE_ENDINGS = 0x4601e8; // [ED 번호 1~0x1a] → DATA09
const PORTRAITS = 0x460298; // [마스터] → 명령 1의 0x1ffff
const PATTERNS = 0x460254; // [알파 / 16] → 무늬(0x41f1fa)
export const REPORT = 0x1b; // ED 번호 0x1b: 보고서(0x41c2f2)
const SEQUENCE_END = -0x80000000;
const BASE_COLORS = 0x100;
const FIELDS = 0x41; // 객체 0x104바이트

/** 진영 0 레코드에서 장면이 쓰는 것: 이름(%M), +0x9c 마스터(ED·명령 1 초상), 보고서의 목록·통계 */
export interface ScenePlayer {
  readonly name: string;
  readonly master: number;
  /** 보고서: 가진 네이티얼(1~24)·마법(10~15), 통계 59칸(블록 +0xd78) */
  readonly natials?: readonly number[];
  readonly spells?: readonly number[];
  readonly stats?: readonly number[];
}

/** 스레드(0x18바이트, 0x482e00) */
interface Thread {
  pc: number;
  sleep: number;
  loops: number;
  loopPc: number;
  /** 1 끝, 2 끝내도 됨 */
  flags: number;
  /** 객체 번호 표의 자리(0x100 이상 번호) */
  map: number;
}

/** 객체(0x104바이트, 0x421a85). 포인터 칸: 0x16 그림 → pixels, 0x17 부모 → 번호 + 1, 0x1a 배치표 → layout, 0x3c 자세 차례 → 스크립트 자리 */
export class SceneObject {
  readonly f = new Int32Array(FIELDS);
  pixels: Uint8Array | null = null;
  layout: Uint16Array | null = null;

  copyFrom(o: SceneObject): void {
    this.f.set(o.f);
    this.pixels = o.pixels;
    this.layout = o.layout;
  }
}

interface Rect {
  l: number;
  t: number;
  r: number;
  b: number;
}

/** 팔레트 칸(0xc바이트, 0x48352c): 처음 칸, 색들 */
interface Slot {
  first: number;
  data: Uint8Array;
}

/** vmv2.exe 0x0041c193: 장면 종류·ED 번호의 스크립트 리소스 */
export function sceneScript(exe: ExeImage, kind: number, master: number, index: number): number {
  if (kind !== 6) return u32(exe, KINDS + kind * 4);
  return index === 0 ? u32(exe, ENDINGS + master * 4) : u32(exe, MORE_ENDINGS + index * 4);
}

/** vmv2.exe 0x0041f82a 글 객체의 글: 글 명령 바이트를 fix(오역 보정)로 고친 뒤 %M = 진영 0 이름, %% = %로 푼다. 2바이트 글자는 둘째 바이트까지 한 글자 */
export function sceneText(raw: Uint8Array, name: string, fix: (s: string) => string): string {
  const t = fix(String.fromCharCode(...raw));
  let s = '';
  for (let i = 0; i < t.length; ) {
    const c = t.charCodeAt(i);
    if (c === 0x25 && t[i + 1] === '%') {
      s += '%';
      i += 2;
    } else if (c === 0x25 && t[i + 1] === 'M') {
      s += name;
      i += 2;
    } else if (c >= 0x80 && i + 1 < t.length) {
      s += t.slice(i, i + 2);
      i += 2;
    } else {
      s += t[i];
      i++;
    }
  }
  return s;
}

export class SceneEngine {
  /** 0x483528: 종류 6의 ED 번호(0x1b 보고서) */
  index = 0;
  /** 창이 닫혔다(0x41c0d3) */
  closed = false;
  /** 다음 장면(0x504008): 종류 0~5는 월드(0x4516f4), 엔딩 끝은 타이틀(0x425fa0) */
  next: 'world' | 'title' | null = null;
  /** DIB 색 표(RGBQUAD 256) */
  colors: Uint8Array = new Uint8Array(256 * 4);
  readonly flash = new Flash();
  private readonly exe: ExeImage;
  private readonly read: ReadAny;
  private readonly fix: (s: string) => string; // 글 명령의 오역 보정(스크립트 바이트 길이는 그대로)
  private readonly kind: number;
  private readonly player: ScenePlayer;
  private readonly music: (track: number) => void;
  private readonly glyphs: Uint8Array;
  private readonly natialNames: readonly string[];
  private readonly magicNames: readonly (string | null)[];
  private readonly patterns: Int32Array;
  private readonly base: Uint8Array; // 0x4800e0
  objects: SceneObject[] = [];
  private prev: SceneObject[] = [];
  private slots: Slot[] = [];
  private threads: Thread[] = [];
  private script: DataView = new DataView(new ArrayBuffer(0));
  private bytes: Uint8Array = new Uint8Array(0);
  private clock = SCENE_START; // 0x483404
  private timeline = SCENE_START; // 0x482df8
  private counter = SCENE_START; // 0x503dec
  /** 자르기 사각형(0x482de0)과 그 속도·남은 틱(0x483420…, 0x483530) */
  readonly clip = { left: 0, top: 0, right: SCENE_W, bottom: SCENE_H };
  private clipStep = { left: 0, top: 0, right: 0, bottom: 0, n: 0 };
  private recolor = false; // 0x48354c

  /** vmv2.exe 0x0041becb: base는 창 팔레트 0x4800e0의 지금 색(앞 장면이 남긴 색) */
  constructor(original: { readonly exe: ExeImage; readonly read: ReadAny; readonly fix?: (s: string) => string }, kind: number, player: ScenePlayer, base: Uint8Array, music: (track: number) => void = () => {}) {
    this.exe = original.exe;
    this.read = original.read;
    this.fix = original.fix ?? ((s) => s);
    this.kind = kind;
    this.player = { ...player, name: player.name.replace(/[\x00-\x1f]/g, ' ') }; // 제어 문자(손댄 세이브)는 빈칸. 원작은 글리프 표 앞을 읽어 그린다
    this.music = music;
    this.glyphs = readGlyphs(original.read);
    this.natialNames = readNatialTable(this.exe).map((n) => n.name);
    this.magicNames = readActionNames(this.exe);
    const p = this.exe.read(PATTERNS, 17 * 4);
    this.patterns = new Int32Array(p.buffer.slice(p.byteOffset, p.byteOffset + 17 * 4));
    this.base = new Uint8Array(BASE_COLORS * 4);
    this.base.set(base.subarray(0, BASE_COLORS * 4));
    this.load();
  }

  get threadCount(): number {
    return this.threads.length;
  }

  get slotCount(): number {
    return this.slots.length;
  }

  get objectCount(): number {
    return this.objects.length;
  }

  /** vmv2.exe 0x0041c111 + 0x0041c193: 화면·팔레트를 비우고 스크립트를 읽어 첫 스텝 */
  private load(): void {
    this.clear();
    this.objects = [];
    this.slots = [{ first: 0x32, data: this.base.slice(0x32 * 4, (0x32 + 0x44) * 4) }];
    this.threads = [{ pc: 0, sleep: 0, loops: 0, loopPc: 0, flags: 0, map: 0 }];
    Object.assign(this.clip, { left: 0, top: 0, right: SCENE_W, bottom: SCENE_H });
    this.clipStep.n = 0;
    this.bytes = this.read(sceneScript(this.exe, this.kind, this.player.master, this.index));
    this.script = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
    this.tick(this.counter);
  }

  /** vmv2.exe 0x0041c111: DIB를 색 10으로, 화면 전체를 다시, 팔레트 공통 1·2, 모든 칸 알파 0, 색 표를 다시 */
  protected clear(): void {
    this.image.fill(10);
    this.dirty = [{ l: 0, t: 0, r: SCENE_W, b: SCENE_H }]; // 0x421c36
    commonPaletteA(this.base, this.read);
    commonPaletteB(this.base, this.read);
    this.flash.set(0, 0, 0, 0, 0, 0xec);
    this.recolor = true;
  }

  /** vmv2.exe 0x0041d7e8: 스크립트 끝. 종류 6은 다음 ED·보고서·타이틀, 그 밖은 월드 */
  finish(): void {
    this.index++;
    if (this.kind !== 6) return this.close('world');
    if (this.index < REPORT) this.load();
    else if (this.index === REPORT) this.report();
    else this.close('title');
  }


  private close(next: 'world' | 'title'): void {
    this.closed = true;
    this.next = next;
  }

  /** vmv2.exe 0x0041d843: 48ms 콜백. counter는 16ms 카운터(0x503dec) */
  tick(counter: number): void {
    if (this.closed) return;
    this.counter = counter;
    if (this.index === REPORT) return this.reportTick();
    this.prev = this.objects.map((o) => {
      const c = new SceneObject();
      c.copyFrom(o);
      return c;
    });
    for (;;) {
      for (let i = 0; i < this.threads.length; i++) this.interpret(this.threads[i]);
      let done = true;
      for (let i = 0; i < this.threads.length; ) {
        if (this.threads[i].flags & 1) this.threads.splice(i, 1);
        else {
          if (!(this.threads[i].flags & 2)) done = false;
          i++;
        }
      }
      if (done) return this.finish();
      this.update();
      const before = this.clock;
      this.clock -= 3;
      if (!(this.counter <= before - 0x3f)) break;
    }
    this.draw();
    if (this.flash.tick()) this.recolor = true;
    if (this.recolor) {
      this.recolor = false;
      this.colors = dibColors(this.flash.apply(this.base));
    }
  }

  // ---- Task 4: 보고서 TBREP(0x41c2f2) ----
  /** 0x482dc8: 쪽 0 통계, 1 네이티얼, 2 마법 */
  page = 0;
  /** 0x483414: 마우스 위 단추(0 앞, 1 다음, −1 없음) */
  hover = -1;
  private phase = 0; // 0x483548: 0 페이드, 1 단추 깜빡임
  private half = 0; // 0x483400
  private frame = 0; // 0x482ddc
  private reportBg = new Uint8Array(0);
  private reportChips = new Uint8Array(0);

  /** vmv2.exe 0x0041c2f2: 바탕 DATA09 0x7b(+ 0x6f)·팔레트 0x7c(0x76번부터), 검정에서 밝아짐, 단추 칩의 투명 픽셀을 바탕으로 채움(0x43fac3) */
  protected report(): void {
    this.clear();
    this.page = 0;
    this.phase = 0;
    this.half = 0;
    this.frame = 0;
    this.hover = -1;
    this.reportBg = this.read(0x9007b)
      .slice(0, SCENE_W * SCENE_H)
      .map((b) => (b + 0x6f) & 0xff);
    const pal = this.read(0x9007c);
    this.base.set(pal.subarray(0, Math.min(pal.length, (BASE_COLORS - 0x76) * 4)), 0x76 * 4);
    this.flash.set(0, 0, 0, 0x100, 0, 0xec);
    this.flash.start(0, 0, 0, 0, 0x10, 0, 0xec);
    this.colors = dibColors(this.flash.apply(this.base));
    this.reportChips = this.read(0x16).slice();
    const bake = (at: number, k: number) => {
      for (let r = 0; r < 12; r++) {
        for (let c = 0; c < 0x18; c++) {
          const i = k * 0x120 + r * 0x18 + c;
          if (this.reportChips[i] === 0x10) this.reportChips[i] = this.reportBg[at + r * SCENE_W + c];
        }
      }
    };
    for (let s = 0; s < 7; s++) {
      const at = s < 3 ? 0x57240 : 0x57288;
      for (let f = 0; f < 8; f++) {
        bake(at, s * 0x20 + f * 2);
        bake(at + 0x18, s * 0x20 + 1 + f * 2);
        bake(at + 0x2400, s * 0x20 + 0x10 + f * 2);
        bake(at + 0x2418, s * 0x20 + 0x11 + f * 2);
      }
    }
    this.render();
  }

  /** vmv2.exe 0x0041d543: 페이드가 끝나면 단추 깜빡임(두 틱마다 프레임 + 1, 8프레임) */
  protected reportTick(): void {
    if (this.phase === 0) {
      if (!this.flash.tick()) this.phase++;
      else this.colors = dibColors(this.flash.apply(this.base));
    } else if (this.phase === 1 && ++this.half > 1) {
      this.half = 0;
      this.frame = this.frame + 1 > 7 ? 0 : this.frame + 1;
      this.buttons();
    }
  }

  /** vmv2.exe 0x0041d75a: 단추 판정(깜빡임 때만, 쪽 0의 앞 단추는 없음) */
  private hit(x: number, y: number): number {
    if (this.phase !== 1) return -1;
    let h = -1;
    if (x >= 0x240 && x <= 0x26f && y >= 0x1d0 && y <= 0x1e7) h = 0;
    else if (x > 0x287 && x < 0x2b8 && y > 0x1cf && y < 0x1e8) h = 1;
    return h === 0 && this.page === 0 ? -1 : h;
  }

  /** vmv2.exe 0x00421f85: 마우스 위. 바뀌어 다시 그렸으면 true */
  move(x: number, y: number): boolean {
    if (this.index !== REPORT) return false;
    const h = this.hit(x, y);
    if (h === this.hover) return false;
    this.hover = h;
    this.buttons();
    return true;
  }

  /** vmv2.exe 0x00421fc8: 누르기. 먼저 마우스 위를 다시 정한다(가상 +0x14 → 0x421f85). 효과음을 돌려준다 */
  click(x: number, y: number): number[] {
    if (this.index !== REPORT) return [];
    this.move(x, y);
    if (this.hover === 0) {
      this.page--;
      this.hover = this.hit(x, y);
      this.render();
      return [1];
    }
    if (this.hover === 1) {
      this.page++;
      if (this.page < 3) {
        this.hover = this.hit(x, y);
        this.render();
      } else this.finish();
      return [1];
    }
    return [];
  }

  /** vmv2.exe 0x0041c5cb: 바탕, 쪽, 단추 */
  private render(): void {
    this.image.set(this.reportBg);
    if (this.page === 0) this.statsPage();
    else if (this.page === 1) this.natialPage();
    else if (this.page === 2) this.magicPage();
    this.buttons();
  }

  /** vmv2.exe 0x0041d5fb: 깜빡임 때 앞(쪽 0이면 꺼짐 2·3)·다음(쪽 2면 5·6) 단추, 마우스 위면 + 1 */
  private buttons(): void {
    if (this.phase !== 1) return;
    const prev = (this.page !== 0 ? 0 : 2) + (this.hover === 0 ? 1 : 0);
    const next = (this.page !== 2 ? 3 : 5) + (this.hover === 1 ? 1 : 0);
    this.button(0x57240, prev);
    this.button(0x57288, next);
  }

  /** vmv2.exe 0x0041d6b9: 칩 2 × 2(0x43f8f1 통째) */
  private button(at: number, state: number): void {
    const k = state * 0x20 + this.frame * 2;
    for (const [dst, chip] of [
      [at, k],
      [at + 0x18, k + 1],
      [at + 0x2400, k + 0x10],
      [at + 0x2418, k + 0x11],
    ]) {
      for (let r = 0; r < 12; r++) this.image.set(this.reportChips.subarray(chip * 0x120 + r * 0x18, chip * 0x120 + (r + 1) * 0x18), dst + r * SCENE_W);
    }
  }

  /** 0x423bc9: 그림자 (+1, +1) 색 10 → 본문 */
  private say(s: string, at: number, color = 0xb): void {
    drawText(this.image, at + SCENE_W + 1, SCENE_W, s, 10, this.glyphs);
    drawText(this.image, at, SCENE_W, s, color, this.glyphs);
  }

  /** 0x423b8c(%*d) 그림자와 본문 */
  private num(v: number, width: number, at: number, color = 0xb): void {
    this.say(formatC('%*d', width, v), at, color);
  }

  private get stats(): readonly number[] {
    return this.player.stats ?? new Array<number>(59).fill(0);
  }

  /** vmv2.exe 0x0041c62f: 날짜·시각, 마정석, 사용 MP, 마스터 행동, 행동별 횟수, 네이티얼 원소 경향 */
  private statsPage(): void {
    const s = this.stats;
    const label = (a: number, at: number) => this.say(this.exe.cString(a), at);
    label(0x460360, 0xc120);
    label(0x460378, 0x13940);
    label(0x460388, 0x17540);
    label(0x460390, 0x1ed38);
    label(0x4603a0, 0x22940);
    label(0x4603ac, 0x26540);
    label(0x4603b4, 0x2a140);
    label(0x4603bc, 0x2dd40);
    label(0x4603c4, 0x35540);
    label(0x4603d8, 0x39140);
    label(0x4603ec, 0x3cd40);
    label(0x460400, 0x40940);
    label(0x460414, 0x44540);
    const [days, hours, minutes] = reportElapsedColumns();
    this.num(Math.trunc(s[0] / 0x5a0), 3, 0xc000 + days);
    this.num(Math.trunc((s[0] % 0x5a0) / 0x3c), 2, 0xc000 + hours);
    this.say(formatC('%02d', s[0] % 0x3c), 0xc000 + minutes);
    this.num(s[1], 6, 0x13978);
    this.num(s[2], 6, 0x17578);
    const at = (x: number, y: number) => y * SCENE_W + x;
    this.num(s[3], 6, at(0x178, 0xb8));
    this.num(s[4], 6, at(0x178, 0xcc));
    let actions = 0;
    for (let k = 0; k < 6; k++) actions += s[k + 5];
    const groups = [0, 0, 0, 0];
    let total = 0;
    for (let k = 0; k < 0x18; k++) {
      groups[Math.trunc(k / 6)] += s[k + 0xb];
      total += s[k + 0xb];
    }
    this.num(actions, 6, at(0x178, 0xe0));
    this.num(total, 6, at(0x178, 0xf4));
    if (total === 0) total = 1;
    groups.forEach((g, k) => {
      this.num(Math.trunc((g * 100) / total), 3, at(0x180, 0x130 + k * 0x14));
      this.num(Math.trunc((Math.trunc((g * 10000) / total) + 5) / 10) % 10, 1, at(0x1a0, 0x130 + k * 0x14));
    });
  }

  /** vmv2.exe 0x0041d077: 네이티얼 24(두 열 × 12, 6줄마다 8 더 띄움) 이름·횟수·SAT·평균. 가진 것은 0xb, 아니면 0x79 */
  private natialPage(): void {
    const s = this.stats;
    this.say(this.exe.cString(0x460434), 0x16850);
    this.say(this.exe.cString(0x460458), 0x16990);
    for (let k = 0; k < 0x18; k++) {
      const color = (this.player.natials ?? []).includes(k + 1) ? 0xb : 0x79;
      const x = Math.trunc(k / 12) * 0x140;
      const y = (k % 12) * 0x14 + 0x94 + Math.trunc((k % 12) / 6) * 8;
      const row = y * SCENE_W + x;
      this.say(this.natialNames[k], row + 0x50, color);
      this.num(s[0xb + k], 5, row + 0xe8, color);
      this.num(s[0x23 + k], 7, row + 0x110, color);
      this.num(s[0xb + k] === 0 ? 0 : Math.trunc((Math.trunc((s[0x23 + k] * 10) / s[0xb + k]) + 5) / 10), 3, row + 0x150, color);
    }
  }

  /** vmv2.exe 0x0041d3c6: 마법 6 이름·횟수 */
  private magicPage(): void {
    const s = this.stats;
    this.say(this.exe.cString(0x46047c), 0x16850);
    for (let k = 0; k < 6; k++) {
      const color = (this.player.spells ?? []).includes(k + 10) ? 0xb : 0x79;
      const row = (k * 0x14 + 0x94) * SCENE_W;
      this.say(this.magicNames[k + 10] ?? '', row + 0x50, color);
      this.num(s[5 + k], 5, row + 0xd0, color);
    }
  }

  /** DIB 768 × 512(0x482dd8) */
  readonly image = new Uint8Array(SCENE_W * SCENE_H);
  /** 다시 그릴 사각형(0x483428, 16개까지. 넘치면 마지막에 합침) */
  private dirty: Rect[] = [];

  /** vmv2.exe 0x00421c6d: 넓이가 둘의 합 이하로 합쳐지는 사각형과 합치고, 아니면 더한다(16개면 마지막 것에 합침) */
  private addDirty(l: number, t: number, r: number, b: number): void {
    if (!(l < r || t < b)) return;
    for (const d of this.dirty) {
      const ul = Math.min(d.l, l);
      const ur = Math.max(d.r, r);
      const ut = Math.min(d.t, t);
      const ub = Math.max(d.b, b);
      if ((ur - ul) * (ub - ut) <= (d.r - d.l) * (d.b - d.t) + (r - l) * (b - t)) {
        Object.assign(d, { l: ul, t: ut, r: ur, b: ub });
        return;
      }
    }
    if (this.dirty.length < 16) this.dirty.push({ l, t, r, b });
    else {
      const d = this.dirty[15];
      d.l = Math.min(d.l, l);
      d.r = Math.max(d.r, r);
      d.t = Math.min(d.t, t);
      d.b = Math.max(d.b, b);
    }
  }

  /** vmv2.exe 0x0041fa90: 객체마다 지난·이번 화면 사각형으로 다시 그릴 곳을 모으고, 깊이·y 차례로 그린다(0x41ff02). 그 뒤 0x421eb9가 비운다 */
  protected draw(): void {
    const same = (a: Int32Array, b: Int32Array) => [0, 1, 4, 5, 0x12, 0x13, 0x14, 0x1b].every((k) => a[k] === b[k]);
    this.objects.forEach((o, i) => {
      const c = o.f;
      const p = i < this.prev.length ? this.prev[i].f : null;
      const [nl, nt, nr, nb] = [c[0xe], c[0xf], c[0x10], c[0x11]];
      const [ol, ot, or, ob] = p ? [p[0xe], p[0xf], p[0x10], p[0x11]] : [0, 0, 0, 0];
      if (nr === 0) {
        if (or !== 0) this.addDirty(ol, ot, or, ob);
      } else if (or === 0) this.addDirty(nl, nt, nr, nb);
      else if (same(c, p!)) {
        if (nl === ol && nt === ot && nr === or && nb === ob) return;
        if (nl < or && nt < ob) {
          let left = nl;
          if (nl < ol) {
            this.addDirty(nl, nt, ol, nb);
            left = ol;
          } else if (ol < nl) this.addDirty(ol, ot, nl, ob);
          let right = nr;
          if (or < nr) {
            this.addDirty(or, nt, nr, nb);
            right = or;
          } else if (nr < or) this.addDirty(nr, ot, or, ob);
          if (nt < ot) this.addDirty(left, nt, right, ot);
          else if (ot < nt) this.addDirty(left, ot, right, nt);
          if (ob < nb) this.addDirty(left, ob, right, nb);
          else if (nb < ob) this.addDirty(left, nb, right, ob);
        } else {
          this.addDirty(nl, nt, nr, nb);
          this.addDirty(ol, ot, or, ob);
        }
      } else {
        this.addDirty(ol, ot, or, ob);
        this.addDirty(nl, nt, nr, nb);
      }
    });
    const order: number[] = [];
    this.objects.forEach((o, i) => {
      let k = i;
      for (; k > 0; k--) {
        const q = this.objects[order[k - 1]].f;
        if (q[0x13] < o.f[0x13] || (q[0x13] === o.f[0x13] && q[1] <= o.f[1])) break;
        order[k] = order[k - 1];
      }
      order[k] = i;
    });
    for (const d of this.dirty) this.redraw(d, order);
    this.dirty = [];
  }

  /** vmv2.exe 0x0041ff02: 색 10으로 지우고 보이는 객체를 그린다 */
  private redraw(d: Rect, order: readonly number[]): void {
    const w = d.r - d.l;
    if (w > 0) for (let y = d.t; y < d.b; y++) this.image.fill(10, y * SCENE_W + d.l, y * SCENE_W + d.r);
    for (const i of order) {
      const o = this.objects[i];
      if (o.f[0x14] & 1) this.drawObject(o, d);
    }
  }

  /** vmv2.exe 0x00420287: 객체 화면 사각형과 겹치는 곳만, 배치표(플래그 4)·크기 바꿈에 따라 네 갈래 */
  private drawObject(o: SceneObject, d: Rect): void {
    const f = o.f;
    const c = { l: Math.max(f[0xe], d.l), t: Math.max(f[0xf], d.t), r: Math.min(f[0x10], d.r), b: Math.min(f[0x11], d.b) };
    if (!(c.l < c.r && c.t < c.b)) return;
    const flat = f[2] === f[4] && f[3] === f[5];
    if (f[0x14] & 4) {
      if (flat) this.drawLayout(o, c);
      else this.drawLayoutScaled(o, c);
    } else if (flat) this.drawPicture(o, c);
    else this.drawPictureScaled(o, c);
  }

  /** 무늬 칸 +0x48의 바이트 k를 32비트에 네 번(0x4208d4 등) */
  private static pattern(v: number): number[] {
    return [0, 1, 2, 3].map((k) => ((v >>> (k * 8)) & 0xff) * 0x01010101);
  }

  /** 무늬 m의 shift번째 비트(앞부터)가 켜져 있으면 건너뜀 */
  private static masked(m: number, shift: number): boolean {
    return ((m << (shift & 0x1f)) & 0x80000000) !== 0;
  }

  /** vmv2.exe 0x004208d4: 그림 1:1 */
  private drawPicture(o: SceneObject, c: Rect): void {
    const f = o.f;
    const px = o.pixels!;
    const pw = f[0xc] - f[0xa];
    const w = c.r - c.l;
    const pat = f[0x12] ? SceneEngine.pattern(f[0x12]) : null;
    const transparent = (f[0x14] & 2) !== 0;
    for (let y = 0; y < c.b - c.t; y++) {
      const m = pat ? pat[(c.t - f[1] + y) & 3] : 0;
      if (pat && m === 0xffffffff) continue;
      const src = (c.t - f[1] - f[0xb] + y) * pw + (c.l - f[0] - f[0xa]);
      const dst = (c.t + y) * SCENE_W + c.l;
      for (let x = 0; x < w; x++) {
        const v = px[src + x];
        if (transparent && v === 0x10) continue;
        if (pat && SceneEngine.masked(m, c.l - f[0] + x)) continue;
        this.image[dst + x] = v;
      }
    }
  }

  /** vmv2.exe 0x004213d0: 그림 크기 바꿈(원본 = 화면 × 원본 크기 / 그리는 크기) */
  private drawPictureScaled(o: SceneObject, c: Rect): void {
    const f = o.f;
    const px = o.pixels!;
    const pw = f[0xc] - f[0xa];
    const w = c.r - c.l;
    const pat = f[0x12] ? SceneEngine.pattern(f[0x12]) : null;
    const transparent = (f[0x14] & 2) !== 0;
    const x0 = c.l - f[0];
    const xs = Array.from({ length: w }, (_, k) => Math.trunc(((x0 + k) * f[2]) / f[4]) - f[0xa]);
    for (let y = c.t - f[1], row = c.t; row < c.b; y++, row++) {
      const m = pat ? pat[y & 3] : 0;
      if (pat && m === 0xffffffff) continue;
      const src = (Math.trunc((y * f[3]) / f[5]) - f[0xb]) * pw;
      for (let x = 0; x < w; x++) {
        const v = px[src + xs[x]];
        if (transparent && v === 0x10) continue;
        if (pat && SceneEngine.masked(m, x0 + x)) continue;
        this.image[row * SCENE_W + c.l + x] = v;
      }
    }
  }

  /** vmv2.exe 0x0042039c: 배치표 1:1(칩 4열 × 8줄, 아래 줄부터, 0x7ff 빈 칩) */
  private drawLayout(o: SceneObject, c: Rect): void {
    const f = o.f;
    const px = o.pixels!;
    const lay = o.layout!;
    const [ox, oy, ex, ey] = [c.l - f[0], c.t - f[1], c.r - f[0], c.b - f[1]];
    const pat = f[0x12] ? SceneEngine.pattern(f[0x12]) : null;
    const transparent = (f[0x14] & 2) !== 0;
    for (let col = 0; col < 4; col++) {
      const cx = f[0xa] + col * 0x18;
      if (!(cx < ex && ox < cx + 0x18)) continue;
      const sx = cx < ox ? ox - cx : 0;
      const exx = ex < cx + 0x18 ? ex - cx : 0x18;
      for (let r = 0; r < 8; r++) {
        const v = lay[f[0x1b] * 0x20 + col * 8 + 7 - r];
        if (v === 0x7ff) continue;
        const cy = f[0xb] + r * 0xc;
        if (!(cy < ey && oy < cy + 0xc)) continue;
        const sy = cy < oy ? oy - cy : 0;
        const eyy = ey < cy + 0xc ? ey - cy : 0xc;
        const dstX = f[0] + f[0xa] + col * 0x18 + sx;
        for (let y = 0; y < eyy - sy; y++) {
          const m = pat ? pat[(f[0xb] + sy + y) & 3] : 0;
          if (pat && m === 0xffffffff) continue;
          const src = v * 0x120 + (sy + y) * 0x18 + sx;
          const dst = (r * 0xc + sy + f[1] + f[0xb] + y) * SCENE_W + dstX;
          for (let x = 0; x < exx - sx; x++) {
            const p = px[src + x];
            if (transparent && p === 0x10) continue;
            if (pat && SceneEngine.masked(m, f[0xa] + col * 0x18 + sx + x)) continue;
            this.image[dst + x] = p;
          }
        }
      }
    }
  }

  /** vmv2.exe 0x00420c36: 배치표 크기 바꿈(칩 칸 경계를 크기에 맞춰 올림) */
  private drawLayoutScaled(o: SceneObject, c: Rect): void {
    const f = o.f;
    const px = o.pixels!;
    const lay = o.layout!;
    const [ox, oy, ex, ey] = [c.l - f[0], c.t - f[1], c.r - f[0], c.b - f[1]];
    const pat = f[0x12] ? SceneEngine.pattern(f[0x12]) : null;
    const transparent = (f[0x14] & 2) !== 0;
    const edge = (v: number, num: number, den: number) => Math.trunc((v * num - 1 + den) / den);
    for (let col = 0; col < 4; col++) {
      const x0 = edge(f[0xa] + col * 0x18, f[4], f[2]);
      const x1 = edge(f[0xa] + (col + 1) * 0x18, f[4], f[2]);
      if (!(x0 < ex && ox < x1)) continue;
      const sx = x0 < ox ? ox - x0 : 0;
      const exx = ex < x1 ? ex - x0 : x1 - x0;
      const xs = Array.from({ length: exx - sx }, (_, k) => Math.trunc(((sx + k) * 0x18) / (x1 - x0)));
      for (let r = 0; r < 8; r++) {
        const v = lay[f[0x1b] * 0x20 + col * 8 + 7 - r];
        if (v === 0x7ff) continue;
        const y0 = edge(f[0xb] + r * 0xc, f[5], f[3]);
        const y1 = edge(f[0xb] + (r + 1) * 0xc, f[5], f[3]);
        if (!(y0 < ey && oy < y1)) continue;
        const sy = y0 < oy ? oy - y0 : 0;
        const eyy = ey < y1 ? ey - y0 : y1 - y0;
        let dst = (f[1] + y0 + sy) * SCENE_W + f[0] + x0 + sx;
        for (let y = sy; y < eyy; y++, dst += SCENE_W) {
          const m = pat ? pat[y & 3] : 0;
          if (pat && m === 0xffffffff) continue;
          const src = v * 0x120 + Math.trunc((y * 0xc) / (y1 - y0)) * 0x18;
          for (let x = 0; x < xs.length; x++) {
            const p = px[src + xs[x]];
            if (transparent && p === 0x10) continue;
            if (pat && SceneEngine.masked(m, sx + x)) continue;
            this.image[dst + x] = p;
          }
        }
      }
    }
  }

  private i32 = (at: number) => this.script.getInt32(at, true);

  /** vmv2.exe 0x0041f7f9: 0x100 이상은 스레드의 객체 번호 표 */
  private obj(t: Thread, n: number): SceneObject {
    return this.objects[n > 0xff ? this.i32(t.map + (n - 0x100) * 4) : n];
  }

  /** vmv2.exe 0x00421a85 */
  private alloc(): SceneObject {
    const o = new SceneObject();
    o.f[0x13] = 0x100;
    this.objects.push(o);
    return o;
  }

  private slot(n: number): Slot {
    return this.slots[n];
  }

  /** vmv2.exe 0x0041da0d: 스레드 하나를 기다리거나 끝날 때까지 */
  private interpret(t: Thread): void {
    if (t.sleep >= 1) {
      t.sleep--;
      return;
    }
    let pc = t.pc;
    const a = (k: number) => this.i32(pc + 4 * k);
    for (;;) {
      const op = a(0);
      let next = pc + 4;
      let stop = false;
      switch (op) {
        case 0: {
          // 그림 객체
          const o = this.alloc();
          o.pixels = this.read(a(1) >>> 0);
          o.f[8] = o.f[2] = o.f[4] = a(2);
          o.f[9] = o.f[3] = o.f[5] = a(3);
          o.f[10] = a(4);
          o.f[11] = a(5);
          o.f[12] = a(6);
          o.f[13] = a(7);
          o.f[0x15] = o.pixels.length;
          next = pc + 32;
          break;
        }
        case 1: {
          // 배치표 객체
          const o = this.alloc();
          let id = a(1) >>> 0;
          if (id === 0x1ffff) id = u32(this.exe, PORTRAITS + this.player.master * 4);
          o.pixels = this.read(id);
          const l = this.read(a(2) >>> 0);
          o.layout = new Uint16Array(l.buffer.slice(l.byteOffset, l.byteOffset + (l.byteLength & ~1)));
          o.f[8] = o.f[2] = o.f[4] = a(3);
          o.f[9] = o.f[3] = o.f[5] = a(4);
          o.f[10] = a(5);
          o.f[11] = a(6);
          o.f[12] = o.f[10] + 0x60;
          o.f[13] = o.f[11] + 0x60;
          o.f[0x14] |= 4;
          o.f[0x15] = l.length;
          next = pc + 28;
          break;
        }
        case 2: {
          // 팔레트 칸(처음 칸 6)
          const data = this.read(a(1) >>> 0).slice();
          const count = (data.length + 3) >> 2;
          const padded = new Uint8Array(count * 4);
          padded.set(data);
          this.slots.push({ first: 6, data: padded });
          next = pc + 8;
          break;
        }
        case 3:
          this.slot(a(1)).first = a(2) - 10;
          next = pc + 12;
          break;
        case 4: {
          const s = this.slot(a(1));
          const scale = [a(2), a(3), a(4)];
          for (let k = 0; k < s.data.length >> 2; k++) {
            for (let ch = 0; ch < 3; ch++) {
              const v = Math.trunc((s.data[k * 4 + ch] * scale[ch]) / 0x100);
              s.data[k * 4 + ch] = (v > 0xff ? 0xff : v) & 0xff;
            }
          }
          next = pc + 20;
          break;
        }
        case 5: {
          const s = this.slot(a(1));
          const count = s.data.length >> 2;
          this.base.set(s.data.subarray(0, Math.max(0, Math.min(count, BASE_COLORS - s.first)) * 4), s.first * 4);
          this.setColors(a(2), a(3), a(4), a(5), s.first, s.first + count);
          this.recolor = true;
          next = pc + 24;
          break;
        }
        case 6:
          this.setColors(a(1), a(2), a(3), a(4), a(5) - 10, a(6) - 10);
          this.recolor = true;
          next = pc + 28;
          break;
        case 7: {
          const s = this.slot(a(1));
          this.startColors(a(2), a(3), a(4), a(5), a(6), s.first, s.first + (s.data.length >> 2));
          next = pc + 28;
          break;
        }
        case 8:
          this.startColors(a(1), a(2), a(3), a(4), a(5), a(6) - 10, a(7) - 10);
          next = pc + 32;
          break;
        case 9: {
          const src = this.obj(t, a(1));
          this.alloc().copyFrom(src);
          next = pc + 8;
          break;
        }
        case 0xa: {
          const o = this.obj(t, a(1));
          o.f[0x17] = this.objects.indexOf(this.obj(t, a(2))) + 1;
          o.f[0x18] = a(3);
          o.f[0x19] = a(4);
          next = pc + 20;
          break;
        }
        case 0xb: {
          const o = this.obj(t, a(1));
          const d = a(2) & 0xff;
          const p = o.pixels!;
          for (let k = 0; k < o.f[0x15] && k < p.length; k++) if (p[k] !== 0x10) p[k] = (p[k] + d) & 0xff;
          next = pc + 12;
          break;
        }
        case 0xc: {
          const o = this.obj(t, a(1));
          o.f[0] = a(2);
          o.f[1] = a(3);
          next = pc + 16;
          break;
        }
        case 0xd: {
          const o = this.obj(t, a(1));
          o.f[0] += a(2);
          o.f[1] += a(3);
          next = pc + 16;
          break;
        }
        case 0xe: {
          const o = this.obj(t, a(1));
          o.f.set([a(2), a(3), a(4), a(5)], 0x1e);
          o.f[0x1c] = a(6);
          o.f[0x1d] = 0;
          next = pc + 28;
          break;
        }
        case 0xf: {
          const o = this.obj(t, a(1));
          o.f[0x22] = o.f[0];
          o.f[0x23] = o.f[1];
          o.f[0x24] = a(2);
          o.f[0x25] = a(3);
          o.f[0x1d] = o.f[0x1c] = a(4);
          next = pc + 20;
          break;
        }
        case 0x10:
          this.obj(t, a(1)).f.set([a(2), a(3), a(4), a(5)], 6);
          next = pc + 24;
          break;
        case 0x11: {
          const o = this.obj(t, a(1));
          o.f.set([a(2), a(3), a(4), a(5)], 0x28);
          o.f[0x26] = a(6);
          o.f[0x27] = 0;
          next = pc + 28;
          break;
        }
        case 0x12: {
          const o = this.obj(t, a(1));
          o.f.set(o.f.subarray(6, 10), 0x2c);
          o.f.set([a(2), a(3), a(4), a(5)], 0x30);
          o.f[0x27] = o.f[0x26] = a(6);
          next = pc + 28;
          break;
        }
        case 0x13: {
          const o = this.obj(t, a(1));
          o.f[4] = a(2);
          o.f[5] = a(3);
          next = pc + 16;
          break;
        }
        case 0x14: {
          const o = this.obj(t, a(1));
          o.f[0x36] = a(2);
          o.f[0x37] = a(3);
          o.f[0x34] = a(4);
          o.f[0x35] = 0;
          next = pc + 20;
          break;
        }
        case 0x15: {
          const o = this.obj(t, a(1));
          o.f[0x38] = o.f[4];
          o.f[0x39] = o.f[5];
          o.f[0x3a] = a(2);
          o.f[0x3b] = a(3);
          o.f[0x35] = o.f[0x34] = a(4);
          next = pc + 20;
          break;
        }
        case 0x16: {
          const o = this.obj(t, a(1));
          const [sx, sy] = [a(2), a(3)];
          o.f[6] = Math.imul(o.f[6], sx);
          o.f[7] = Math.imul(o.f[7], sy);
          o.f[8] = Math.imul(o.f[8], sx);
          o.f[9] = Math.imul(o.f[9], sy);
          o.f[4] = Math.imul(o.f[4], sx);
          o.f[5] = Math.imul(o.f[5], sy);
          next = pc + 16;
          break;
        }
        case 0x17:
          this.obj(t, a(1)).f[0x1b] = a(2);
          next = pc + 12;
          break;
        case 0x18: {
          const o = this.obj(t, a(1));
          o.f[0x1b] += a(2);
          if (o.f[0x1b] < 0) o.f[0x1b] += 0x12;
          if (o.f[0x1b] > 0x11) o.f[0x1b] -= 0x12;
          next = pc + 12;
          break;
        }
        case 0x19: {
          const o = this.obj(t, a(1));
          o.f[0x3c] = pc + 8;
          o.f[0x3d] = 0;
          next = pc + 8;
          while (this.i32(next) !== SEQUENCE_END) next += 4;
          next += 4;
          break;
        }
        case 0x1a:
          this.obj(t, a(1)).f[0x3c] = 0;
          next = pc + 8;
          break;
        case 0x1b:
          this.obj(t, a(1)).f[0x12] = a(2);
          next = pc + 12;
          break;
        case 0x1c: {
          const o = this.obj(t, a(1));
          o.f[0x3f] = a(2);
          o.f[0x40] = a(3);
          o.f[0x3e] = a(4);
          next = pc + 20;
          break;
        }
        case 0x1d:
          this.obj(t, a(1)).f[0x13] = a(2);
          next = pc + 12;
          break;
        case 0x1e:
          this.obj(t, a(1)).f[0x14] |= a(2);
          next = pc + 12;
          break;
        case 0x1f:
          this.obj(t, a(1)).f[0x14] &= ~a(2);
          next = pc + 12;
          break;
        case 0x20: {
          const o = this.obj(t, a(1));
          const s = this.obj(t, a(2));
          const bits = a(3);
          [0, 1, 4, 5, 6, 7, 8, 9, 0x12, 0x13, 0x14, 0x1b].forEach((k, b) => {
            if (bits & (1 << b)) o.f[k] = s.f[k];
          });
          next = pc + 16;
          break;
        }
        case 0x21: {
          const o = this.obj(t, a(1));
          if (o.f[0x1c] > 0 || o.f[0x26] > 0 || o.f[0x34] > 0 || o.f[0x3e] > 0) {
            stop = true;
            next = pc;
          } else next = pc + 8;
          break;
        }
        case 0x22:
          t.sleep = a(1);
          stop = true;
          next = pc + 8;
          break;
        case 0x23: {
          let p = pc + 8;
          const map = p;
          while (this.i32(p) !== SEQUENCE_END) p += 4;
          this.threads.push({ pc: a(1), sleep: 0, loops: 0, loopPc: 0, flags: 0, map });
          next = p + 4;
          break;
        }
        case 0x24:
          t.flags |= 3;
          stop = true;
          next = pc;
          break;
        case 0x25:
        case 0x26:
        case 0x27:
        case 0x28: {
          const field = { 0x25: 0x1c, 0x26: 0x26, 0x27: 0x34, 0x28: 0x3e }[op]!;
          if (this.obj(t, a(1)).f[field] > 0) {
            stop = true;
            next = pc;
          } else next = pc + 8;
          break;
        }
        case 0x29: {
          let end = pc + 4;
          while (this.bytes[end] !== 0) end++;
          this.text(this.bytes.subarray(pc + 4, end));
          next = end + 1;
          break;
        }
        case 0x2a:
          if (this.timeline < this.counter) {
            stop = true;
            next = pc;
          } else {
            this.timeline -= a(1);
            next = pc + 8;
          }
          break;
        case 0x2b:
          Object.assign(this.clip, { left: a(1), top: a(2), right: a(3), bottom: a(4) });
          next = pc + 20;
          break;
        case 0x2c:
          this.clipStep = { left: a(1), top: a(2), right: a(3), bottom: a(4), n: a(5) };
          next = pc + 24;
          break;
        case 0x2d:
          t.flags |= 2;
          break;
        case 0x2e:
          next = a(1);
          break;
        case 0x2f:
          t.loops = a(1);
          t.loopPc = pc + 8;
          next = pc + 8;
          break;
        case 0x30:
          t.loops--;
          if (t.loops > 0) next = t.loopPc;
          break;
        case 0x31:
          this.music(a(1));
          next = pc + 8;
          break;
      }
      pc = next;
      if (stop) break;
    }
    t.pc = pc;
  }

  private setColors(r: number, g: number, b: number, a: number, first: number, end: number): void {
    this.flash.set(r, g, b, a, Math.max(first, 0), Math.min(end, GAME_COLORS));
  }

  private startColors(r: number, g: number, b: number, a: number, step: number, first: number, end: number): void {
    this.flash.start(r, g, b, a, step, Math.max(first, 0), Math.min(end, GAME_COLORS));
  }

  /** vmv2.exe 0x0041f82a: 글 객체. %M = 진영 0 이름, %% = %. 그림자 (1, 1) 색 10 → 본문 색 0xb, 높이 17 */
  private text(raw: Uint8Array): void {
    const s = sceneText(raw, this.player.name, this.fix);
    const o = this.alloc();
    const w = s.length * 8 + 4;
    o.pixels = new Uint8Array(w * 0x11).fill(0x10);
    drawText(o.pixels, w + 1, w, s, 10, this.glyphs);
    drawText(o.pixels, 0, w, s, 0xb, this.glyphs);
    o.f[8] = o.f[2] = o.f[4] = SCENE_W;
    o.f[9] = o.f[3] = o.f[5] = SCENE_H;
    o.f[12] = w;
    o.f[13] = 0x11;
    o.f[0x15] = w * 0x11;
  }

  /** vmv2.exe 0x0041f1fa: 자르기 속도, 객체마다 트윈·자세 차례·알파, 부모 따라가기, 화면 사각형(0x420014) */
  private update(): void {
    const c = this.clipStep;
    if (c.n > 0) {
      c.n--;
      this.clip.left += c.left;
      this.clip.top += c.top;
      this.clip.right += c.right;
      this.clip.bottom += c.bottom;
    }
    const tween = (cur: number, from: number, to: number, n: number, total: number) => to - Math.trunc(((to - from) * n) / total);
    for (const o of this.objects) {
      const f = o.f;
      if (f[0x1c] > 0) {
        f[0x1c]--;
        if (f[0x1d] < 1) {
          f[0] += f[0x1e];
          f[0x1e] += f[0x1f];
          f[1] += f[0x20];
          f[0x20] += f[0x21];
        } else {
          f[0] = tween(f[0], f[0x22], f[0x24], f[0x1c], f[0x1d]);
          f[1] = tween(f[1], f[0x23], f[0x25], f[0x1c], f[0x1d]);
        }
      }
      if (f[0x26] > 0) {
        f[0x26]--;
        if (f[0x27] < 1) {
          for (let k = 0; k < 4; k++) f[6 + k] += f[0x28 + k];
        } else {
          for (let k = 0; k < 4; k++) f[6 + k] = tween(f[6 + k], f[0x2c + k], f[0x30 + k], f[0x26], f[0x27]);
        }
      }
      if (f[0x34] > 0) {
        f[0x34]--;
        if (f[0x35] < 1) {
          f[4] += f[0x36];
          f[5] += f[0x37];
        } else {
          f[4] = tween(f[4], f[0x38], f[0x3a], f[0x34], f[0x35]);
          f[5] = tween(f[5], f[0x39], f[0x3b], f[0x34], f[0x35]);
        }
      }
      if (f[0x3c] !== 0) {
        if (this.i32(f[0x3c] + f[0x3d] * 4) === SEQUENCE_END) f[0x3d] = 0;
        f[0x1b] += this.i32(f[0x3c] + f[0x3d] * 4);
        f[0x3d]++;
        if (f[0x1b] < 0) f[0x1b] += 0x12;
        if (f[0x1b] > 0x11) f[0x1b] -= 0x12;
      }
      if (f[0x3e] > 0) {
        f[0x3e]--;
        f[0x3f] = Math.min(Math.max(f[0x3f] + f[0x40], 0), 0x100);
        f[0x12] = this.patterns[f[0x3f] >> 4];
      }
    }
    for (const o of this.objects) {
      const f = o.f;
      if (f[0x17] === 0) continue;
      const p = this.objects[f[0x17] - 1].f;
      f[0] = p[0] + f[0x18];
      f[1] = p[1] + f[0x19];
      f[4] = p[4];
      f[5] = p[5];
      f.set(p.subarray(6, 10), 6);
      f[0x12] = p[0x12];
      f[0x13] = p[0x13];
      f[0x14] = p[0x14];
    }
    for (const o of this.objects) this.area(o);
  }

  /** vmv2.exe 0x00420014: 화면 사각형(+0x38~+0x44). 안 보이면 0 */
  private area(o: SceneObject): void {
    const f = o.f;
    if (!(f[0x14] & 1) || f[0x12] === -1 || f[4] < 1 || f[5] < 1) {
      f.fill(0, 0xe, 0x12);
      return;
    }
    const scaled = (v: number, num: number, den: number) => Math.trunc((v * num - 1 + den) / den);
    let l = Math.max(f[6], scaled(f[10], f[4], f[2]));
    let t = Math.max(f[7], scaled(f[11], f[5], f[3]));
    let r = Math.min(f[8], scaled(f[12], f[4], f[2]));
    let b = Math.min(f[9], scaled(f[13], f[5], f[3]));
    l += f[0];
    t += f[1];
    r += f[0];
    b += f[1];
    l = Math.max(l, this.clip.left, 0);
    t = Math.max(t, this.clip.top, 0);
    r = Math.min(r, this.clip.right, SCENE_W);
    b = Math.min(b, this.clip.bottom, SCENE_H);
    if (r - l <= 0 || b - t <= 0) f.fill(0, 0xe, 0x12);
    else f.set([l, t, r, b], 0xe);
  }
}
