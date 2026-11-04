// 차례 흐름 연출: 명령 연출(0x406d13) 뒤 행동 뒤 흐름(0x40623b)과 다음 차례 시작(0x40536c → 0x40546d). 원작은 연출 객체가 다 끝난 틱마다
// 이어 하기(0x476b2c)로 다음 단계를 부른다. 엔진이 차례 전체를 이미 적용하며 남긴 단계 기록(TurnStep)을 원작 차례대로 연출한다:
// 공격으로 마스터가 쓰러지면(0x476b28) 마스터 소멸을 먼저 보이고, 정리(0x412843)·점령(0x41481d)·경험치(0x4147f2)·진영 몰락(0x40612c)·전투 끝,
// 다음 차례 시작의 시간 진행(0x4022d7, MP 부족 소멸)·화면 이동(0x4147b3)·입력 시작의 지형 효과(0x40546d) 순서다.
import { ACT, type Cell, type Command, RETURN, STAND_BY, SUMMON } from '../../engine/command.ts';
import { addExp, EXP_LIMIT, MAX_LEVEL } from '../../engine/rules/combat.ts';
import { natialOf } from '../../engine/rules/summon.ts';
import type { TurnStep } from '../../engine/rules/turn.ts';
import { type GameState, MASTERS, unitOf } from '../../engine/state.ts';
import { type EngineData, SELF_RANGE, type StrikeRecord } from '../../engine/turn.ts';
import { actingState, Attack, charge, exeScript, preloadSounds, Script, u32 } from './attack.ts';
import { place } from './place.ts';
import { loadLayoutSet, loadUnitGraphics, placePage, unitGraphic, unitLook } from './sprites.ts';
import type { SoundCall } from './sound.ts';
import type { Stage } from './stage.ts';

const SUMMON_SCRIPT = 0x45f9ac; // 소환 스크립트(0x414059)
const SUMMON_SOUNDS = 0x45faf4; // [마스터 +2 종류] → 소환 효과음(칸 3)
const SUMMON_GRAPHIC = 0xf; // 소환 효과 그림 → 페이지 0x2d5
const SUMMON_LAYOUT = 0x10; // → 묶음 7
const CAPTURE_SCRIPT = 0x45fd5c; // 마정석 점령(0x41481d)
const CAPTURE_ART = [
  [0x11, 0x12],
  [0x13, 0x14],
]; // 진영별 점령 그림 → 페이지 0x2f3, 배치 → 묶음 8
const EFFECT_PAGE = 0x2d5;
const EFFECT_SET = 7;
const MISSILE_PAGE = 0x2f3;
const MISSILE_SET = 8;

export interface FlowHooks {
  /** 그릴 상태가 바뀜(창 0x40aee4): 타격·특수, 명령을 마친 상태, 정리·점령·경험치·시간 진행·차례 시작 */
  show(state: GameState): void;
  /** 흐름 끝: 다음 차례 입력 시작(화면 이동 뒤 0x40546d) 또는 전투 끝(0x401ec3) */
  done(battleEnd: boolean): void;
  /**
   * CPU 명령 대상 칸 화면 확인(0x406ad9): 칸 상자(반경 check)가 창 안이면 null, 아니면 반경 around 상자를 보이게 할 창 가운데(전장 픽셀, 0x406b3a).
   * 없으면 늘 창 안(오라클 픽스처)
   */
  reveal?(cell: Cell, check: number, around: number): { readonly x: number; readonly y: number } | null;
  /** 알림판(0x42e090)을 띄우고 닫히면(0x42e186) then. 없으면 바로 then */
  notice?(text: string, then: () => void): void;
}

const WATER_RETURNED = 0x45e558; // "Water level has returned." 

/** 걸은 뒤 명령 연출과 차례 흐름. received는 CPU(받은 명령 0x4067b1), 아니면 사람 확정(0x406d13 바로). before는 명령 전 상태 */
export function runCommand(stage: Stage, data: EngineData, before: GameState, actor: number, command: Command, received: boolean, trace: readonly StrikeRecord[], steps: readonly TurnStep[], hooks: FlowHooks): void {
  new TurnFlow(stage, data, before, actor, trace, steps, hooks).command(command, received);
}

class TurnFlow {
  private readonly stage: Stage;
  private readonly data: EngineData;
  private readonly steps: readonly TurnStep[];
  private readonly hooks: FlowHooks;
  private readonly trace: readonly StrikeRecord[];
  private state: GameState;
  private actor: number;
  private next = 0;
  /** 0x476b28: 타격으로 마스터가 쓰러졌다(행동 뒤 흐름이 마스터 소멸부터) */
  private masterFell: boolean;
  constructor(stage: Stage, data: EngineData, before: GameState, actor: number, trace: readonly StrikeRecord[], steps: readonly TurnStep[], hooks: FlowHooks) {
    this.stage = stage;
    this.data = data;
    this.state = before;
    this.actor = actor;
    this.trace = trace;
    this.steps = steps;
    this.hooks = hooks;
    this.masterFell = trace.some((r) => r.unit !== null && r.unit < MASTERS && r.hp < 1);
  }

  private take<K extends TurnStep['kind']>(kind: K): Extract<TurnStep, { kind: K }> {
    const s = this.steps[this.next++];
    if (s?.kind !== kind) throw new Error(`차례 흐름 기록이 연출과 어긋납니다: ${kind}가 와야 하는데 ${s?.kind}`);
    return s as Extract<TurnStep, { kind: K }>;
  }

  private show(state: GameState): void {
    this.state = state;
    this.hooks.show(state);
  }

  // vmv2.exe 0x00407190: 연출을 건 0x406d13 안에서 진영 MP를 먼저 빼고 상태 창을 다시 그린다
  private spend(cost: number): void {
    const side = unitOf(this.state, this.actor).side;
    const sideStates = this.state.sideStates.map((s, i) => (i === side ? { ...s, mp: s.mp - cost } : s)) as unknown as GameState['sideStates'];
    this.show({ ...this.state, sideStates });
  }

  // 연출 문맥(스크립트·소멸): 지금 상태
  private context(): Attack {
    return new Attack(this.stage, this.data, this.state, this.actor, this.data.actions[0], { x: -1, y: -1 }, [], () => {});
  }

  // vmv2.exe 0x004067b1(CPU): 대기·행동은 명령 방향(0x417957), 행동 대상 칸이 주체 칸이 아니면 커서(0x403c8e)·화면 확인 뒤, 되돌리기는 커서·화면 이동 뒤 0x406d13
  command(c: Command, received: boolean): void {
    const { stage, data } = this;
    const { to } = c;
    const moved: GameState = { ...this.state, units: this.state.units.map((u, i) => (i === this.actor ? { ...u!, x: to.x, y: to.y, direction: c.kind <= ACT ? c.direction : u!.direction } : u)) };
    this.show(moved);
    if (received && c.kind <= ACT) stage.face(this.actor, c.direction);
    switch (c.kind) {
      case STAND_BY: // 0x406d13 0 → 0x405fd7 → 0x40623b
        return this.afterCommand();
      case ACT: {
        const a = data.actions[c.number];
        const aim = a.rangeKind === SELF_RANGE ? to : c.target;
        const hit = (r: StrikeRecord) =>
          this.show(r.special ? { ...this.state, ...r.special } : r.unit === null ? this.state : { ...this.state, units: this.state.units.map((u, i) => (u && i === r.unit ? { ...u, hp: r.hp, status: r.status } : u)) });
        const act = () => {
          stage.act(data, actingState(moved, this.trace), this.actor, c.number, aim, this.trace, hit, () => this.afterCommand());
          this.spend(a.mpCost);
        };
        if (!received || (aim.x === to.x && aim.y === to.y)) return void act();
        stage.startTurn(aim);
        const center = this.hooks.reveal?.(aim, a.areaRadius, a.areaRadius + 1);
        if (!center) return void act();
        stage.scrollTo(center.x, center.y); // 0x406b3a → 0x4147b3, 이어 하기 0x406a69
        stage.continueWith(act);
        return;
      }
      case SUMMON:
        this.summon(c.number, c.target);
        return this.spend(natialOf(data.natials, c.number).summonMp);
      case RETURN: {
        // 0x406d13 3: HP −10, 소멸, 이어 하기 0x40536c
        const target = this.state.units.findIndex((u) => u && u.x === c.target.x && u.y === c.target.y);
        const back = () => {
          this.show(this.take('act').state);
          this.context().vanish(target);
          stage.continueWith(() => this.nextTurn());
        };
        if (!received) return back();
        stage.startTurn(c.target);
        stage.scrollToUnit(target);
        stage.continueWith(back);
        return;
      }
    }
  }

  // 0x406045·0x405fd7·0x4060b9: 명령을 마친 상태(OA) 뒤 행동 뒤 흐름
  private afterCommand(): void {
    this.show(this.take('act').state);
    this.afterAction();
  }

  // vmv2.exe 0x00412843 → 0x004128c8: 쓰러진 네이티얼 레코드와 표시 객체를 지운다
  private remove(): void {
    if (this.steps[this.next]?.kind !== 'remove') return;
    const { state } = this.take('remove');
    this.state.units.forEach((u, i) => u && !state.units[i] && this.stage.drop(i));
    this.show(state);
  }

  /** vmv2.exe 0x0040623b */
  private afterAction(): void {
    const { stage } = this;
    this.remove();
    if (this.masterFell) {
      this.masterFell = false;
      const ctx = this.context();
      this.state.units.forEach((u, i) => u && i < MASTERS && u.hp < 1 && ctx.vanish(i));
      stage.continueWith(() => this.afterAction());
      return;
    }
    const step = this.steps[this.next];
    switch (step?.kind) {
      case 'capture':
        this.next++;
        this.capture(step.unit, step.state);
        stage.continueWith(() => this.afterAction());
        return;
      case 'exp':
        this.next++;
        stage.addEffect(new ExpEffect(this, step.unit, step.gain));
        stage.continueWith(() => this.afterAction());
        const u = unitOf(this.state, step.unit);
        stage.startTurn({ x: u.x, y: u.y }); // 0x403c8e
        return;
      case 'fall': {
        // vmv2.exe 0x0040612c: 마스터가 쓰러진 진영의 네이티얼을 HP −10 뒤 모두 소멸
        this.next++;
        this.show(step.state);
        const ctx = this.context();
        for (const i of step.doomed) ctx.vanish(i);
        stage.continueWith(() => this.afterAction());
        return;
      }
      case 'end':
        this.next++;
        this.finish(true);
        return;
      default:
        this.nextTurn();
    }
  }

  // 흐름 끝: 엔진이 남긴 차례 기록을 다 썼어야 한다(연출 순서가 어긋나 기록이 남으면 여기서 드러난다)
  private finish(battleEnd: boolean): void {
    if (this.next !== this.steps.length) throw new Error(`차례 흐름 기록이 남았습니다: ${this.steps.slice(this.next).map((s) => s.kind).join(', ')}`);
    this.hooks.done(battleEnd);
  }

  /** vmv2.exe 0x0040536c: 정리, 다음 차례 유닛에 커서, 시간 진행(0x4022d7: 상태 이상이 다한 유닛 모습, MP 부족 소멸), 화면 이동 */
  private nextTurn(): void {
    this.remove();
    const step = this.take('time');
    // vmv2.exe 0x004022d7 끝: 물이 돌아오면 알림판을 띄우고 닫힐 때까지 기다린다(그동안 전장은 옛 물높이)
    if (this.hooks.notice && step.state.waterLevel !== this.state.waterLevel) this.hooks.notice(this.stage.art.exe.cString(WATER_RETURNED), () => this.timeStep(step));
    else this.timeStep(step);
  }

  private timeStep(step: Extract<TurnStep, { kind: 'time' }>): void {
    const { stage } = this;
    const before = this.state;
    this.actor = step.actor;
    const a = unitOf(before, step.actor);
    stage.startTurn({ x: a.x, y: a.y });
    before.units.forEach((u, i) => {
      const v = step.state.units[i];
      if (u && v && (u.status & 7) !== 0 && (v.status & 7) === 0) {
        const s = stage.unitSprite(i);
        if (s) Object.assign(s, unitLook(v.status)); // 0x412b50
      }
    });
    this.show(step.state);
    if (step.victims.length) {
      const ctx = this.context();
      for (const i of step.victims) ctx.vanish(i);
      stage.continueWith(() => this.nextTurn());
      return;
    }
    stage.scrollToUnit(step.actor);
    stage.continueWith(() => this.inputStart());
  }

  /** vmv2.exe 0x0040546d: 차례 시작 지형 효과(그 상태는 done 뒤 창이 보인다). 쓰러지면 소멸 뒤 행동 뒤 흐름 */
  private inputStart(): void {
    const step = this.take('start');
    if (!step.died) {
      this.finish(false);
      return;
    }
    this.show(step.state);
    this.actor = step.actor;
    this.context().vanish(step.actor);
    this.stage.continueWith(() => this.afterAction());
  }

  // vmv2.exe 0x0041481d: 주체 칸에 점령 그림(페이지 0x2f3 묶음 8)과 스크립트, 0x32에서 마정석 소유를 바꾼다(0x4168ea → 0x40124c)
  private capture(unit: number, after: GameState): void {
    const { stage } = this;
    const side = unitOf(this.state, unit).side;
    const e = new Script(this.context(), exeScript(stage, CAPTURE_SCRIPT));
    stage.addEffect(e);
    e.onEnd = (s) => {
      this.show(after);
      s.pc++;
    };
    preloadSounds(e, stage);
    const body = stage.unitSprite(unit)!;
    const a = stage.alloc();
    a.x = body.x;
    a.y = body.y;
    place(a, stage.art.map, stage.grid);
    Object.assign(a, { key: 1, pose: 0, page: MISSILE_PAGE, set: MISSILE_SET, kind: 0, flags: 6 });
    e.sprites[3] = a;
    const [graphic, layout] = CAPTURE_ART[side];
    placePage(stage.art.sheet, stage.art.read(graphic), MISSILE_PAGE);
    loadLayoutSet(stage.art.read, stage.art.sprites.layouts, layout, MISSILE_SET);
  }

  // vmv2.exe 0x00414059: 소환 스크립트(2틱마다, 대상 칸), 모으기(0x414397), 새 유닛(0x40f910, 숨김)과 소환 효과 그림 둘, 0x402954
  private summon(type: number, cell: Cell): void {
    const { stage } = this;
    const after = this.steps[this.next];
    if (after?.kind !== 'act') throw new Error('소환 기록이 없습니다');
    const slot = after.state.units.findIndex((u, i) => u && !this.state.units[i]);
    const u = unitOf(after.state, slot);
    const ctx = this.context();
    const e = new Script(ctx, exeScript(stage, SUMMON_SCRIPT));
    e.flags = 8;
    e.target = cell;
    stage.addEffect(e);
    stage.sounds.push(['load', 0xd0086, 0], ['load', u32(stage.art.exe, SUMMON_SOUNDS + unitOf(this.state, this.actor).type * 4), 3]);
    e.projectile = charge(ctx, this.actor, e);
    // vmv2.exe 0x0040f910(0x40f42f): 첫 빈 칸, 페이지 = 칸 × 0xe + 10, 칸에 세우고 주체 방향
    const caster = stage.unitSprite(this.actor)!;
    const s = stage.alloc();
    s.page = slot * 0xe + 10;
    s.x = cell.x;
    s.y = cell.y;
    place(s, stage.art.map, stage.grid);
    Object.assign(s, { direction: caster.direction, pose: caster.direction * 3, tint: 0, kind: 1, flags: 0 });
    stage.adopt(slot, s, u.status);
    const units = [...this.state.units];
    units[slot] = u;
    this.show({ ...this.state, units });
    e.unit = slot;
    e.sprites[2] = s;
    s.flags = 2;
    loadUnitGraphics(stage.art.exe, stage.art.read, stage.art.sheet, slot, unitGraphic(u, slot), u.side);
    stage.art.loaded[slot] = unitGraphic(u, slot) * 2 + u.side;
    const a = stage.alloc();
    Object.assign(a, { ...s, key: -1, pose: 0, page: EFFECT_PAGE, set: EFFECT_SET, kind: 0, flags: s.flags | 4 });
    const b = stage.alloc();
    Object.assign(b, { ...a, key: 1, pose: 0xe });
    placePage(stage.art.sheet, stage.art.read(SUMMON_GRAPHIC), EFFECT_PAGE);
    loadLayoutSet(stage.art.read, stage.art.sprites.layouts, SUMMON_LAYOUT, EFFECT_SET);
    e.sprites[3] = a;
    e.sprites[4] = b;
    stage.flash.reset(); // 0x402954
    stage.setShade('bright', this.state.timeOfDay);
    stage.continueWith(() => this.afterCommand());
  }

  /** 경험치 막대(0x4167a4)가 쓰는 상태 바꾸기(0x412cc9). 최대 레벨에 닿았으면 full, 레벨이 올랐으면 up */
  gainExp(unit: number, amount: number): { full: boolean; up: boolean } {
    const level = unitOf(this.state, unit).level;
    this.show(addExp(this.state, unit, amount));
    const u = unitOf(this.state, unit);
    return { full: u.level >= MAX_LEVEL && u.exp >= EXP_LIMIT, up: u.level > level };
  }

  sound(c: SoundCall): void {
    this.stage.sounds.push(c);
  }
}

/**
 * vmv2.exe 0x004167a4: 6틱 쉬고, 틱마다 경험치 2씩(남은 것이 3 미만이면 한 번에, 최대 레벨에 닿으면 멈춤) 더해 창을 고치고, 6틱 쉰다.
 * 더할 때마다 효과음: 레벨이 오르면 8, 세는 중이면 반복 6, 다 세면 7
 */
class ExpEffect {
  ended = false;
  flags = 0;
  private step = 0; // +0x2c
  private wait = 0; // +0x30
  private tail = 0; // +0x34
  private left: number; // +0x3c
  private readonly flow: TurnFlow;
  private readonly unit: number;
  constructor(flow: TurnFlow, unit: number, gain: number) {
    this.flow = flow;
    this.unit = unit;
    this.left = gain;
  }

  run(): void {
    if (this.step === 0) {
      if (this.wait++ > 4) this.step++;
    } else if (this.step === 1) {
      let up: boolean;
      if (this.left < 3) {
        up = this.flow.gainExp(this.unit, this.left).up;
        this.left = 0;
        this.step++;
      } else {
        this.left -= 2;
        const r = this.flow.gainExp(this.unit, 2);
        up = r.up;
        if (r.full) this.step++;
      }
      this.flow.sound(up ? ['ui', 8] : this.step < 2 ? ['loop', 6] : ['ui', 7]);
    } else if (this.step === 2 && this.tail++ > 4) this.ended = true;
  }
}
