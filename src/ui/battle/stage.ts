// 연출 틀: 원작 표시 객체 풀(0x47c2b0)·연출 객체(0x47a3a8)·타이머 카운터를 들고, 원작 함수와 같은 조작으로 풀을 고친다.
// 풀은 첫 빈 칸 할당(0x4174a6)과 지움 표시(+0x13 | 0x80)로 바뀌고, 표식을 지우면 유닛 종류를 1로 되돌리는 등(0x40583f) 상태에서 다시 지을 수 없는
// 값이 남는다. 엔진 상태는 바꾸지 않는다: 명령은 엔진이 한 번에 적용하고, 연출은 그 앞뒤 상태로 풀만 움직인다.
import type { Cell } from '../../engine/command.ts';
import { type Step, walkPath } from '../../engine/rules/move.ts';
import { movementRange, moverOf } from '../../engine/rules/movement.ts';
import { cellHeights, GRID, partByte, terrainGraph, workGrid } from '../../engine/rules/terrain.ts';
import type { GameState, UnitRecord } from '../../engine/state.ts';
import type { EngineData } from '../../engine/turn.ts';
import { SKY_START, type SkyMotion, skyTick } from './field.ts';
import { NO_OVERLAY, type UiOverlay } from './overlay.ts';
import { act as startAct, type Attack } from './attack.ts';
import type { StrikeRecord } from '../../engine/turn.ts';
import { Flash, type Shade } from './palette.ts';
import type { SoundCall } from './sound.ts';
import { type MutableSprite, nudge, place, polar } from './place.ts';
import type { BattleArt } from './screen.ts';
import { CHIP_H, CHIP_W } from './sheet.ts';
import { unitLook, unitSprite } from './sprites.ts';

/** 애니메이션 옵션 기본값(0x503ff0, 레지스트리가 없을 때 0x44e181): 1 하늘, 2 물, 4 대기 애니메이션 */
export const ANIMATION_OPTIONS = 0x77;
const UI_PAGE = 0x2c6;
const FLY = 4;
const NO_SHADOW_KIND = 0xb; // 비행 유닛이 이 지형 위에 있으면 그림자를 끈다(0x415a11)
// 범위 표식 자세·묶음·종류(0x4058b6)
const BOUNCE = [10, 7, 4, 2, 1, -1, -1, -2];
const RANGE_LOOKS: readonly (readonly [number, number, number])[] = [[8, 2, 3], [0, 3, 5], [3, 3, 5], [6, 3, 5], [9, 3, 5], [12, 3, 5], [15, 3, 5], [0, 4, 5], [3, 4, 5]];

/**
 * 연출 객체(0x7c바이트): 처리기 +0, 끝남 +0x28 & 0x80000000. flags는 +0x28의 아래 비트: 1 신호(스크립트 0x25·0x26), 2 이 틱에 처리함,
 * 4 반응 연출(0x41452e), 8·0x10 처리기를 부르는 틱(0x10이면 4틱마다, 8이면 2틱마다, 둘 다 없으면 매 틱)
 */
export interface Effect {
  ended: boolean;
  flags: number;
  run(p1: boolean, p2: boolean): void;
}

// 2틱마다 걷기·대기 프레임: 카운터 += 2(8이면 0), 프레임 = 카운터 / 2(3이면 1)
function stepFrame(s: MutableSprite): void {
  s.counter = s.counter + 2 > 7 ? 0 : s.counter + 2;
  setFrame(s);
}
function setFrame(s: MutableSprite): void {
  const f = s.counter >> 1;
  s.pose = ((s.pose / 3) | 0) * 3 + (f === 3 ? 1 : f);
}

// vmv2.exe 0x00417957
function turnTo(s: MutableSprite, direction: number): void {
  s.direction = direction;
  s.pose = direction * 3 + (s.pose % 3);
}

// vmv2.exe 0x00412b50
function look(s: MutableSprite, u: UnitRecord): void {
  Object.assign(s, unitLook(u.status));
}

/** 이동할 칸들(0x440bcd 차례)과 비행 여부 */
export function walkSteps(data: EngineData, state: GameState, unit: number, to: Cell): { steps: Step[]; flying: boolean } {
  const grid = workGrid(data.map, state);
  const mover = moverOf(state, data.natials, unit);
  const range = movementRange(data.terrain, terrainGraph(data.terrain, data.map, grid, mover.moveType), cellHeights(data.map, grid), state, unit, mover);
  const u = state.units[unit]!;
  return { steps: walkPath(data.terrain, range, u.x, u.y, to.x, to.y), flying: mover.moveType === FLY };
}

export class Stage {
  readonly pool: MutableSprite[] = [];
  /** 어두운 칸 0x76~0xe5번의 상태(사람 입력 시작 0x4027e3이면 dark, 공격·마법 연출 시작 0x402954면 bright) */
  shade: Shade = 'black';
  /** 음영 칸을 계산한 시각(battleColors shadeTime) */
  shadeTime = 0;
  /** 팔레트 번쩍임(스크립트 0x27~0x2a) */
  readonly flash = new Flash();
  /** 화면 이동 한 단계(0x4165bb): 전장 픽셀 (x, y)를 창 가운데로 옮기고 다 왔으면 true. 없으면 첫 틱에 끝(오라클 픽스처는 창 스크롤이 없다) */
  scroller: ((x: number, y: number) => boolean) | null = null;
  readonly art: BattleArt;
  /** 타이머 카운터 0x476b20(틱), 0x476ba8(2틱), 커서 프레임 0x476ad4(2틱마다 0~4), 물 프레임 0x49de20(4틱마다) */
  b20 = 0;
  ba8 = 0;
  cursorFrame = 0;
  water = 0;
  sky: SkyMotion = SKY_START;
  /** 커서 켬(0x476bac)과 칸(0x476b78, 칸 밖이면 null) */
  cursorOn = false;
  cursorCell: Cell | null = null;
  /** 애니메이션 옵션(0x503ff0 비트 1·2·4). System > Customize가 전투 중에도 바꾼다 */
  options: number;
  private readonly units: (MutableSprite | null)[] = [];
  private readonly statuses: number[] = [];
  private readonly cursor: MutableSprite;
  private turn: { readonly sprite: MutableSprite; readonly unit: number; readonly remote: boolean } | null = null;
  private range: { readonly sprite: MutableSprite; readonly unit: number; readonly mode: number } | null = null;
  /** 연출 객체(0x47a3a8, 할당 0x412ed3 차례) */
  effects: Effect[] = [];
  private walking = new Set<number>();
  private then: (() => void) | null = null;
  private state: GameState;
  grid: Uint16Array;

  /** 되살리기·전투 시작과 같은 풀: 유닛 칸 차례로 유닛, 이어 커서(0x4021ee) */
  constructor(art: BattleArt, state: GameState, options = ANIMATION_OPTIONS) {
    this.art = art;
    this.options = options;
    this.state = state;
    this.grid = workGrid(art.map, state);
    this.syncUnits(state);
    this.cursor = this.alloc();
    Object.assign(this.cursor, { pose: 0xd, page: UI_PAGE, set: 1, kind: 0, flags: 6 });
  }

  /** vmv2.exe 0x004174a6 + 0x0041743f: 첫 빈 칸(없으면 끝에 새 칸). 위치·페이지는 남는다 */
  alloc(): MutableSprite {
    let s = this.pool.find((p) => p.flags & 0x80);
    if (!s) {
      s = { x: 0, y: 0, chipX: 0, chipY: 0, px: 0, py: 0, lift: 0, key: 0, level: 0, height: 0, direction: 0, pose: 0, page: 0, set: 0, tint: 0, mask: 0, kind: 0, counter: 0, flags: 0, overlay: 0, overlayFrame: 0 };
      this.pool.push(s);
    }
    return Object.assign(s, { px: 0, py: 0, lift: 0, key: 0, direction: 0, pose: 0, set: 0, tint: 0, mask: 0, kind: 0, counter: 0, flags: 4, overlay: 0, overlayFrame: 0 });
  }

  private placeAt(s: MutableSprite, c: Cell): void {
    s.x = c.x;
    s.y = c.y;
    place(s, this.art.map, this.grid);
  }

  // 유닛 표시 객체를 상태에 맞춘다: 사라진 유닛은 지우고, 새 유닛은 첫 빈 칸에, 칸·방향·상태 이상이 바뀌었으면 고친다
  private syncUnits(state: GameState): void {
    state.units.forEach((u, slot) => {
      const s = this.units[slot];
      if (s && !u) {
        s.flags |= 0x80;
        this.units[slot] = null;
      }
    });
    state.units.forEach((u, slot) => {
      if (!u) return;
      let s = this.units[slot];
      if (!s) {
        s = this.alloc();
        Object.assign(s, unitSprite(this.art.map, this.grid, u, slot));
        this.units[slot] = s;
        this.statuses[slot] = u.status & 7;
        return;
      }
      if (this.walking.has(slot)) return;
      if (s.x !== u.x || s.y !== u.y || s.height !== partByte(this.art.map, this.grid[u.y * GRID + u.x], 0x61)) this.placeAt(s, u);
      if (s.direction !== u.direction) turnTo(s, u.direction);
      if (this.statuses[slot] !== (u.status & 7)) look(s, u);
      this.statuses[slot] = u.status & 7;
    });
  }

  /** 커서 칸을 옮길 때(0x403c8e → 0x40aefd 상태 창이 그 칸을 보인다) */
  onCursor: ((cell: Cell) => void) | null = null;

  private placed: { readonly unit: number; readonly at: Cell; readonly saved: MutableSprite; readonly ghost: MutableSprite | null; readonly covered: MutableSprite | null } | null = null;

  // 유닛 메뉴의 가상 배치: 되돌리기(0x405bb2) 뒤 새 배치(0x405a6e). state는 고른 유닛이 at에 선 그릴 상태
  private place(state: GameState, p: UiOverlay['placed']): void {
    const cur = this.placed;
    if (cur && p && p.unit === cur.unit && p.at.x === cur.at.x && p.at.y === cur.at.y) return;
    if (cur) {
      // ponytail: 원작은 단계 7에 들어갈 때(0x4045ee) 둔 위치 객체(0x476b90)로 되돌린다. 여기서는 세울 때의 사본(그 사이 대기 애니메이션만 다름)
      if (cur.ghost) {
        Object.assign(this.units[cur.unit]!, cur.saved);
        cur.ghost.flags |= 0x80;
      }
      if (cur.covered) cur.covered.flags &= ~2;
      this.placed = null;
    }
    if (!p) return;
    const body = this.units[p.unit]!;
    const saved = { ...body };
    let ghost: MutableSprite | null = null;
    if (p.at.x !== p.from.x || p.at.y !== p.from.y) {
      ghost = this.alloc();
      Object.assign(ghost, { ...body, x: p.from.x, y: p.from.y });
      place(ghost, this.art.map, this.grid);
      ghost.mask = 4;
      ghost.flags = 4;
    }
    const other = state.units.findIndex((u, i) => u && i !== p.unit && u.x === p.at.x && u.y === p.at.y);
    const covered = other >= 0 ? this.units[other] : null;
    if (covered) covered.flags |= 2;
    body.x = p.at.x;
    body.y = p.at.y;
    place(body, this.art.map, this.grid);
    this.placed = { unit: p.unit, at: p.at, saved, ghost, covered };
  }

  /** vmv2.exe 0x00403c8e: 차례 시작에 커서 칸을 차례 유닛 칸으로(켬은 그대로) */
  startTurn(cell: Cell): void {
    this.cursorCell = cell;
    this.placeAt(this.cursor, cell);
    this.cursor.lift = 0xc;
    this.onCursor?.(cell);
  }

  /** vmv2.exe 0x00403d7b: 마우스가 다른 칸(또는 칸 밖)으로. 커서 프레임을 0으로 */
  pointer(cell: Cell | null): void {
    const c = this.cursorCell;
    if (c === cell || (c && cell && c.x === cell.x && c.y === cell.y)) return;
    this.cursorCell = cell;
    this.cursorFrame = 0;
    this.cursor.pose = 0xd;
    if (!cell) {
      this.cursor.flags |= 2;
      return;
    }
    this.placeAt(this.cursor, cell);
    this.cursor.lift = 0xc;
    this.cursor.flags = this.cursorOn ? this.cursor.flags & ~2 : this.cursor.flags | 2;
  }

  /**
   * 입력 단계의 표시를 맞춘다: 앞 단계 정리(0x4052b8)처럼 바뀐 표식을 지우고 유닛을 상태에 맞춘 뒤, 흐림과 새 표식, 커서 칸·켬.
   * cursor는 세션의 커서 칸(단계 3 진입처럼 칸을 옮기면 0x403c8e), on은 켬(0x403b10)
   */
  show(state: GameState, o: UiOverlay, cursor: Cell | null, on: boolean): void {
    this.state = state;
    this.grid = workGrid(this.art.map, state);
    this.place(state, o.placed ?? null);
    const r = this.range;
    if (r && !(o.rangeMarker && o.rangeMarker.unit === r.unit && o.rangeMarker.mode === r.mode)) {
      // vmv2.exe 0x00405a1c
      r.sprite.flags |= 0x80;
      const u = this.units[r.unit];
      if (u) u.flags &= ~8;
      this.range = null;
    }
    const t = this.turn;
    if (t && !(o.turnMarker && o.turnMarker.unit === t.unit && o.turnMarker.remote === t.remote)) {
      // vmv2.exe 0x0040583f
      t.sprite.flags |= 0x80;
      const u = this.units[t.unit];
      if (u) {
        u.kind = 1;
        u.tint &= 0x3f;
        u.flags &= ~8;
      }
      this.turn = null;
    }
    this.syncUnits(state);
    this.units.forEach((s, slot) => s && (s.tint = (s.tint & ~1) | (o.dimUnits.has(slot) ? 1 : 0))); // 0x412670, +0xf | 1
    if (o.turnMarker && !this.turn) {
      // vmv2.exe 0x0040574a
      const { unit, remote } = o.turnMarker;
      const s = this.alloc();
      this.placeAt(s, state.units[unit]!);
      Object.assign(s, { key: 1, page: UI_PAGE }, remote ? { pose: 6, set: 4, kind: 4 } : { pose: 0, set: 2, kind: 3 });
      const u = this.units[unit]!;
      u.kind = 6;
      u.flags |= 8;
      this.turn = { sprite: s, unit, remote };
    }
    if (o.rangeMarker && !this.range) {
      // vmv2.exe 0x004058b6
      const { unit, mode } = o.rangeMarker;
      const s = this.alloc();
      this.placeAt(s, state.units[unit]!);
      const [pose, set, kind] = RANGE_LOOKS[mode];
      Object.assign(s, { key: 2, page: UI_PAGE, pose, set, kind });
      this.units[unit]!.flags |= 8;
      this.range = { sprite: s, unit, mode };
    }
    if (cursor && !(this.cursorCell && this.cursorCell.x === cursor.x && this.cursorCell.y === cursor.y)) this.startTurn(cursor);
    if (on !== this.cursorOn) {
      // vmv2.exe 0x00403b10
      this.cursorOn = on;
      this.cursor.flags = on && this.cursorCell ? this.cursor.flags & ~2 : this.cursor.flags | 2;
    }
  }

  /** vmv2.exe 0x00406573: CPU가 명령을 정하면 차례 표식을 지우고(0x40583f) 단계 0(커서 끔). 이어 도착 칸을 보이게 한 뒤 걷는다(0x40672d) */
  decide(state: GameState): void {
    this.show(state, NO_OVERLAY, this.cursorCell, false);
  }

  /** 그릴 때의 커서(켜져 있고 칸이 있을 때): 커서 프레임 < 2면 그 칸이 깜빡인다 */
  cursorView(): UiOverlay['cursor'] {
    return this.cursorOn && this.cursorCell ? { ...this.cursorCell, frame: this.cursorFrame } : null;
  }

  /** vmv2.exe 0x0041377b: 유닛 slot을 steps대로 걷게 한다(비행이면 떠서). 연출이 모두 끝난 틱에 then(이어 하기 0x476b2c) */
  walk(slot: number, steps: readonly Step[], flying: boolean, then: () => void): void {
    this.then = then;
    const s = this.units[slot]!;
    const u = this.state.units[slot]!;
    s.key = 1;
    s.kind = 0;
    this.walking.add(slot);
    const { map } = this.art;
    const grid = this.grid;
    const height = (c: Cell) => partByte(map, grid[c.y * GRID + c.x], 0x61);
    const kindAt = (c: Cell) => partByte(map, grid[c.y * GRID + c.x], 0x62);
    const goal = steps[steps.length - 1];
    let next = 0; // 다음 칸(0x440bcd가 도착 칸부터 거꾸로 찾는 칸)
    let k = 0; // +0x2c 칸 안 틱
    let frames = 0; // +0x30
    const stage = this;
    const finish = (e: Effect) => {
      look(s, u);
      s.key = 0;
      e.ended = true;
      stage.walking.delete(slot);
    };
    let effect: Effect;
    if (!flying) {
      // vmv2.exe 0x00415829
      effect = {
        ended: false,
        flags: 0,
        run() {
          const from = { ...s };
          place(from, map, grid);
          const c = steps[next];
          s.x = c.x;
          s.y = c.y;
          turnTo(s, c.direction);
          place(s, map, grid);
          if (++k < 6) {
            s.x = from.x;
            s.y = from.y;
            if (s.level < from.level) {
              s.chipY = ((s.chipY - (from.level - s.level)) << 24) >> 24;
              s.height = from.level;
              s.level = from.level;
            }
            polar(s, s.direction * 60, ((k * 0x30) / 6 | 0) - 0x30, map, grid);
          } else {
            next++;
            if (s.x === goal.x && s.y === goal.y) finish(this);
            k = 0;
          }
          if (++frames > 1) {
            stepFrame(s);
            frames = 0;
          }
        },
      };
    } else {
      // vmv2.exe 0x00415a11: 경로 칸 높이 최대(0x440ca4) + 4까지 떠올라 가서 내려앉는다
      const top = Math.max(height(u), ...steps.map(height)) + 4;
      let stage2 = 0; // +0x34: 0 떠오름, 1 이동, 2 내려앉음
      effect = {
        ended: false,
        flags: 0,
        run() {
          const from = { ...s };
          let alive = true;
          s.flags &= ~4;
          let move = stage2 === 1;
          if (stage2 === 0) {
            if (s.level < top) {
              s.level++;
              s.chipY--;
            }
            if (s.level >= top) {
              s.chipY += s.level - top;
              s.level = top;
              stage2 = 1;
              move = true;
            }
          } else if (stage2 === 2) {
            if (s.height < s.level) {
              s.level--;
              s.chipY++;
            }
            if (s.level <= s.height) {
              place(s, map, grid);
              finish(this);
              alive = false;
            }
          }
          if (move) {
            place(from, map, grid);
            const c = steps[next];
            s.x = c.x;
            s.y = c.y;
            turnTo(s, c.direction);
            place(s, map, grid);
            s.chipY -= top - s.height;
            s.level = top;
            if (++k < 6) {
              if (s.height < from.height) {
                s.height = from.height;
                if (kindAt(from) === NO_SHADOW_KIND) s.flags |= 4;
              } else if (kindAt(s) === NO_SHADOW_KIND) s.flags |= 4;
              s.x = from.x;
              s.y = from.y;
              polar(s, s.direction * 60, ((k * 0x30) / 6 | 0) - 0x30, map, grid);
            } else {
              if (kindAt(s) === NO_SHADOW_KIND) s.flags |= 4;
              next++;
              if (s.x === goal.x && s.y === goal.y) stage2 = 2;
              k = 0;
            }
          }
          if (alive && ++frames > 1) {
            stepFrame(s);
            frames = 0;
          }
        },
      };
    }
    this.addEffect(effect);
  }

  /** 원작 효과음 호출(sound.ts). 부르는 쪽이 꺼내 간다 */
  readonly sounds: SoundCall[] = [];
  /** 이번 틱까지 쌓인 효과음 호출을 꺼낸다(부르는 쪽이 틱마다) */
  takeSounds(): SoundCall[] {
    return this.sounds.splice(0);
  }

  /** 어두운 칸 음영을 건다(0x4027e3 어두운 판, 0x402954 밝은 사본): 그 시각 팔레트로 */
  setShade(shade: Shade, time: number): void {
    this.shade = shade;
    this.shadeTime = time;
  }

  /** vmv2.exe 0x004147b3: 화면 이동 연출 객체(처리기 0x4165bb). 다 옮기면 끝 */
  scrollTo(x: number, y: number): void {
    // 원작은 이동 중(0x47a3a0, 0x4147e8) 마우스를 버려 이동이 겹치지 않는다. 겹치면 새 목표가 앞 이동을 대신한다(서로 당기며 멈추지 않게)
    if (this.scrolling) this.scrolling.ended = true;
    const stage = this;
    const effect: Effect = {
      ended: false,
      flags: 0,
      run() {
        this.ended = stage.scroller?.(x, y) ?? true;
        if (this.ended && stage.scrolling === effect) stage.scrolling = null;
      },
    };
    this.scrolling = effect;
    this.addEffect(effect);
  }

  private scrolling: Effect | null = null;

  /** vmv2.exe 0x004147e8(0x47a3a0): 화면 이동 연출 중 */
  get moving(): boolean {
    return this.scrolling !== null;
  }

  /** 다음 이어 하기(0x476b2c): 지금 살아 있는 연출 객체가 모두 끝난 틱에 then */
  continueWith(then: () => void): void {
    this.then = then;
  }

  /** 유닛 slot 쪽으로 화면 이동(0x40536c·0x4067b1 → 0x4147b3): 표시 객체 칩 ((칩x + 1)·24, (칩y − 2)·12)를 가운데로 */
  scrollToUnit(slot: number): void {
    const s = this.units[slot]!;
    this.scrollTo((s.chipX + 1) * CHIP_W, (s.chipY - 2) * CHIP_H);
  }

  /** 새 유닛(소환 0x40f910)의 표시 객체를 들인다 */
  adopt(slot: number, sprite: MutableSprite, status: number): void {
    this.units[slot] = sprite;
    this.statuses[slot] = status & 7;
  }

  /** vmv2.exe 0x004128c8: 정리된 유닛의 표시 객체를 지운다(0x41752e) */
  drop(slot: number): void {
    const s = this.units[slot];
    if (s) s.flags |= 0x80;
    this.units[slot] = null;
  }

  /** vmv2.exe 0x00417957: 유닛 slot의 표시 객체 방향(받은 명령의 방향, 0x4067b1) */
  face(slot: number, direction: number): void {
    turnTo(this.units[slot]!, direction);
  }

  /** 유닛 slot의 표시 객체(유닛 +0x68) */
  unitSprite(slot: number): MutableSprite | null {
    return this.units[slot] ?? null;
  }

  /** vmv2.exe 0x00412ed3: 첫 끝난 칸, 없으면 끝에 */
  addEffect(effect: Effect): void {
    const i = this.effects.findIndex((e) => e.ended);
    if (i >= 0) this.effects[i] = effect;
    else this.effects.push(effect);
  }

  /**
   * vmv2.exe 0x00406d13 종류 1의 연출(0x413820 → 0x45f8d0[행동 +0xc], 0x402954): state는 주체가 이동·방향을 마친 상태, trace는 엔진이 같은 명령에 남긴 타격 기록.
   * 타격마다 onHit(창 갱신 0x40aee4), 연출이 모두 끝난 틱에 then(행동 뒤 흐름 0x406045)
   */
  act(data: EngineData, state: GameState, actor: number, action: number, target: Cell, trace: readonly StrikeRecord[], onHit: (r: StrikeRecord) => void, then: () => void): Attack {
    this.state = state;
    this.grid = workGrid(this.art.map, state);
    const effects = [...this.effects];
    let attack: Attack;
    try {
      attack = startAct(this, data, state, actor, action, target, trace, onHit);
    } catch (e) {
      this.effects = effects; // 걸다 만 연출 객체(빈 스크립트)가 다음 틱에 다시 예외를 내지 않게
      throw e;
    }
    this.then = then;
    this.flash.reset(); // 0x402954: 0x41b117, 어두운 칸을 밝은 사본으로
    this.setShade('bright', state.timeOfDay);
    return attack;
  }

  /** 유닛 slot 표시 객체의 자세(상태 창 초상, 0x40d056) */
  poseOf(slot: number): number | undefined {
    return this.units[slot]?.pose;
  }

  /** 연출 객체가 남아 있다(입력을 막는다) */
  busy(): boolean {
    return this.effects.some((e) => !e.ended);
  }

  /** vmv2.exe 0x00403020의 화면 부분: 48ms 한 틱. 상태 창 그림을 다시 그릴 틱(0x40aff3)이면 true */
  tick(): boolean {
    if (this.options & 1) this.sky = skyTick(this.art.sheet.sky, this.sky);
    let pictures = false;
    let done: boolean;
    if (++this.b20 < 2) done = this.frame(false, false);
    else {
      this.b20 = 0;
      this.cursorFrame = this.cursorFrame + 1 > 4 ? 0 : this.cursorFrame + 1;
      if (this.cursorOn) this.cursor.pose = this.cursorFrame + 13;
      if (++this.ba8 < 2) done = this.frame(true, false);
      else {
        this.ba8 = 0;
        if (this.options & 2) this.water = (this.water + 1) % 4;
        pictures = (this.options & 6) !== 0;
        done = this.frame(true, true);
      }
    }
    if (done) {
      const then = this.then;
      this.then = null;
      then?.();
    }
    this.flash.tick(); // 0x41b421 → 0x402785
    return pictures;
  }

  // vmv2.exe 0x00412f6d: 연출 객체 처리기(부른 뒤 처음부터 다시 훑는다), 이어 표시 객체 종류별 애니메이션. 살아 있던 연출이 이 틱에 모두 끝나면 true
  private frame(p1: boolean, p2: boolean): boolean {
    for (const e of this.effects) e.flags &= ~2;
    let active = false;
    for (let i = 0; i < this.effects.length; ) {
      const e = this.effects[i];
      if (e.ended || e.flags & 2) {
        i++;
        continue;
      }
      e.flags |= 2;
      if (p2 || (p1 && !(e.flags & 0x10)) || !(e.flags & 0x18)) e.run(p1, p2);
      active = true;
      i = 0;
    }
    for (const s of this.pool) {
      if (s.flags & 0x80) continue;
      switch (s.kind) {
        case 2: // 데미지 숫자 튀어 오름(0x412c14): 틱마다 높이 10, 7, 4, 2, 1, −1, −1, −2, 0x1c째에 지움
          if (s.counter === 0x1c) s.flags |= 0x80;
          else if (s.counter >= 1 && s.counter <= 8) nudge(s, 0, 0, BOUNCE[s.counter - 1], this.art.map, this.grid);
          s.counter = (s.counter + 1) & 0xff;
          break;
        case 1: // 대기
          if (p2 && (this.options & 4 || ((s.counter >> 1) & 1) === 0)) stepFrame(s);
          break;
        case 3: // 차례·범위 표식 돌기
          if (p1) {
            s.counter++;
            s.pose++;
            if (s.counter > 7) {
              s.pose -= s.counter;
              s.counter = 0;
            }
          }
          break;
        case 5: // 범위 표식 흔들기
          if (p2) {
            s.counter = s.counter + 1 > 3 ? 0 : s.counter + 1;
            s.pose += s.counter === 0 || s.counter === 3 ? -1 : 1;
          }
          break;
        case 6: // 차례 유닛 깜빡임(색 바꿈 선택 위 두 비트)
          if (p1) {
            const b = s.counter & 3;
            s.tint = b === 0 ? s.tint & 0x3f : b === 2 ? (s.tint & 0xbf) | 0x80 : (s.tint & 0x7f) | 0x40;
            s.counter = s.counter + 1 > 7 ? 0 : s.counter + 1;
            setFrame(s);
          }
          break;
        // 4 상대 차례 표식(난수 0x4136da)은 네트워크
      }
      if (s.overlay !== 0 && p2 && this.options & 4) s.overlayFrame = (s.overlayFrame + 1) & 3;
    }
    if (!active || this.busy()) return false;
    this.effects = [];
    return true;
  }
}
