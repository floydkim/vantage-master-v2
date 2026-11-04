// Master making 창(CMakeMasterWnd, vmv2.exe 0x00426d90): 시나리오·Expert의 첫 화면. 질문 넷의 답으로 마스터를 정하고 이름을 받는다.
// 창 객체 0x4ec바이트의 칸을 그대로 옮긴다. 48ms 콜백 0x426ff9가 페이드가 끝나면 다음 스텝(0x427166), 두 틱마다 프레임(0x427882)
// 그림은 DIB 608 × 448(0x428ca4), 팔레트는 창 팔레트 0x4800e0(타이틀이 남긴 색 위에 일부를 읽음)과 번쩍임(0x41b166·0x41b284·0x41b421)
import { u32 } from '../battle/attack.ts';
import { msvcRand } from '../battle/continueData.ts';
import { drawText, readGlyphs } from '../battle/font.ts';
import { commonPaletteA, commonPaletteB, dibColors, Flash, GAME_COLORS } from '../battle/palette.ts';
import { CHIP, CHIP_W, type ReadAny, TRANSPARENT } from '../battle/sheet.ts';
import { UNIT_GRAPHICS } from '../battle/sprites.ts';
import { formatC } from '../battle/statusWindow.ts';
import type { ExeImage } from '../../formats/exeImage.ts';
import { readMasterNames } from '../../formats/masterTable.ts';
import { type ScenarioData, type ScenarioMode, scenarioPlayer } from '../../engine/scenario.ts';
import type { SideRecord } from '../../engine/state.ts';

const ANSWER_COUNTS = 0x465e38; // i32 × 8: 질문마다 답 수
const ANSWER_STARTS = 0x465e18; // i32 × 8: 질문의 첫 답 번호
const ANSWER_ITEMS = 0x465eb0; // i32 × 22: 답 → 아이템(카드)
const ITEM_SCORES = 0x465f08; // i32 × 11: 아이템 → 점수
const SCORE_MASTERS = 0x465f34; // i32 × 54: 점수 합 → 마스터
const STARS_MAX = 0x30;
export const MAKE_W = 0x260; // 608
export const MAKE_H = 0x1c0; // 448
const BOARD_W = 0x200;
const PANEL_W = 0x59;
const PANEL_H = 0x34;
const STAR = 0x30; // 별가루 48 × 48, 종류 4 × 프레임 8(DATA00 0x25~0x28)
const STAR_TINT = 0x4661f0; // 0x427ca2: [단계 × 4 + 별 픽셀]. 단계는 바탕 − 0x8d(2 이하) 또는 (바탕 − 0x90) / 32라 음수도 있다
const STAR_TINT_BEFORE = 0x240;
const BG_DECAY = 0x466110; // 0x4279ea: 프레임마다 바탕 픽셀을 바꿈
const FADE_MASKS = 0x473cec; // 0x43fb44: [단계 − 1] 칩 줄 12개의 u32, 켜진 비트의 픽셀은 건너뜀
const MESSAGES = 0x465dd8;
const QUESTIONS = 0x465df8;
const ANSWERS = 0x465e58;
const CARD_TEXTS = 0x46600c;
const RESULTS = 0x466038;
const DESCRIPTIONS = 0x4660a4;
const ITEM_TABLE = 0x468d60; // 16바이트 × 30: +8 이름, +0xc 설명
const ACQUIRED = 0x468b74; // "%s is acquired."
const SHADOW = 10;
const TEXT = 0xb;
const HOVER_TEXT = 0xf;
const LINE = 0x14; // 0x423bc9: 줄바꿈마다 20줄 아래
const LAYOUT_POSES = 0x12; // 배치표 묶음 하나 = 자세 18 × 0x40바이트
const SHEET_PAGES = 0x100;
// 0x428542: 마스터 → 이름이 그 표준 이름이면 바뀌는 숨은 마스터
const SPECIAL: Readonly<Record<number, number>> = { 0: 0x14, 2: 0x13, 3: 0x18, 7: 0x15, 9: 0x16, 10: 0x17, 0xc: 0x12, 0xe: 0x19, 0x11: 0x1a };

export interface MakeMasterData {
  readonly counts: readonly number[];
  readonly starts: readonly number[];
  readonly items: readonly number[];
  readonly scores: readonly number[];
  readonly masters: readonly number[];
  /** 마스터 기본 이름(0x42d2bc) */
  readonly names: readonly string[];
  readonly scenario: Pick<ScenarioData, 'masters' | 'stats'>;
  readonly exe: ExeImage;
  readonly read: ReadAny;
  readonly stars: Uint8Array;
  /** 0x2a(608 × 448) + 0x20 */
  readonly background: Uint8Array;
  /** 0x2b 결과 판 89 × 52 */
  readonly panel: Uint8Array;
  /** 0x2c(512 × 448)와 그 0x10 아닌 픽셀 + 0x2b */
  readonly boards: readonly [Uint8Array, Uint8Array];
  readonly decay: Uint8Array;
  readonly tint: Uint8Array;
  readonly masks: Uint32Array;
  readonly glyphs: Uint8Array;
  readonly text: {
    readonly messages: readonly string[];
    readonly questions: readonly string[];
    readonly answers: readonly string[];
    readonly cards: readonly string[];
    readonly results: readonly string[];
    readonly descriptions: readonly string[];
    readonly itemNames: readonly string[];
    readonly itemTexts: readonly string[];
    readonly acquired: string;
  };
}

export function readMakeMasterData(exe: ExeImage, read: ReadAny, scenario: Pick<ScenarioData, 'masters' | 'stats'>): MakeMasterData {
  const i32s = (at: number, n: number) => {
    const v = new DataView(exe.read(at, n * 4).buffer);
    return Array.from({ length: n }, (_, k) => v.getInt32(k * 4, true));
  };
  const strings = (at: number, n: number, stride = 4) => Array.from({ length: n }, (_, k) => exe.cString(u32(exe, at + k * stride)));
  const stars = new Uint8Array(4 * 8 * STAR * STAR);
  for (let k = 0; k < 4; k++) stars.set(read(0x25 + k).subarray(0, 8 * STAR * STAR), k * 8 * STAR * STAR);
  const board = read(0x2c).slice(0, BOARD_W * MAKE_H);
  const masks = exe.read(FADE_MASKS, 8 * 0x30);
  return {
    counts: i32s(ANSWER_COUNTS, 8),
    starts: i32s(ANSWER_STARTS, 8),
    items: i32s(ANSWER_ITEMS, 22),
    scores: i32s(ITEM_SCORES, 11),
    masters: i32s(SCORE_MASTERS, 54),
    names: readMasterNames(exe),
    scenario,
    exe,
    read,
    stars,
    background: read(0x2a)
      .slice(0, MAKE_W * MAKE_H)
      .map((b) => (b + 0x20) & 0xff),
    panel: read(0x2b).slice(0, PANEL_W * PANEL_H),
    boards: [board, board.map((b) => (b !== TRANSPARENT ? (b + 0x2b) & 0xff : b))],
    decay: exe.read(BG_DECAY, 0x100),
    tint: exe.read(STAR_TINT - STAR_TINT_BEFORE, STAR_TINT_BEFORE + 0x110),
    masks: new Uint32Array(masks.buffer.slice(masks.byteOffset, masks.byteOffset + masks.byteLength)),
    glyphs: readGlyphs(read),
    text: {
      messages: strings(MESSAGES, 8),
      questions: strings(QUESTIONS, 8),
      answers: strings(ANSWERS, 22),
      cards: strings(CARD_TEXTS, 11),
      results: strings(RESULTS, 27),
      descriptions: strings(DESCRIPTIONS, 27),
      itemNames: strings(ITEM_TABLE + 8, 30, 0x10),
      itemTexts: strings(ITEM_TABLE + 0xc, 30, 0x10),
      acquired: exe.cString(ACQUIRED),
    },
  };
}

/** 타이틀 DIB 색 표(10~245번, 0x439d23)를 창 팔레트 0x4800e0(PALETTEENTRY 236)으로: Master making은 그 위에 일부만 읽는다 */
export function titleBase(colors: Uint8Array): Uint8Array {
  const out = new Uint8Array(GAME_COLORS * 4);
  for (let i = 0; i < GAME_COLORS; i++) out.set([colors[(i + 10) * 4 + 2], colors[(i + 10) * 4 + 1], colors[(i + 10) * 4]], i * 4);
  return out;
}

/** 별가루 한 알(창 +0x3c부터 0x18바이트 × 48): 종류 0~3, 프레임 0~7, x, y, 걸음 */
interface Star {
  kind: number;
  frame: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
}

export class MasterMaking {
  /** +0x1c: 스텝(0x427166). 시나리오 −1, Expert 0x31에서 시작 */
  step: number;
  /** +0x24: 아래 글(0x465dd8), −1 없음 */
  message = -1;
  /** +0x28: 질문 0~7 */
  question = 0;
  /** +0x4bc·+0x4c0: 카드 연출 단계(0x427f04)와 그 안의 프레임 */
  phase = -1;
  phaseFrame = 0;
  /** +0x4c4·+0x4c8·+0x4cc: 카드 그림 번호, 사라짐 단계, 카드 글 */
  card = -1;
  cardFade = 0;
  cardText = 0;
  /** +0x4d8: 마우스 위 답(입력 모드 2면 0) */
  hover = -1;
  /** +0x4dc·+0x4e0: 고른 아이템, 점수 합 */
  item = 0;
  score = 0;
  /** +0x4e4: 프레임 0~7 */
  frame = 0;
  /** +0x4e8: 입력 모드 0 없음, 1 답 고르기, 2 아무 데나 누르기 */
  input = 0;
  /** +0x20: 바탕 판(0x2c 두 벌 중 1·2, 0이면 없음) */
  board = 0;
  /** +0x2c·+0x30·+0x34: 결과 판, 마스터 설명, 얻은 아이템(−1 없음) */
  result = 0;
  description = 0;
  acquired = -1;
  readonly stars: Star[] = [];
  /** C 런타임 난수 상태(0x475da0) */
  seed: number;
  readonly flash = new Flash();
  /** 이름 대화 상자(0x42967b)를 띄울 처음 글자. 받으면 null */
  prompt: string | null = null;
  /** 진영 0 레코드(0x42842d부터) */
  player: SideRecord | null = null;
  /** 창이 닫혔다(0x426f81). 월드로 간다(0x45102d) */
  closed = false;
  /** 틀 BGM(0x443770) */
  readonly bgm: number[] = [];
  /** DIB 608 × 448(창 +0x10, 0x483ec8) */
  readonly image = new Uint8Array(MAKE_W * MAKE_H);
  /** DIB 색 표(RGBQUAD 256, 10~245번) */
  colors: Uint8Array = new Uint8Array(256 * 4);
  private mouse: readonly [number, number] = [0, 0]; // +0x4d0·+0x4d4
  private awaitFade = false; // 0x483ec4
  private half = 0; // 0x483ebc
  private readonly data: MakeMasterData;
  private readonly mode: ScenarioMode;
  private readonly base: Uint8Array; // 0x4800e0(PALETTEENTRY 236)
  private readonly background: Uint8Array; // 창 +0xc
  private readonly chips = new Uint8Array(SHEET_PAGES * 16 * CHIP); // 칩 기준 0x1000(0x43f8e4)부터
  private readonly layouts = new Uint16Array(4 * LAYOUT_POSES * 32); // *0x48355c 묶음 0~3

  /** base: 창 팔레트 0x4800e0의 지금 색(타이틀이 남긴 색, PALETTEENTRY 236) */
  constructor(data: MakeMasterData, mode: ScenarioMode, seed: number, base: Uint8Array) {
    this.data = data;
    this.mode = mode;
    this.seed = seed;
    this.base = base.slice(0, GAME_COLORS * 4);
    this.background = data.background.slice();
    this.step = mode !== 2 ? -1 : 0x31; // 0x427060
    this.next(); // 0x426d90
  }

  private rand(): number {
    const r = msvcRand(this.seed);
    this.seed = r.state;
    return r.value;
  }

  /** vmv2.exe 0x00426ff9: 48ms 콜백 */
  tick(): void {
    if (this.closed) return;
    if (!this.flash.tick()) {
      if (this.awaitFade) {
        this.awaitFade = false;
        this.next();
      }
    } else {
      this.realize(); // 0x428f81
    }
    if (++this.half > 1) {
      this.half = 0;
      if (!this.closed) this.frameTick();
    }
  }

  /** vmv2.exe 0x004292be: 마우스 위 */
  move(x: number, y: number): void {
    this.mouse = [x, y];
    this.hover = this.hit(x, y);
  }

  /**
   * UI 전용: 지금 상태로 그림을 다시 만든다(별·카드 같은 애니메이션은 진행하지 않음). 원작은 마우스 위가 바뀌어도 다음 프레임(두 틱 = 96ms,
   * 0x427882)에 그려 선택지 강조가 늦게 보인다. 리메이크는 강조가 바뀌면 바로 다시 그린다(의도한 차이, 틱마다 그림은 원작 그대로)
   */
  repaint(): void {
    this.draw();
  }

  /** vmv2.exe 0x0042930f: 누르기. 효과음 번호들을 돌려준다 */
  click(x: number, y: number): number[] {
    this.move(x, y);
    if (this.hover === -1) return [];
    if (this.input === 1) {
      this.answer();
      return [1];
    }
    if (this.input === 2) {
      this.next();
      return [1];
    }
    return [];
  }

  /** vmv2.exe 0x0042959e·0x0042940e: 이름 대화 상자 OK. 1~16바이트가 아니면 효과음 3이고 상자에 남는다 */
  name(text: string): boolean {
    if (text.length === 0 || text.length > 0x10 || this.prompt === null || !this.player) return false;
    this.prompt = null;
    this.player = { ...this.player, name: text };
    this.next();
    return true;
  }

  /** vmv2.exe 0x0042937e: 답 칸(x 220~395, y 300 + 20k ~ 315 + 20k) */
  private hit(x: number, y: number): number {
    if (this.input === 1) {
      for (let k = 0; k < this.data.counts[this.question]; k++) if (x > 0xdb && x < 0x18c && y >= k * 0x14 + 300 && y < k * 0x14 + 0x13c) return k;
    } else if (this.input === 2) return 0;
    return -1;
  }

  /** vmv2.exe 0x00427e4f: 답의 아이템과 점수, 카드 연출 시작 */
  private answer(): void {
    this.item = this.data.items[this.data.starts[this.question] + this.hover];
    this.score += this.data.scores[this.item];
    this.input = 0;
    this.phase = 0;
    this.phaseFrame = 0;
    this.page(0x32 + this.item, 0x90);
    this.layout(0x40 + this.item, 3);
  }

  /** vmv2.exe 0x00427882: 두 틱마다 */
  private frameTick(): void {
    this.frame = this.frame + 1 > 7 ? 0 : this.frame + 1;
    this.moveStars();
    this.phaseTick();
    this.draw();
  }

  /** vmv2.exe 0x004279ea: 별가루. 1/2로 새 알(48개까지), 움직여 화면 밖이면 뺀다 */
  private moveStars(): void {
    for (let i = 0; i < this.background.length; i++) this.background[i] = this.data.decay[this.background[i]];
    if ((this.rand() & 0xff) < 0x80 && this.stars.length < STARS_MAX) {
      const kind = this.rand() & 3;
      const frame = this.rand() & 7;
      const x = this.rand() % 0x420;
      const dx = Math.trunc(((this.rand() % 0xc) * 2 + 8) / (kind + 2));
      const dy = Math.trunc(((this.rand() % 0xc) * 2 + 8) / (kind + 2));
      this.stars.push({ kind, frame, x, y: -0x30, dx, dy });
    }
    for (let k = 0; k < this.stars.length; ) {
      const s = this.stars[k];
      s.x -= s.dx;
      s.y += s.dy;
      if (s.y < 0x1c0 && s.x > -0x31) {
        s.frame = (s.frame + 1) & 7;
        k++;
      } else this.stars.splice(k, 1);
    }
    for (let k = this.stars.length - 1; k >= 0; k--) this.drawStar(this.stars[k]);
  }

  /** vmv2.exe 0x00427f04: 카드 연출 단계 */
  private phaseTick(): void {
    switch (this.phase) {
      case 0:
        if (++this.phaseFrame > 3) {
          this.phaseFrame = 0;
          this.phase++;
        }
        break;
      case 1:
        this.card++;
        if (++this.phaseFrame > 0x23) {
          this.cardText = 1;
          this.phaseFrame = 0;
          this.phase++;
          this.input = 2;
        }
        break;
      case 3:
        this.cardFade++;
        if (++this.phaseFrame > 7) {
          this.cardText = 0;
          this.card = -1;
          this.cardFade = 0;
          this.phaseFrame = 0;
          this.phase++;
        }
        break;
      case 4:
        if (++this.phaseFrame > 7) {
          this.phaseFrame = 0;
          this.phase = -1;
          this.next();
        }
    }
  }

  /** vmv2.exe 0x00427166: 다음 스텝(시나리오 0~0x19, Expert 0x32~0x45) */
  private next(): void {
    switch (++this.step) {
      case 0:
      case 0x32: // 0x42754c: 그림을 읽고 검정에서 밝아짐
        this.startColors();
        this.flash.set(0, 0, 0, 0x100, 0, 0xec);
        this.flash.start(0, 0, 0, 0, 0x10, 0, 0xec);
        this.awaitFade = true;
        this.realize();
        this.board = 2;
        this.frame = 0;
        this.half = 0;
        this.tick();
        this.bgm.push(6);
        break;
      case 1:
        this.input = 2;
        this.message = 0;
        break;
      case 2:
      case 0x34:
        this.message = 1;
        break;
      case 3:
      case 0x35: // 0x42792c: 질문 그림, 바탕을 어둡게
        this.input = 0;
        this.message = -1;
        this.base.set(this.data.read(0x2e).subarray(0, 43 * 4), 7 * 4);
        this.base.set([0xff, 0, 0], 5 * 4);
        this.flash.set(0, 0, 0, 0, 0, 0xec);
        this.flash.start(0, 0, 0, 0xaa, 0x15, 0x32, 0x5d);
        this.awaitFade = true;
        this.realize();
        this.page(0x2f, 0);
        this.page(0x30, 0x30);
        this.page(0x31, 0x60);
        [0x3d, 0x3e, 0x3f].forEach((id, set) => this.layout(id, set));
        break;
      case 4:
      case 6:
      case 8:
      case 10:
      case 0x36:
      case 0x38:
      case 0x3a:
      case 0x3c:
        this.question = ((this.step - 4) % 0x32) + (this.rand() & 1);
        this.input = 1;
        this.hover = this.hit(...this.mouse);
        break;
      case 5:
      case 7:
      case 9:
      case 0xb:
      case 0x37:
      case 0x39:
      case 0x3b:
      case 0x3d:
        this.input = 0;
        this.phase++;
        break;
      case 0xc:
      case 0x3e: // 0x42842d: 결과. 마스터를 정하고 이름 상자
        this.base.copyWithin(7 * 4, 0x32 * 4, 0x5d * 4);
        this.flash.set(0, 0, 0, 0xaa, 7, 0x32);
        this.realize();
        this.board = 1;
        this.draw();
        this.player = scenarioPlayer(this.data.scenario, '', this.data.masters[this.score], this.mode);
        this.unitGraphic(this.player.master);
        this.layout(5, 0);
        this.result = 1;
        commonPaletteB(this.base, this.data.read);
        this.flash.set(0, 0, 0, 0, 0x32, 0x76);
        this.realize();
        this.prompt = this.data.names[this.player.master];
        break;
      case 0xd:
      case 0x3f:
        this.special();
        this.input = 2;
        break;
      case 0xe:
      case 0x40:
        this.input = 0;
        this.result = 0;
        this.brighten();
        break;
      case 0xf:
      case 0x41:
        this.input = 2;
        this.message = 2;
        break;
      case 0x10:
      case 0x42:
        this.message = -1;
        this.description = 1;
        break;
      case 0x11:
        this.description = 0;
        this.message = 3;
        break;
      case 0x12: // 0x4278fe
        this.input = 0;
        this.message = -1;
        this.flash.start(0, 0, 0, 0xaa, 0x15, 7, 0x32);
        this.awaitFade = true;
        break;
      case 0x13:
        this.input = 2;
        this.page(0x17, 0x12);
        this.acquired = 0;
        break;
      case 0x14:
        this.acquired = 6;
        break;
      case 0x15:
        this.acquired = 0xc;
        break;
      case 0x16:
        this.acquired = 0x15;
        break;
      case 0x17:
        this.acquired = -1;
        this.input = 0;
        this.brighten();
        break;
      case 0x18:
        this.input = 2;
        this.message = 4;
        break;
      case 0x19:
      case 0x45: // 0x426f81 → 0x45102d
        this.input = 0;
        this.message = -1;
        this.closed = true;
        break;
      case 0x33:
        this.input = 2;
        this.message = 5;
        break;
      case 0x43:
        this.description = 0;
        this.message = 6;
        break;
      case 0x44:
        this.message = 7;
    }
  }

  /** vmv2.exe 0x004278d3 */
  private brighten(): void {
    this.flash.start(0, 0, 0, 0, 0x15, 7, 0x32);
    this.awaitFade = true;
  }

  /** vmv2.exe 0x00428542: 이름이 숨은 마스터의 표준 이름이면 그 마스터로(이름도 표준 이름) */
  private special(): void {
    const p = this.player!;
    const to = SPECIAL[p.master];
    if (to === undefined || p.name !== this.data.names[to]) return;
    this.player = scenarioPlayer(this.data.scenario, this.data.names[to], to, this.mode);
    this.unitGraphic(to);
  }

  /** vmv2.exe 0x0042754c 팔레트: 공통 1(0x422c32), 0x29 → 0x7f~0x85, 0x2d → 0x32~0x5c, 0x86~0xe5 = 0x7f~0x82와 0x83~0x85를 8단계로 섞음 */
  private startColors(): void {
    const p = this.base;
    commonPaletteA(p, this.data.read);
    p.set(this.data.read(0x29).subarray(0, 7 * 4), 0x7f * 4);
    p.set(this.data.read(0x2d).subarray(0, 43 * 4), 0x32 * 4);
    for (let q = 0; q < 3; q++) {
      for (let c = 0; c < 8; c++) {
        for (let k = 0; k < 4; k++) {
          const at = (k + q * 0x20 + 0x86 + c * 4) * 4;
          for (let ch = 0; ch < 3; ch++) p[at + ch] = (p[(0x7f + k) * 4 + ch] * (8 - c) + p[(0x83 + q) * 4 + ch] * c) >> 3;
        }
      }
    }
  }

  /**
   * vmv2.exe 0x00428f81 → 0x0041b08f: 0x482a0c를 DIB 색 표 10~245번에. 원작은 0x41b166·0x41b421 때의 base로 섞어 두지만,
   * 다시 섞지 않은 채 base가 바뀌는 칸은 6번(0x42842d의 0x422ca9 검정, 타이틀도 검정)뿐이라 지금 base로 섞어도 같다
   */
  private realize(): void {
    this.colors = dibColors(this.flash.apply(this.base));
  }

  /** vmv2.exe 0x004226eb: 그림 리소스를 칩 페이지에 */
  private page(id: number, page: number): void {
    const b = this.data.read(id);
    this.chips.set(b.subarray(0, Math.min(b.length, this.chips.length - page * 16 * CHIP)), page * 16 * CHIP);
  }

  /** vmv2.exe 0x00422a11: 배치표 리소스를 묶음에 */
  private layout(id: number, set: number): void {
    const b = this.data.read(id);
    this.layouts.set(new Uint16Array(b.buffer.slice(b.byteOffset, b.byteOffset + LAYOUT_POSES * 0x40)), set * LAYOUT_POSES * 32);
  }

  /** vmv2.exe 0x004227d5(마스터, 진영 0, 페이지 0x10) */
  private unitGraphic(master: number): void {
    this.page(u32(this.data.exe, UNIT_GRAPHICS + master * 2 * 4), 0x10);
  }

  /** vmv2.exe 0x00428ca4: 바탕, 판(0x4280e1), 글, 질문(0x4281b1), 카드(0x4282ea), 결과(0x42876c), 설명, 얻은 아이템 */
  private draw(): void {
    const out = this.image;
    const t = this.data.text;
    out.set(this.background);
    if (this.board > 0 && this.board < 3) {
      const src = this.data.boards[this.board - 1];
      for (let r = 0; r < MAKE_H; r++) {
        for (let c = 0; c < BOARD_W; c++) {
          const v = src[r * BOARD_W + c];
          if (v !== TRANSPARENT) out[r * MAKE_W + c] = v;
        }
      }
    }
    if (this.message !== -1) this.text(t.messages[this.message], 0x992c);
    if (this.input === 1) {
      this.text(t.questions[this.question], 0xab70);
      for (let k = 0; k < this.data.counts[this.question]; k++) {
        this.text(t.answers[this.data.starts[this.question] + k], 0xdc + (k * 0x14 + 300) * MAKE_W, this.hover === k ? HOVER_TEXT : TEXT);
      }
    }
    if (this.card !== -1) {
      const set = Math.trunc(this.card / 9);
      const pose = (this.card % 9) * 2;
      this.sprite(0xe500, set * 0x30, set, pose, this.cardFade);
      this.sprite(0x1c900, set * 0x30, set, pose + 1, this.cardFade);
    }
    if (this.cardText) this.text(t.cards[this.item], 0x2f8a0);
    if (this.result) this.drawResult();
    if (this.description) this.text(t.descriptions[this.player!.master], 0x992c);
    if (this.acquired !== -1) {
      const k = (this.acquired >> 3) * 0x60 + 0x120 + (this.acquired & 7) * 2; // 0x429bfa
      for (let r = 0; r < 6; r++) {
        this.chip(0x1abe0 + r * 0xc * MAKE_W, k + r * 0x10);
        this.chip(0x1abe0 + 0x18 + r * 0xc * MAKE_W, k + 1 + r * 0x10);
      }
      this.text(formatC(t.acquired, t.itemNames[this.acquired]), 0x1ac20);
      this.text(t.itemTexts[this.acquired], 0x1dba0);
    }
  }

  /** vmv2.exe 0x0042876c: 결과 판, 마스터 그림 ×2(프레임 / 2, 3이면 1), 이름, 레벨·능력치, 설명 */
  private drawResult(): void {
    const out = this.image;
    const p = this.player!;
    for (let r = 0; r < PANEL_H; r++) {
      for (let c = 0; c < PANEL_W; c++) {
        const v = this.data.panel[r * PANEL_W + c];
        if (v !== TRANSPARENT) out[0xeea6 + r * MAKE_W + c] = v;
      }
    }
    const half = this.frame >> 1;
    this.double(-0x42c, 0x10, 0, (half === 3 ? 1 : half) + 0xf);
    this.text(p.name, 0xbf20);
    const num = (v: number, width: number, at: number) => this.text(formatC('%*d', width, v), at);
    num(p.level + 1, 2, 0xeeb6);
    num(p.maxMp, 3, 0xeede);
    num(p.attack, 2, 0x11976);
    num(p.defense, 2, 0x14436);
    num(p.magic, 2, 0x1199a);
    num(p.magicDefense, 2, 0x1445a);
    num(p.speed, 2, 0x119be);
    num(p.movement, 2, 0x1447e);
    this.text(this.data.text.results[p.master], 0x23aa0);
  }

  /** vmv2.exe 0x00423bc9 두 번: 그림자 (+1, +1) 색 10, 본문. 줄바꿈마다 20줄 아래 */
  private text(s: string, at: number, color = TEXT): void {
    s.split('\n').forEach((line, k) => {
      drawText(this.image, at + MAKE_W + 1 + k * LINE * MAKE_W, MAKE_W, line, SHADOW, this.data.glyphs);
      drawText(this.image, at + k * LINE * MAKE_W, MAKE_W, line, color, this.data.glyphs);
    });
  }

  /** vmv2.exe 0x0043f9c3: 칩 하나(0x10 투명) */
  private chip(at: number, k: number): void {
    for (let r = 0; r < 12; r++) {
      for (let c = 0; c < CHIP_W; c++) {
        const v = this.chips[k * CHIP + r * CHIP_W + c];
        if (v !== TRANSPARENT) this.image[at + r * MAKE_W + c] = v;
      }
    }
  }

  /** vmv2.exe 0x0043fb44: 배치표 자세(4열 × 8줄 칩, 아래 줄부터). fade 1~8이면 그 단계 비트의 픽셀은 건너뜀 */
  private sprite(at: number, page: number, set: number, pose: number, fade: number): void {
    const l = (set * LAYOUT_POSES + pose) * 32;
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 8; r++) {
        const v = this.layouts[l + c * 8 + r];
        if (v === 0x7ff) continue;
        const src = (page * 16 + v) * CHIP;
        const dst = at + (7 - r) * 0xc * MAKE_W + c * CHIP_W;
        for (let y = 0; y < 12; y++) {
          const mask = fade ? this.data.masks[(fade - 1) * 12 + y] : 0;
          for (let x = 0; x < CHIP_W; x++) {
            const p = this.chips[src + y * CHIP_W + x];
            if (p !== TRANSPARENT && !((mask >>> x) & 1)) this.image[dst + y * MAKE_W + x] = p;
          }
        }
      }
    }
  }

  /** vmv2.exe 0x0043fdb8: 배치표 자세를 ×2로(픽셀마다 2 × 2). DIB 밖은 쓰지 않는다 */
  private double(at: number, page: number, set: number, pose: number): void {
    const l = (set * LAYOUT_POSES + pose) * 32;
    const put = (o: number, p: number) => {
      if (o >= 0 && o < this.image.length) this.image[o] = p;
    };
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 8; r++) {
        const v = this.layouts[l + c * 8 + r];
        if (v === 0x7ff) continue;
        const src = (page * 16 + v) * CHIP;
        const dst = at + (7 - r) * 0x18 * MAKE_W + c * 0x30;
        for (let y = 0; y < 12; y++) {
          for (let x = 0; x < CHIP_W; x++) {
            const p = this.chips[src + y * CHIP_W + x];
            if (p === TRANSPARENT) continue;
            const o = dst + y * 2 * MAKE_W + x * 2;
            put(o, p);
            put(o + 1, p);
            put(o + MAKE_W, p);
            put(o + MAKE_W + 1, p);
          }
        }
      }
    }
  }

  /** vmv2.exe 0x00427ca2: 별가루 한 알을 바탕에(화면 밖은 자름). 바탕 단계마다 색을 바꾼다 */
  private drawStar(s: Star): void {
    const { x, y } = s;
    if (!(x > -STAR && y > -STAR && x < MAKE_W && y < MAKE_H)) return;
    let w = STAR;
    let h = STAR;
    if (x < 0) w = x + STAR;
    if (x > MAKE_W - STAR) w -= x - (MAKE_W - STAR);
    if (y < 0) h = y + STAR;
    if (y > MAKE_H - STAR) h -= y - (MAKE_H - STAR);
    const sx = Math.max(-x, 0);
    const sy = Math.max(-y, 0);
    const src = (s.frame + s.kind * 8) * STAR * STAR;
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        const p = this.data.stars[src + (sy + r) * STAR + sx + c];
        if (p === TRANSPARENT) continue;
        const o = (Math.max(y, 0) + r) * MAKE_W + Math.max(x, 0) + c;
        const d = this.background[o];
        let k = d - 0x8d;
        if (k > 2) k = Math.trunc((d - 0x90) / 32);
        this.background[o] = this.data.tint[STAR_TINT_BEFORE + k * 4 + p];
      }
    }
  }

}
