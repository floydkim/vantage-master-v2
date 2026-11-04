import { isDeepStrictEqual } from 'node:util';
import { expect, it } from 'vitest';
import type { Cell } from '../../src/engine/command.ts';
import { nextActor } from '../../src/engine/rules/turn.ts';
import { decodeState, type GameState, unitOf } from '../../src/engine/state.ts';
import { NO_OVERLAY, type UiOverlay } from '../../src/ui/battle/overlay.ts';
import { overlayOf, press, type Session, startInput } from '../../src/ui/battle/session.ts';
import { drawBattle, loadBattleArt } from '../../src/ui/battle/screen.ts';
import { decodeSprite } from '../../src/ui/battle/sprites.ts';
import { Stage, walkSteps } from '../../src/ui/battle/stage.ts';
import { inflateBlock, readGolden } from '../engine/block.ts';
import { engineData } from './engineData.ts';
import { pixelOf } from './pixels.ts';
import { crcRows, differentRows, exe, mapOf, read } from './screenCases.ts';

interface Tick {
  readonly pool: readonly string[];
  readonly b20: number;
  readonly ba8: number;
  readonly cursorFrame: number;
  readonly water: number;
  readonly skyScroll: readonly number[];
  readonly phase: number;
  readonly field?: readonly number[];
}
interface WalkCase {
  readonly label: string;
  readonly map: number;
  readonly block: string;
  readonly to: readonly [number, number];
  /** 단계 1의 8째 틱 앞 마우스 이동(0x403d7b)이 고른 칸(칸 밖이면 null) */
  readonly pointer?: readonly [number, number] | null;
  /** CPU 결정 처리(0x406573)로 걷는 경우: idle은 차례 표식·단계 0, ranged 없음, 마지막 틱에 이어 하기(0x4067b1) */
  readonly cpu?: true;
  readonly idle: readonly Tick[];
  readonly ranged?: readonly Tick[];
  readonly walk: readonly Tick[];
}
const cases = readGolden<WalkCase>('walk');

it('픽스처가 걷기와 비행, 내리막, 지형 0xb 위 비행, 커서 이동, CPU 이동을 담는다', () => {
  expect(cases.filter((c) => c.cpu).length).toBe(2);
  expect(cases.some((c) => c.pointer)).toBe(true);
  const flying = cases.filter((c) => {
    const state = decodeState(inflateBlock(c.block));
    const data = engineData(mapOf(c.map));
    const actor = nextActor(state).actor;
    return walkSteps(data, state, actor, { x: c.to[0], y: c.to[1] }).flying;
  });
  expect(flying.length).toBeGreaterThan(0);
  expect(flying.length).toBeLessThan(cases.length);
});

// 원작 생성기와 같은 차례: 되살리기(차례 시작 0x403c8e) → 입력 시작 단계 1 → 16틱(8째 앞 마우스 이동) → 차례 유닛 골라 단계 2 → 8틱 → 이동(0x406c5b: 단계 0, 걷기) → 단계 3까지 틱.
// CPU 경우: 차례 표식·단계 0으로 8틱 → CPU 결정 처리(0x406573: 표식 지움·단계 0) → 걷기 → 이어 하기 틱까지
it('연출 틀이 틱마다 원작 풀·타이머와 같다(대기 애니메이션, 표식, 걷기, 이어 하기)', () => {
  const wrong: string[] = [];
  for (const c of cases) {
    const map = mapOf(c.map);
    const data = engineData(map);
    const art = loadBattleArt(exe, read, map);
    const state = decodeState(inflateBlock(c.block));
    const frozen = JSON.stringify(state);
    const actor = nextActor(state).actor;
    const a = unitOf(state, actor);
    const home = { x: a.x, y: a.y };
    const to = { x: c.to[0], y: c.to[1] };
    const stage = new Stage(art, state);
    stage.startTurn(home);
    let phase = 1;
    let shown: { state: GameState; overlay: UiOverlay } = { state, overlay: NO_OVERLAY };
    const show = (s: Session | null, at: GameState, cursor: Cell | null, on: boolean) => {
      const overlay = s ? overlayOf(data, s, 0) : NO_OVERLAY;
      stage.show(at, overlay, cursor, on);
      shown = { state: at, overlay };
    };
    const check = (t: Tick, where: string) => {
      if (wrong.length > 20) return;
      const want = t.pool.map((h) => decodeSprite(Buffer.from(h, 'hex')));
      if (stage.pool.length !== want.length) wrong.push(`${c.label} ${where}: 풀 ${stage.pool.length}칸, 원작 ${want.length}칸`);
      want.forEach((w, i) => {
        const ours = stage.pool[i];
        if (ours && !isDeepStrictEqual({ ...ours }, w)) {
          const keys = Object.keys(w).filter((k) => (ours as unknown as Record<string, number>)[k] !== (w as unknown as Record<string, number>)[k]);
          wrong.push(`${c.label} ${where} 칸 ${i}: ${keys.map((k) => `${k} ${(ours as unknown as Record<string, number>)[k]}/${(w as unknown as Record<string, number>)[k]}`).join(', ')}`);
        }
      });
      const timer = [stage.b20, stage.ba8, stage.cursorFrame, stage.water, phase];
      const want2 = [t.b20, t.ba8, t.cursorFrame, t.water, t.phase];
      if (!isDeepStrictEqual(timer, want2)) wrong.push(`${c.label} ${where}: 타이머·단계 ${timer}/${want2}`);
      if (!isDeepStrictEqual([...stage.sky.scroll], [...t.skyScroll])) wrong.push(`${c.label} ${where}: 하늘`);
      if (t.field) {
        const overlay = { ...shown.overlay, cursor: stage.cursorView() };
        const rows = differentRows(crcRows(drawBattle(art, shown.state, { water: stage.water, sky: stage.sky }, overlay, stage.pool)), t.field);
        if (rows.length) wrong.push(`${c.label} ${where}: 칩 줄 ${rows.slice(0, 5)}`);
      }
    };

    const { steps, flying } = walkSteps(data, state, actor, to);
    if (c.cpu) {
      phase = 0;
      stage.show(state, { ...NO_OVERLAY, turnMarker: { unit: actor, remote: false } }, home, false); // 0x4055cf CPU 갈래
      shown = { state, overlay: NO_OVERLAY };
      c.idle.forEach((t, i) => {
        stage.tick();
        check(t, `CPU 생각 틱 ${i}`);
      });
      stage.decide(state);
      let continued = -1;
      stage.walk(actor, steps, flying, () => (continued = tick));
      let tick = 0;
      for (; tick < c.walk.length; tick++) {
        stage.tick();
        check(c.walk[tick], `CPU 걷기 틱 ${tick}`);
      }
      expect(continued, c.label).toBe(c.walk.length - 1);
      continue;
    }
    let cursor: Cell | null = home;
    const s1 = startInput({ state, actor });
    show(s1, state, cursor, true);
    c.idle.forEach((t, i) => {
      if (i === 7 && c.pointer !== undefined) {
        cursor = c.pointer && { x: c.pointer[0], y: c.pointer[1] };
        stage.pointer(cursor);
      }
      stage.tick();
      check(t, `단계 1 틱 ${i}`);
    });
    const s2 = press(data, s1, ...pixelOf(map, state, home)).session;
    expect(s2.phase, c.label).toBe(2);
    phase = 2;
    show(s2, state, cursor, true); // 생성기는 마우스를 옮기지 않고 단계 2로(0x40484b)
    c.ranged!.forEach((t, i) => {
      stage.tick();
      check(t, `단계 2 틱 ${i}`);
    });
    const s3 = press(data, s2, ...pixelOf(map, state, to)).session;
    expect(s3.phase, c.label).toBe(3);
    show(null, state, cursor, false); // 0x406c5b → 0x40484b(0)
    phase = 0;
    stage.walk(actor, steps, flying, () => {
      phase = 3; // 0x405fba → 0x40484b(3)
      show(s3, s3.moved, s3.cursor, s3.cursorOn);
    });
    c.walk.forEach((t, i) => {
      expect(stage.busy(), `${c.label} 걷기 틱 ${i}`).toBe(true);
      stage.tick();
      check(t, `걷기 틱 ${i}`);
    });
    expect(stage.busy(), c.label).toBe(false);
    expect(JSON.stringify(state), c.label).toBe(frozen);
  }
  expect(wrong).toEqual([]);
}, 120_000);

// 원작은 화면 이동 중(0x4147e8) 마우스 입력을 버려 이동 연출이 겹치지 않는다. 겹치더라도 새 이동이 앞 이동을 대신해 서로 당기며 멈추지 않아야 한다
it('화면 이동 연출이 겹치면 새 목표가 앞 목표를 대신한다(이동이 끝나 이어 하기가 불린다)', () => {
  const c = cases[0];
  const map = mapOf(c.map);
  const state = decodeState(inflateBlock(c.block));
  const stage = new Stage(loadBattleArt(exe, read, map), state);
  let left = 500;
  const goals: number[] = [];
  stage.scroller = (x) => {
    goals.push(x);
    left += Math.sign(x - left) * Math.min(48, Math.abs(x - left));
    return left === x;
  };
  stage.scrollTo(900, 0);
  for (let t = 0; t < 3; t++) stage.tick();
  let done = false;
  stage.scrollTo(100, 0);
  stage.continueWith(() => (done = true));
  for (let t = 0; t < 40 && !done; t++) stage.tick();
  expect(done).toBe(true);
  expect(left).toBe(100);
  expect(goals.slice(3).every((x) => x === 100)).toBe(true);
});
