// 공격·마법 연출 객체: 스크립트 해석기(0x414939), 공격(0x413852), 마법(0x413b12·0x413b45·0x413e7c), 타격의 보이는 부분(0x40354b)과 빗나감 표시(0x413ddb),
// 반응(0x41452e), 데미지 숫자(0x412c14), 쓰러짐(0x4160e3)과 소멸(0x41461a·0x416129). 규칙은 엔진이 이미 적용했고, 타격마다 엔진 기록(StrikeRecord)을
// 차례로 소비해 HP·쓰러짐·특수를 보인다.
import type { Cell } from '../../engine/command.ts';
import { ringCells } from '../../engine/rules/action.ts';
import { inArea, straightSight } from '../../engine/rules/range.ts';
import { GRID, partByte } from '../../engine/rules/terrain.ts';
import { type EngineData, facing } from '../../engine/turn.ts';
import type { StrikeRecord } from '../../engine/turn.ts';
import { type GameState, MASTERS, unitOf } from '../../engine/state.ts';
import type { Action } from '../../formats/actionTable.ts';
import { scriptLength } from '../../formats/effectScript.ts';
import { fromWorld, type MutableSprite, nudge, place, polar, toWorld } from './place.ts';
import { loadLayoutSet, placePage, unitGraphic, unitLook } from './sprites.ts';
import type { Effect, Stage } from './stage.ts';

const ATTACK_GRAPHICS = 0x46089c; // [그림 번호 × 2 + 진영] → 공격 그림 리소스(0x422850, 페이지 0x2c6)
const ATTACK_LAYOUTS = 0x460a34; // → 배치 묶음 6(0x422a45)
const SCRIPTS = 0x460bcc; // [그림 번호] → 연출 스크립트(0x422bde)
const VANISH_GRAPHICS = 0x461eac; // [마스터 번호 × 2 + 진영] → 마스터 소멸 그림(0x4229e0)
const VANISH_LAYOUTS = 0x461f84; // → 마스터 소멸 배치(0x422b79)
const REACTIONS = [0x45fb60, 0x45fc10, 0x45fcb0]; // 반응 스크립트 0x45fcf0[종류]
const NATIAL_FADE = 0x45fcfc; // 네이티얼 소멸 스크립트(0x41461a, 가림 무늬 1~7)
const UI_PAGE = 0x2c6;
const MISSILE_GRAPHICS = 0x46163c; // [그림 번호] → 진영마다 각 12칸(30°) 투사체 그림(0x42292c, 페이지 0x2f3)
const MISSILE_LAYOUTS = 0x461bf4; // → 투사체 배치(0x422ae3, 묶음 8)
const MISSILE_PAGE = 0x2f3;
const MISSILE_SET = 8;
const CAST_GRAPHICS = 0x460c98; // [그림 번호 × 2 + 진영] → 시전 그림(0x422881, 페이지 0x2c6)
const CAST_LAYOUTS = 0x460e30; // → 시전 배치(0x422a67, 묶음 6)
const CAST_SCRIPTS = 0x460fc8; // [그림 번호] → 시전 스크립트(0x422bfa)
const EFFECT_GRAPHICS = 0x461094; // [행동 × 2 + 진영] → 대상 칸 효과 그림(0x4228b2, 페이지 0x2d5)
const EFFECT_LAYOUTS = 0x4611a4; // → 효과 배치(0x422a89, 묶음 7)
const ACTION_SCRIPTS = 0x4612b4; // [행동] → 효과 스크립트(0x422c16)
const MAGIC_MISSILE_GRAPHICS = 0x461828; // [그림 번호] → 진영마다 각 12칸 마법 투사체 그림(0x422986)
const MAGIC_MISSILE_LAYOUTS = 0x461de0; // (0x422b2e)
const CHARGE_GRAPHIC = 0x30094; // 연출 번호 2 시전의 모으기 그림(0x414397, 페이지 0x2f3)
const CHARGE_LAYOUT = 0x30095; // (묶음 8)
const EFFECT_PAGE = 0x2d5;
const EFFECT_SET = 7;
const SPARK_SCRIPT = 0x45f94c; // 빗나감 표시(0x413ddb)
const TRAIL_SCRIPT = 0x45f97c; // 마법 투사체 자취(0x413fde)
const CHARGE_SOUNDS = 0x45f8e0; // [유닛 +2 종류] → 연출 번호 2 효과음(0x413b45, 칸 3)
const DAMAGE = 0; // 행동 종류(+0x06)
const HEAL = 1;
const STATUS = 2;
const CURE = 3;
const END = 0x31;
const s8 = (v: number) => (v << 24) >> 24;

export const u32 = (exe: Stage['art']['exe'], at: number) => new DataView(exe.read(at, 4).buffer).getUint32(0, true);
const words = (b: Uint8Array) => new Int32Array(b.buffer.slice(b.byteOffset, b.byteOffset + (b.byteLength & ~3)));

/** exe 안 스크립트(0x31까지) */
export function exeScript(stage: Stage, at: number): Int32Array {
  const w = words(stage.art.exe.read(at, 0x400));
  return w.subarray(0, scriptLength(w));
}

// vmv2.exe 0x0041798c: 대상 칸 쪽으로 돈다(엔진 facing과 같은 식), 0x417957
function faceTo(s: MutableSprite, c: Cell): void {
  s.direction = facing(s.direction, s.x, s.y, c.x, c.y);
}

/**
 * vmv2.exe 0x00417af7: 칸 a에서 칸 b 쪽 각(도). x = 칩 x 차 × 24, y = 칸 y 차 × 24 × 1.73205f(float32로 저장),
 * 180 − acos(x / √(x² + y²)) × 180 / 3.14159f, y > 0이면 360에서 뺀다(float32). 부르는 쪽이 버림한다
 */
export function angleOf(a: Cell, b: Cell): number {
  const f = Math.fround;
  const x = ((b.y & 1) + b.x * 2 - ((a.y & 1) + a.x * 2)) * 0x18;
  const y = f((b.y - a.y) * 2 * 0xc * f(1.73205));
  const c = x / Math.sqrt(x * x + y * y);
  let angle = c > 1 ? 180 : c < -1 ? 0 : f(180 - (Math.acos(c) * 180) / f(3.14159));
  if (y > 0) angle = f(360 - angle);
  return angle;
}

/** 스크립트 연출 객체(처리기 0x414939). sprites는 +8·+0xc·+0x10·+0x14·+0x18·+0x1c */
export class Script implements Effect {
  ended = false;
  flags = 0;
  pc = 0;
  /** +4 유닛(유닛 표 칸) */
  unit: number | null = null;
  readonly sprites: (MutableSprite | null)[] = [null, null, null, null, null, null];
  /** +0x44 지금 표시 객체 */
  current: MutableSprite | null = null;
  /** +0x4c 각, +0x50~ 기준점(3차원) */
  angle = 0;
  base: [number, number, number] = [0, 0, 0];
  /** +0x38 투사체 연출 객체(신호 0x25) */
  projectile: Effect | null = null;
  /** +0x3c 행동(효과 객체: 둘레 타격 반경), +0x20·+0x24 대상 칸 */
  action = 0;
  target: Cell = { x: -1, y: -1 };
  /** +0x48 처리기(0x32) */
  onEnd: ((s: Script) => void) | null = null;
  script: Int32Array;
  private readonly attack: Attack;
  constructor(attack: Attack, script: Int32Array) {
    this.attack = attack;
    this.script = script;
  }

  run(): void {
    const { stage } = this.attack;
    const { map } = stage.art;
    const w = this.script;
    const arg = (k: number) => w[this.pc + k];
    const cur = () => this.current!;
    for (;;) {
      const op = w[this.pc];
      if (op >= 0 && op <= 0x11) {
        cur().pose = op;
        this.pc++;
        continue;
      }
      switch (op) {
        case 0x14:
        case 0x15:
        case 0x16:
        case 0x17:
        case 0x18:
        case 0x19:
          this.current = this.sprites[op - 0x14];
          this.pc++;
          break;
        case 0x1a:
          cur().flags &= ~2;
          this.pc++;
          break;
        case 0x1b:
          cur().flags |= 2;
          this.pc++;
          break;
        case 0x1c:
          cur().mask = arg(1) & 0xff;
          this.pc += 2;
          break;
        case 0x1d:
          cur().tint |= arg(1) & 0xff;
          this.pc += 2;
          break;
        case 0x1e:
          cur().tint &= ~arg(1) & 0xff;
          this.pc += 2;
          break;
        case 0x1f:
          cur().pose = (cur().pose + 0x12 + arg(1)) % 0x12;
          this.pc += 2;
          break;
        case 0x20: {
          const s = cur();
          s.chipX = s8(s.chipX + arg(1));
          s.chipY = s8(s.chipY + arg(2) - arg(3));
          s.level = s8(s.level + arg(3));
          this.pc += 4;
          break;
        }
        case 0x21:
          nudge(cur(), arg(1), arg(2), arg(3), map, stage.grid);
          this.pc += 4;
          break;
        case 0x22:
          fromWorld(cur(), ...this.base, true, map, stage.grid);
          polar(cur(), this.angle, arg(1), map, stage.grid);
          this.pc += 2;
          break;
        case 0x23:
          place(cur(), map, stage.grid);
          this.pc++;
          break;
        case 0x24:
          cur().key = s8(arg(1));
          this.pc += 2;
          break;
        case 0x25:
          this.projectile!.flags = (this.projectile!.flags | 1) & ~2;
          this.pc++;
          break;
        case 0x26:
          if (!(this.flags & 1)) return;
          this.flags &= ~1;
          this.pc++;
          break;
        case 0x27: // 팔레트 번쩍임 0x41b284(r, g, b, 알파, 걸음, 범위): 6~0x75번
        case 0x28: // 6~0x31번
        case 0x29: // 0x32~0x75번
        case 0x2a: {
          // 지정 범위 n + 0x66 ~ m + 0x67
          const [first, end] = op === 0x27 ? [6, 0x76] : op === 0x28 ? [6, 0x32] : op === 0x29 ? [0x32, 0x76] : [arg(6) + 0x66, arg(7) + 0x67];
          stage.flash.start(arg(1), arg(2), arg(3), arg(4), arg(5), first, end);
          this.pc += op === 0x2a ? 8 : 6;
          break;
        }
        case 0x2b: // 특수(0x403aaa: 물높이 단계·Bless)
          this.attack.special();
          this.pc++;
          break;
        case 0x2c:
          this.attack.strike(this.target, false);
          this.pc++;
          break;
        case 0x2d:
          this.attack.strike(this.target, true); // 몫 누적(+0x5c)은 엔진 타격 기록이 이미 셈
          this.pc += 3;
          break;
        case 0x2e: // 둘레 거리 1·2 칸마다 새로 계산한 전부(효과 반경 안일 때만)
        case 0x2f: {
          const d = op - 0x2d;
          if (d <= this.attack.data.actions[this.action].areaRadius) for (const c of ringCells(this.attack.data.terrain, this.target.x, this.target.y, d)) this.attack.strike(c, false);
          this.pc++;
          break;
        }
        case 0x30:
          this.pc++;
          return;
        case END:
          // vmv2.exe 0x00414939 0x31: 모습(0x412b50), 사본 지움, 주체 키 0, 끝
          if (this.unit !== null) look(this.attack, this.unit);
          for (const k of [0, 1, 3, 4, 5]) if (this.sprites[k]) this.sprites[k]!.flags |= 0x80;
          if (this.sprites[2]) this.sprites[2].key = 0;
          this.ended = true;
          return;
        case 0x32:
          if (this.onEnd) {
            this.onEnd(this);
            return;
          }
          this.pc++;
          break;
        case 0x33:
          this.pc += 3; // 효과음 미리 읽기(스크립트를 걸 때 0x4157bf가 한다)
          break;
        case 0x34:
          stage.sounds.push(['play', arg(1)]); // 0x443f4b
          this.pc += 2;
          break;
        default:
          throw new Error(`연출 스크립트에 모르는 명령 0x${Number(op).toString(16)}이 있습니다(위치 ${this.pc}, 길이 ${w.length}, 유닛 ${this.unit}, 행동 ${this.action})`);
      }
    }
  }
}

// vmv2.exe 0x00410eda: 가림 칸(지형 종류 0x10은 늘, 0xb는 안 가림, 그 밖은 칸 높이 > h)
function blocks(g: { map: Stage['art']['map']; grid: Uint16Array }, x: number, y: number, h: number): boolean {
  const part = g.grid[y * GRID + x];
  const kind = partByte(g.map, part, 0x62);
  return kind === 0x10 ? true : kind === 0xb ? false : h < partByte(g.map, part, 0x61);
}

// vmv2.exe 0x00412b50: 그 순간의 유닛 상태 이상(타격·특수가 바꾼 값)으로
function look(attack: Attack, slot: number): void {
  const s = attack.stage.unitSprite(slot);
  if (s) Object.assign(s, unitLook(attack.status[slot]));
}

/** 공격 하나의 연출: 엔진 기록을 차례로 소비한다 */
export class Attack {
  readonly stage: Stage;
  readonly data: EngineData;
  readonly state: GameState;
  private readonly actor: number;
  private readonly act: Action;
  private readonly aim: Cell;
  private readonly trace: readonly StrikeRecord[];
  private readonly onHit: (r: StrikeRecord) => void;
  private next = 0;
  /** 유닛 칸마다 지금 상태 이상(유닛 +0x58): 타격·특수 기록으로 바뀐다 */
  readonly status: number[];
  constructor(stage: Stage, data: EngineData, state: GameState, actor: number, act: Action, aim: Cell, trace: readonly StrikeRecord[], onHit: (r: StrikeRecord) => void) {
    this.stage = stage;
    this.data = data;
    this.state = state;
    this.status = state.units.map((u) => u?.status ?? 0);
    this.actor = actor;
    this.act = act;
    this.aim = aim;
    this.trace = trace;
    this.onHit = onHit;
  }

  /**
   * 특수 타격(0x403aaa). Bless(0x412d32): 주체 진영 네이티얼마다 회복 숫자 1(HP는 엔진 기록). 물높이(0x42562e → 0x417bed): 그림자 있는 표시 객체를
   * 새 칸 높이에 다시 세운다(작업 격자는 명령 실행 0x4071bd 때 이미 바뀜, 지형 그림은 이때 다시 지음 0x43b8a8)
   */
  special(): void {
    const r = this.trace[this.next++];
    if (!r?.special) throw new Error('특수 타격 기록이 연출과 어긋납니다');
    const { stage } = this;
    if (r.special.units) {
      r.special.units.forEach((u, i) => u && (this.status[i] = u.status));
      const side = unitOf(this.state, this.actor).side;
      this.state.units.forEach((u, i) => u && i >= MASTERS && u.side === side && this.damageNumber(stage.unitSprite(i)!, -1));
    }
    if (r.special.waterLevel !== undefined) for (const p of stage.pool) if (!(p.flags & 0x84)) place(p, stage.art.map, stage.grid);
    this.onHit(r);
  }

  /**
   * vmv2.exe 0x0040354b의 보이는 부분: 지정 칸이 아닌 칸이 원점에서 효과 반경으로 보이고 가리지 않거나 효과 범위 안이면 빗나감 표시(0x413ddb),
   * 맞은 유닛에 데미지 숫자, 반응, 쓰러짐, 창 갱신
   */
  strike(at: Cell, part: boolean): void {
    const r = this.trace[this.next++];
    const { x, y } = at;
    if (!r || r.special || r.x !== x || r.y !== y) throw new Error(`타격 기록이 연출과 어긋납니다: (${x}, ${y})`);
    const { stage, act } = this;
    const origin = act.areaRadius === 0 ? unitOf(this.state, this.actor) : this.aim;
    const ground = { map: this.data.map, grid: stage.grid, state: this.state };
    const h = partByte(this.data.map, stage.grid[origin.y * GRID + origin.x], 0x61);
    if (
      (this.aim.x !== x || this.aim.y !== y) &&
      ((straightSight(ground, origin.x, origin.y, h, x, y, h, act.areaRadius, 1, true) && !blocks(ground, x, y, h)) || inArea(ground, act, this.aim.x, this.aim.y, x, y))
    ) {
      this.spark(x, y, h);
    }
    if (r.unit === null) return;
    this.status[r.unit] = r.status;
    const sprite = stage.unitSprite(r.unit)!;
    if (act.kind === STATUS || act.kind === CURE) {
      Object.assign(sprite, unitLook(r.status));
      this.onHit(r);
      return;
    }
    const kind = act.kind === HEAL ? 2 : act.rangeKind === 1 || act.rangeKind === 2 ? 1 : part ? 1 : 0;
    if (act.kind === DAMAGE && (act.rangeKind === 1 || act.rangeKind === 2) && act.sub === 0) stage.sounds.push(['play', 3]);
    if (!part) this.damageNumber(sprite, r.damage);
    const died = !part && r.hp === 0 && r.unit >= MASTERS;
    const u = unitOf(this.state, r.unit);
    const angle = origin.x === u.x && origin.y === u.y ? sprite.direction * 60 : Math.trunc(angleOf(origin, u));
    this.reaction(r.unit, angle, kind, died);
    this.onHit(r);
  }

  // vmv2.exe 0x00413ddb: 칸 위(높이 h)에 불꽃 스크립트(2틱마다)
  private spark(x: number, y: number, h: number): void {
    const { stage } = this;
    const e = new Script(this, exeScript(stage, SPARK_SCRIPT));
    e.flags = 8;
    stage.addEffect(e);
    const s = stage.alloc();
    s.x = x;
    s.y = y;
    place(s, stage.art.map, stage.grid);
    s.chipY = s8(s.chipY - (h - s.level));
    s.level = s8(h);
    Object.assign(s, { key: -2, page: EFFECT_PAGE, set: EFFECT_SET, flags: 6 });
    e.sprites[0] = s;
  }

  /** vmv2.exe 0x00413fde: 3차원 (x, y, z)에 자취 스크립트(틱마다) */
  trail(x: number, y: number, z: number): void {
    const { stage } = this;
    const e = new Script(this, exeScript(stage, TRAIL_SCRIPT));
    stage.addEffect(e);
    const s = stage.alloc();
    fromWorld(s, x, y, z, false, stage.art.map, stage.grid);
    Object.assign(s, { key: -2, page: EFFECT_PAGE, set: EFFECT_SET, flags: 6 });
    e.sprites[0] = s;
  }

  // vmv2.exe 0x00412c14: 첫 빈 칸에 숫자(자세), 회복이면 색 바꿈 0x20
  private damageNumber(unit: MutableSprite, damage: number): void {
    const s = this.stage.alloc();
    s.tint = damage < 0 ? 0x20 : 0;
    Object.assign(s, { chipX: unit.chipX, chipY: unit.chipY, height: 0x28, level: 0x28, pose: Math.min(Math.abs(damage), 10), page: 0, set: 1, kind: 2, flags: 4 });
  }

  // vmv2.exe 0x0041452e: 대상의 반응 연출(있으면 스크립트만 바꿈)
  private reaction(slot: number, angle: number, kind: number, death: boolean): void {
    const { stage } = this;
    const script = exeScript(stage, REACTIONS[kind]);
    let r = stage.effects.find((e): e is Script => e instanceof Script && !e.ended && e.unit === slot && (e.flags & 4) !== 0);
    if (!r) {
      r = new Script(this, script);
      r.unit = slot;
      r.sprites[2] = stage.unitSprite(slot);
      r.sprites[2]!.kind = 0;
      r.flags |= 4;
      r.angle = angle;
      stage.addEffect(r);
    }
    r.script = script;
    r.pc = 0;
    r.base = toWorld(r.sprites[2]!);
    if (death) r.onEnd = (s) => this.death(s);
  }

  // vmv2.exe 0x004160e3: 모습, 소멸, 반응 연출은 유닛 없이 다음 명령(0x31)으로
  private death(r: Script): void {
    look(this, r.unit!);
    this.vanish(r.unit!);
    r.unit = null;
    r.sprites[2] = null;
    r.pc++;
  }

  /** vmv2.exe 0x0041461a: 네이티얼은 가림 무늬 스크립트, 마스터는 0x416129 */
  vanish(slot: number): void {
    const { stage } = this;
    const u = unitOf(this.state, slot);
    const body = stage.unitSprite(slot)!;
    if (slot >= MASTERS) {
      const fade = new Script(this, exeScript(stage, NATIAL_FADE));
      fade.flags = 0x10;
      fade.sprites[2] = body;
      stage.addEffect(fade);
      return;
    }
    stage.sounds.push(['load', 0xd0088, 0], ['load', 0xd0087, 1]);
    Object.assign(body, { kind: 0, overlay: 0, tint: 0 });
    const a = stage.alloc();
    Object.assign(a, { ...body, key: 1, pose: 0, page: u.side * 0x1e + UI_PAGE, set: u.side + 6, kind: 0, flags: 6 });
    const b = stage.alloc();
    Object.assign(b, { ...a, key: 1, pose: 4, flags: 6 });
    const graphic = unitGraphic(u, slot) * 2 + u.side;
    placePage(stage.art.sheet, stage.art.read(u32(stage.art.exe, VANISH_GRAPHICS + graphic * 4)), b.page);
    loadLayoutSet(stage.art.read, stage.art.sprites.layouts, u32(stage.art.exe, VANISH_LAYOUTS + graphic * 4), b.set);
    stage.addEffect(new Vanish(stage, body, a, b));
  }
}

/** vmv2.exe 0x00416129: 마스터가 돌며 사본으로 바뀌고, 위로 떠오르며 가림 무늬로 사라진다 */
class Vanish implements Effect {
  ended = false;
  flags = 0;
  private step = 0; // +0x2c
  private wait = 0; // +0x30
  private rise = 0; // +0x34
  private top = 0; // +0x3c
  private readonly stage: Stage;
  private readonly body: MutableSprite;
  private readonly a: MutableSprite;
  private readonly b: MutableSprite;
  constructor(stage: Stage, body: MutableSprite, a: MutableSprite, b: MutableSprite) {
    this.stage = stage;
    this.body = body;
    this.a = a;
    this.b = b;
  }

  run(p1: boolean, p2: boolean): void {
    const { body, a, b } = this;
    const up = () => {
      nudge(b, 0, 0, 4, this.stage.art.map, this.stage.grid);
      b.pose = ((b.pose + 1) & 3) + 4;
    };
    switch (this.step) {
      case 0:
        if (this.wait++ > 8) {
          this.stage.sounds.push(['play', 0]);
          this.step++;
        }
        return;
      case 1:
      case 2:
        if (p1) {
          body.direction = (body.direction + 1) % 6;
          if (body.direction === 4) this.step++;
          body.pose = body.direction * 3 + 1;
        }
        return;
      case 3:
        if (p2) {
          body.flags |= 2;
          a.flags &= ~2;
          this.step++;
        }
        return;
      case 4:
      case 6:
      case 8:
        if (p2) {
          a.pose++;
          this.step++;
        }
        return;
      case 5:
      case 7:
        if (p2) this.step++;
        return;
      case 9:
        if (this.wait++ > 0x10) this.step++;
        return;
      case 10:
        this.stage.sounds.push(['play', 1]);
        b.flags &= ~2;
        b.mask = 7;
        this.step++;
        return;
      case 11:
        if (b.mask !== 0) {
          up();
          b.mask--;
          return;
        }
        this.top = b.level + 10;
        this.step++;
      // falls through
      case 12:
        if (b.level < this.top) {
          up();
          return;
        }
        this.step++;
      // falls through
      case 13:
        if (this.rise++ < 7) {
          nudge(b, 0, 0, 4, this.stage.art.map, this.stage.grid);
          b.mask++;
          b.pose = ((b.pose + 1) & 3) + 4;
          return;
        }
        b.flags |= 0x80;
        this.ended = true;
    }
  }
}

const f32 = Math.fround;
const K12 = f32(1.2);
const SQRT3 = f32(1.73205);

/**
 * 투사체. 공격(0x416929): 스크립트 신호(0x25)를 기다렸다가 보이고 틱마다 한 걸음, 닿으면 지우고 대상 칸 타격(새로 계산한 전부).
 * 마법(0x416a4d): 걸음마다 그 자리에 자취(0x413fde)를 남기고, 닿으면 대상 칸 효과 객체를 깨운다(신호)
 */
class Missile implements Effect {
  ended = false;
  flags = 0;
  /** 마법 투사체면 닿을 때 깨울 효과 객체(+0x38) */
  magic: Script | null = null;
  /** 범위 종류가 1이 아니면 직선(0x4170ae·0x417372), 1이면 포물선(0x416bd3·0x416ea6) */
  straight = false;
  readonly target: Cell;
  private step = 0; // +0x2c
  private n = 0; // +0x30
  // 계수(float32): +0x68 수평 거리², +0x6c 걸음당 ², +0x70 z, +0x74 x, +0x78 y 속도
  private r2 = 0;
  private k = 0;
  private vz = 0;
  private vx = 0;
  private vy = 0;
  private readonly attack: Attack;
  readonly sprite: MutableSprite;
  private readonly base: [number, number, number];
  constructor(attack: Attack, sprite: MutableSprite, base: [number, number, number], target: Cell) {
    this.attack = attack;
    this.sprite = sprite;
    this.base = base;
    this.target = target;
  }

  // 대상 칸까지 x·y 픽셀 차와 높이 차(12배)
  private reach(arc: number): { a: number; dx: number; dy: number; dh: number } {
    const { stage } = this.attack;
    const s = this.sprite;
    const t = this.target;
    const dx = ((t.y & 1) + t.x * 2 - s.chipX) * 0x18;
    const dy = Math.trunc((t.y - s.y) * 2 * 0xc * SQRT3);
    const dh = (partByte(stage.art.map, stage.grid[t.y * GRID + t.x], 0x61) - s.level) * 0xc;
    this.r2 = dx * dx + dy * dy;
    return { a: f32(arc * arc), dx, dy, dh };
  }

  /** vmv2.exe 0x00416bd3: 포물선 계수. 그림을 고를 각(도)을 돌려준다 */
  aim(arc: number): number {
    const s = this.sprite;
    const r = this.reach(arc);
    let { a } = r;
    const { dx, dy, dh } = r;
    const { r2 } = this;
    if (r2 === 0) {
      this.k = this.vz = this.vx = this.vy = 0;
      return s.direction * 60;
    }
    const b = f32(dh * dh + r2);
    let c = f32(a - dh * K12);
    let e = (a - dh * K12) * c - f32(1.44) * b;
    if (e < 0) {
      a = f32(Math.sqrt(b) * K12 + f32(dh * K12));
      c = f32(a - dh * K12);
      e = 0;
    }
    this.k = f32(((Math.sqrt(e) + c) * f32(r2)) / (2 * b));
    this.vx = f32(Math.sqrt((dx * this.k * dx) / r2)) * (dx < 0 ? -1 : 1);
    this.vy = f32(Math.sqrt((dy * this.k * dy) / r2)) * (dy < 0 ? -1 : 1);
    this.vz = f32(Math.sqrt(a - this.k));
    if (r2 < (dh * -2 * a) / K12) this.vz = -this.vz;
    return Math.trunc(angleOf(s, this.target));
  }

  /** vmv2.exe 0x004170ae: 직선 계수와 기울기 자세. 그림을 고를 각(도)을 돌려준다 */
  aimStraight(arc: number): number {
    const s = this.sprite;
    const { a, dx, dy, dh } = this.reach(arc);
    const { r2 } = this;
    this.straight = true;
    this.k = f32((r2 * a) / (dh * dh + r2));
    this.vx = f32(Math.sqrt((dx * this.k * dx) / r2)) * (dx < 0 ? -1 : 1);
    this.vy = f32(Math.sqrt((dy * this.k * dy) / r2)) * (dy < 0 ? -1 : 1);
    this.vz = f32(Math.sqrt(a - this.k)) * (dh < 0 ? -1 : 1);
    s.pose = tilt(f32(f32(dh) / Math.sqrt(r2)));
    return Math.trunc(angleOf(s, this.target));
  }

  // vmv2.exe 0x00416ea6(포물선, 기울기로 자세, 아래 비트는 깜빡임)·0x00417372(직선): n째 걸음 위치(들어 올림 없이). 닿았으면 true
  private advance(n: number): boolean {
    const { stage } = this.attack;
    const s = this.sprite;
    const [bx, by, bz] = this.base;
    const x = Math.trunc(n * this.vx + bx);
    const y = Math.trunc((n * this.vy + by * SQRT3) / SQRT3);
    const z = Math.trunc((this.straight ? 0 : (n * f32(-1.2) * n) / 2) + n * this.vz + bz);
    fromWorld(s, x, y, z, false, stage.art.map, stage.grid);
    if (!this.straight) {
      if (this.r2 === 0) {
        s.pose &= 1;
        return true;
      }
      s.pose = (s.pose & 1) | tilt(f32(f32(this.vz - n * K12) / Math.sqrt(this.k)));
    }
    return this.r2 < n * this.k * n;
  }

  run(): void {
    if (this.step === 0) {
      if (!(this.flags & 1)) return;
      this.step++;
    }
    if (this.step === 1) {
      this.sprite.flags &= ~2;
      this.n = 1;
      this.step++;
    }
    if (this.step !== 2) return;
    if (this.magic) this.attack.trail(...toWorld(this.sprite));
    if (!this.advance(this.n)) {
      this.sprite.pose ^= 1;
      this.n++;
      return;
    }
    this.sprite.flags |= 0x80;
    if (this.magic) this.magic.flags = (this.magic.flags | 1) & ~2;
    else this.attack.strike(this.target, false);
    this.ended = true;
  }
}

// 투사체 기울기 → 자세(0x416ea6·0x4170ae 표)
function tilt(slope: number): number {
  return slope > -0.08
    ? slope < 0.08 ? 8 : slope < 0.24 ? 6 : slope < 0.4 ? 4 : slope < 1 ? 2 : 0
    : slope > -0.24 ? 10 : slope > -0.4 ? 12 : slope > -1 ? 14 : 16;
}

/** vmv2.exe 0x00415e18(0x414397이 건다): 연출 번호 2의 시전. 스크립트 없이 2틱마다 몸·모으기 그림을 돌리고 효과 객체를 깨운 뒤 그 신호를 기다린다 */
class Charge implements Effect {
  ended = false;
  flags = 0;
  private step = 0; // +0x2c
  private readonly attack: Attack;
  private readonly caster: number;
  private readonly peer: Effect; // +0x38
  body: MutableSprite | null = null; // +0x10
  copy: MutableSprite | null = null; // +8
  glow: MutableSprite | null = null; // +0x14
  constructor(attack: Attack, caster: number, peer: Effect) {
    this.attack = attack;
    this.caster = caster;
    this.peer = peer;
  }

  run(p1: boolean): void {
    if (!p1) return;
    const copy = this.copy!;
    const glow = this.glow!;
    const body = this.body!;
    if (!(copy.flags & 2)) {
      const c = copy.counter;
      copy.counter = (c + 1) & 0xff;
      if (c === 0 || c === 1) copy.pose++;
      else if (c === 2 || c === 3) {
        if (c === 3) copy.counter = 0;
        copy.pose--;
      }
    }
    switch (this.step) {
      case 0:
        this.attack.stage.sounds.push(['play', 3]);
        this.step++;
        return;
      case 1:
      case 7:
      case 8:
        this.step++;
        return;
      case 2:
        glow.flags &= ~2;
        this.step++;
        return;
      case 3:
      case 4:
      case 5:
        glow.pose++;
        this.step++;
        return;
      case 6:
        body.flags |= 2;
        glow.flags |= 0x80;
        copy.flags &= ~2;
        this.step++;
        return;
      case 9:
        this.peer.flags = (this.peer.flags | 1) & ~2;
        this.step++;
        return;
      case 10:
        if (!(this.flags & 1)) return;
        body.flags &= ~2;
        look(this.attack, this.caster);
        copy.flags |= 0x80;
        this.ended = true;
    }
  }
}

/** vmv2.exe 0x00414397: 주체가 효과 객체 대상 칸 쪽으로 돌고, 몸 사본(+8, 숨김)과 모으기 그림(+0x14 키 3 페이지 0x2f3 묶음 8) */
export function charge(attack: Attack, actor: number, m: Script): Charge {
  const { stage, state } = attack;
  const u = unitOf(state, actor);
  const body = stage.unitSprite(actor)!;
  const k = new Charge(attack, actor, m);
  stage.addEffect(k);
  faceTo(body, m.target);
  body.pose = body.direction * 3 + 1;
  k.body = body;
  body.kind = 0;
  const copy = stage.alloc();
  Object.assign(copy, { ...body, pose: body.direction * 3, page: UI_PAGE, set: 6, counter: 0, flags: 2 });
  const graphic = unitGraphic(u, actor);
  loadArt(stage, CAST_GRAPHICS + (graphic * 2 + u.side) * 4, CAST_LAYOUTS + (graphic * 2 + u.side) * 4, UI_PAGE, 6);
  const glow = stage.alloc();
  Object.assign(glow, { ...body, key: 3, pose: 0, page: MISSILE_PAGE, set: MISSILE_SET, flags: 6 });
  placePage(stage.art.sheet, stage.art.read(CHARGE_GRAPHIC), MISSILE_PAGE);
  loadLayoutSet(stage.art.read, stage.art.sprites.layouts, CHARGE_LAYOUT, MISSILE_SET);
  k.copy = copy;
  k.glow = glow;
  return k;
}

/** 그림 리소스 표 [i] → 페이지, 배치 표 [i] → 묶음 */
export function loadArt(stage: Stage, graphics: number, layouts: number, page: number, set: number): void {
  const { art } = stage;
  placePage(art.sheet, art.read(u32(art.exe, graphics)), page);
  loadLayoutSet(art.read, art.sprites.layouts, u32(art.exe, layouts), set);
}

// 스크립트 리소스를 읽고 앞의 효과음 미리 읽기(0x33)를 한다
function loadScript(e: Script, stage: Stage, table: number): void {
  e.script = words(stage.art.read(u32(stage.art.exe, table)));
  preloadSounds(e, stage);
}

/** vmv2.exe 0x004157bf: 스크립트 앞의 0x33(리소스, 칸)마다 효과음 미리 읽기(0x443f0a) */
export function preloadSounds(e: Script, stage: Stage): void {
  while (e.script[e.pc] === 0x33) {
    stage.sounds.push(['load', e.script[e.pc + 1], e.script[e.pc + 2]]);
    e.pc += 3;
  }
}

/**
 * 주체 연출(공격 0x413852, 시전 0x4141fd): 주체가 peer 대상 칸 쪽으로 돌고, 그림 사본 둘(+8 키 2 숨김, +0xc 키 1)과 유닛 그림별 스크립트로 연출 객체를 건다.
 * 시전이면 스크립트의 0x25가 peer를 깨운다
 */
function actorScript(attack: Attack, actor: number, target: Cell, graphics: number, layouts: number, scripts: number): Script {
  const { stage, state } = attack;
  const u = unitOf(state, actor);
  const body = stage.unitSprite(actor)!;
  const e = new Script(attack, new Int32Array(0));
  stage.addEffect(e);
  faceTo(body, target);
  body.pose = body.direction * 3 + 1;
  e.unit = actor;
  e.target = target;
  e.sprites[2] = body;
  body.kind = 0;
  e.angle = body.direction * 60;
  e.base = toWorld(body);
  const copy = stage.alloc();
  Object.assign(copy, { ...body, pose: body.direction * 3, key: 2, page: UI_PAGE, set: 6, counter: 0, flags: 2 });
  const shown = stage.alloc();
  Object.assign(shown, { ...copy, key: 1 });
  e.sprites[0] = copy;
  e.sprites[1] = shown;
  const graphic = unitGraphic(u, actor);
  loadArt(stage, graphics + (graphic * 2 + u.side) * 4, layouts + (graphic * 2 + u.side) * 4, UI_PAGE, 6);
  loadScript(e, stage, scripts + graphic * 4);
  return e;
}

// vmv2.exe 0x00413c45: 칸에 효과 그림 둘(키 −2 페이지 0x2d5 묶음 7, 그 사본 자세 + 1)과 투사체 자리 그림(0x2f3 묶음 8 키 −1), 행동 스크립트
function effectAt(attack: Attack, caster: number, action: number, cell: Cell): Script {
  const { stage } = attack;
  const side = unitOf(attack.state, caster).side;
  const m = new Script(attack, new Int32Array(0));
  stage.addEffect(m);
  m.action = action;
  m.target = cell;
  const a = stage.alloc();
  a.x = cell.x;
  a.y = cell.y;
  place(a, stage.art.map, stage.grid);
  Object.assign(a, { key: -2, page: EFFECT_PAGE, set: EFFECT_SET, flags: 6 });
  const b = stage.alloc();
  Object.assign(b, { ...a, pose: a.pose + 1 });
  loadArt(stage, EFFECT_GRAPHICS + (action * 2 + side) * 4, EFFECT_LAYOUTS + (action * 2 + side) * 4, b.page, b.set);
  loadScript(m, stage, ACTION_SCRIPTS + action * 4);
  const c = stage.alloc();
  Object.assign(c, { ...a, page: MISSILE_PAGE, set: MISSILE_SET, key: -1 }); // 그림 표 0x483924·0x483a34는 bss(0)라 읽지 않는다
  m.sprites[0] = a;
  m.sprites[1] = b;
  m.sprites[3] = c;
  return m;
}

// 투사체 그림: 표[그림 번호] → 진영마다 30° 12칸(0x42292c·0x422986)
function loadMissileArt(stage: Stage, graphics: number, layouts: number, graphic: number, side: number, angle: number): void {
  let k = Math.trunc((angle + 0xf) / 0x1e);
  if (k > 0xb) k -= 0xc;
  const entry = (table: number) => u32(stage.art.exe, table + graphic * 4) + side * 0x30 + k * 4;
  loadArt(stage, entry(graphics), entry(layouts), MISSILE_PAGE, MISSILE_SET);
}

/** 연출이 쓸 상태: 범위 종류 5 물높이 마법은 명령 실행(0x4255d0 → 0x4071bd)이 연출 전에 작업 격자를 바꾼다(지형 그림은 스크립트 0x2b에서) */
export function actingState(state: GameState, trace: readonly StrikeRecord[]): GameState {
  const water = trace.find((r) => r.special?.waterLevel !== undefined)?.special;
  return water ? { ...state, waterLevel: water.waterLevel! } : state;
}

/** vmv2.exe 0x00413820: 행동 +0xc 연출 번호(0x45f8d0)로 연출을 건다. 0 공격 0x413852, 1 0x413b12, 2 0x413b45, 3 0x413e7c */
export function act(stage: Stage, data: EngineData, state: GameState, actor: number, action: number, target: Cell, trace: readonly StrikeRecord[], onHit: (r: StrikeRecord) => void): Attack {
  const a = data.actions[action];
  const attack = new Attack(stage, data, state, actor, a, target, trace, onHit);
  const u = unitOf(state, actor);
  const graphic = unitGraphic(u, actor);
  const body = stage.unitSprite(actor)!;
  switch (a.effect) {
    case 0: {
      const e = actorScript(attack, actor, target, ATTACK_GRAPHICS, ATTACK_LAYOUTS, SCRIPTS);
      if (a.rangeKind === 1) {
        const s = stage.alloc();
        Object.assign(s, { ...body, page: MISSILE_PAGE, set: MISSILE_SET, flags: 6 });
        const m = new Missile(attack, s, toWorld(body), target);
        stage.addEffect(m);
        loadMissileArt(stage, MISSILE_GRAPHICS, MISSILE_LAYOUTS, graphic, u.side, m.aim(a.arcHeight));
        e.projectile = m;
      }
      break;
    }
    case 1: {
      const m = effectAt(attack, actor, action, target);
      actorScript(attack, actor, target, CAST_GRAPHICS, CAST_LAYOUTS, CAST_SCRIPTS).projectile = m;
      break;
    }
    case 2: {
      // 효과 객체는 주체 칸에, 대상 칸에 그림 둘(키 −2·−1)
      const m = effectAt(attack, actor, action, { x: body.x, y: body.y });
      m.target = target;
      const t = stage.alloc();
      t.x = target.x;
      t.y = target.y;
      place(t, stage.art.map, stage.grid);
      Object.assign(t, { key: -2, page: EFFECT_PAGE, set: EFFECT_SET, flags: 6 });
      const t2 = stage.alloc();
      Object.assign(t2, { ...t, key: -1 });
      m.sprites[4] = t;
      m.sprites[5] = t2;
      stage.sounds.push(['load', u32(stage.art.exe, CHARGE_SOUNDS + unitOf(state, actor).type * 4), 3]);
      m.projectile = charge(attack, actor, m);
      break;
    }
    case 3: {
      const s = stage.alloc();
      Object.assign(s, { ...body, page: MISSILE_PAGE, set: MISSILE_SET, flags: 6 });
      const q = new Missile(attack, s, toWorld(body), target);
      stage.addEffect(q);
      const angle = a.rangeKind === 1 ? q.aim(a.arcHeight) : q.aimStraight(a.arcHeight);
      loadMissileArt(stage, MAGIC_MISSILE_GRAPHICS, MAGIC_MISSILE_LAYOUTS, graphic, u.side, angle);
      actorScript(attack, actor, target, CAST_GRAPHICS, CAST_LAYOUTS, CAST_SCRIPTS).projectile = q;
      q.magic = effectAt(attack, actor, action, target);
      break;
    }
    default:
      throw new Error(`행동 ${action}의 연출 번호 ${a.effect}은 원작에 없습니다`);
  }
  return attack;
}
