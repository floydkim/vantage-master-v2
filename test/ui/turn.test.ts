import { isDeepStrictEqual } from 'node:util';
import { expect, it } from 'vitest';
import { apply } from '../../src/engine/apply.ts';
import { ACT, type Command, STAND_BY, SUMMON } from '../../src/engine/command.ts';
import { natialOf } from '../../src/engine/rules/summon.ts';
import { nextActor, type TurnStep } from '../../src/engine/rules/turn.ts';
import { decodeState, type GameState, unitOf } from '../../src/engine/state.ts';
import type { StrikeRecord } from '../../src/engine/turn.ts';
import { NO_OVERLAY } from '../../src/ui/battle/overlay.ts';
import { battleColors, drawBattle, loadBattleArt } from '../../src/ui/battle/screen.ts';
import { decodeSprite } from '../../src/ui/battle/sprites.ts';
import { runCommand } from '../../src/ui/battle/flow.ts';
import { Stage, walkSteps } from '../../src/ui/battle/stage.ts';
import { inflateBlock, readGolden } from '../engine/block.ts';
import { engineData } from './engineData.ts';
import { SoundLog } from './soundCases.ts';
import { crcRows, differentRows, exe, mapOf, read } from './screenCases.ts';

interface RawCommand {
  readonly to: readonly [number, number];
  readonly direction: number;
  readonly kind: number;
  readonly number: number;
  readonly target: readonly [number, number];
}
interface Tick {
  readonly pool: readonly string[];
  readonly b20: number;
  readonly ba8: number;
  readonly cursorFrame: number;
  readonly water: number;
  readonly units: readonly (readonly [number, number, number] | null)[];
  readonly dib: string | null;
  readonly field?: readonly number[];
}
interface TurnCase {
  readonly label: string;
  readonly map: number;
  readonly block: string;
  readonly command: RawCommand;
  readonly stop: 'input' | 'end';
  readonly ticks: readonly Tick[];
}
const cases = readGolden<TurnCase>('turn');

// 원작 생성기와 같은 차례: CPU 차례 표식 → 결정 처리(0x406573) → 걷기 → 0x4067b1 → 0x406d13(명령 연출) → 0x40623b(행동 뒤 흐름) → 0x40536c(다음 차례 시작)
// → 화면 이동(픽스처는 첫 틱에 끝남) → 0x40546d(입력 시작) 또는 전투 끝(0x401ec3)
it('차례 흐름 연출이 틱마다 원작과 같다(대기·점령, 소환, 되돌리기, 경험치, 쓰러짐·마스터 소멸·진영 몰락·전투 끝)', () => {
  const wrong: string[] = [];
  for (const c of cases) {
    try {
      run(c, wrong);
    } catch (e) {
      wrong.push(`${c.label}: ${e instanceof Error ? e.message : e}`);
    }
  }
  expect(wrong).toEqual([]);
}, 120_000);

function run(c: TurnCase, wrong: string[]): void {
  const map = mapOf(c.map);
  const data = engineData(map);
  const art = loadBattleArt(exe, read, map);
  const state = decodeState(inflateBlock(c.block));
  const actor = nextActor(state).actor;
  const a = unitOf(state, actor);
  const home = { x: a.x, y: a.y };
  const command: Command = { ...c.command, to: { x: c.command.to[0], y: c.command.to[1] }, target: { x: c.command.target[0], y: c.command.target[1] } };
  const trace: StrikeRecord[] = [];
  const steps: TurnStep[] = [];
  expect(apply(data, state, command, 'received', trace, steps).ok, c.label).toBe(true);
  const stage = new Stage(art, state);
  stage.startTurn(home);
  stage.show(state, { ...NO_OVERLAY, turnMarker: { unit: actor, remote: false } }, home, false);
  stage.decide(state);
  let drawn: GameState = state;
  let tick = 0;
  let end: { stop: 'input' | 'end'; tick: number } | null = null;
  const hooks = { show: (s: GameState) => (drawn = s), done: (battleEnd: boolean) => (end = { stop: battleEnd ? 'end' : 'input', tick }) };
  const go = () => runCommand(stage, data, state, actor, command, true, trace, steps, hooks);
  const { to } = command;
  if ((command.kind === STAND_BY || command.kind === ACT) && (to.x !== home.x || to.y !== home.y)) {
    const { steps: path, flying } = walkSteps(data, state, actor, to);
    stage.walk(actor, path, flying, go);
  } else go();
  const sounds = new SoundLog();
  sounds.take(stage, -1);
  let dib = '';
  for (const before = wrong.length; tick < c.ticks.length && wrong.length < before + 6; tick++) {
    const t = c.ticks[tick];
    const where = `${c.label} 틱 ${tick}`;
    stage.tick();
    sounds.take(stage, tick);
    const want = t.pool.map((h) => decodeSprite(Buffer.from(h, 'hex')));
    if (stage.pool.length !== want.length) wrong.push(`${where}: 풀 ${stage.pool.length}칸, 원작 ${want.length}칸`);
    want.forEach((w, i) => {
      const ours = stage.pool[i] as unknown as Record<string, number> | undefined;
      if (!ours || isDeepStrictEqual({ ...ours }, w)) return;
      const keys = Object.keys(w).filter((k) => ours[k] !== (w as unknown as Record<string, number>)[k]);
      wrong.push(`${where} 칸 ${i}: ${keys.map((k) => `${k} ${ours[k]}/${(w as unknown as Record<string, number>)[k]}`).join(', ')}`);
    });
    const timer = [stage.b20, stage.ba8, stage.cursorFrame, stage.water];
    if (!isDeepStrictEqual(timer, [t.b20, t.ba8, t.cursorFrame, t.water])) wrong.push(`${where}: 타이머 ${timer}`);
    const units = t.units.map((_, i) => {
      const u = drawn.units[i];
      return u ? [u.hp, u.exp, u.level] : null;
    });
    if (!isDeepStrictEqual(units, t.units)) wrong.push(`${where}: 유닛 ${JSON.stringify(units)}/${JSON.stringify(t.units)}`);
    dib = t.dib ?? dib;
    if (Buffer.from(battleColors(art, drawn, stage.shade, stage.flash, stage.shadeTime).subarray(40, 246 * 4)).toString('hex') !== dib) wrong.push(`${where}: 색 표(${stage.shade})`);
    if (t.field) {
      const rows = differentRows(crcRows(drawBattle(art, drawn, { water: stage.water, sky: stage.sky }, { ...NO_OVERLAY, cursor: stage.cursorView() }, stage.pool)), t.field);
      if (rows.length) wrong.push(`${where}: 칩 줄 ${rows.slice(0, 5)}`);
    }
  }
  const e = end as { stop: string; tick: number } | null;
  sounds.check('turn', c.label, wrong);
  if (!e || e.stop !== c.stop || e.tick !== c.ticks.length - 1) wrong.push(`${c.label}: 끝 ${JSON.stringify(e)}, 원작 ${c.stop} 틱 ${c.ticks.length - 1}`);
}

// vmv2.exe 0x00406d13 → 0x00407190: 행동·소환 연출을 건 그 호출 안에서 진영 MP를 먼저 빼고 상태 창을 다시 그린다(연출 내내 쓴 뒤 MP)
it('행동·소환 연출이 시작될 때 그리는 상태의 진영 MP는 이미 비용을 뺀 값이다(0x407190)', () => {
  const wrong: string[] = [];
  let checked = 0;
  for (const c of [...cases, ...readGolden<TurnCase>('magic')]) {
    if (c.command.kind !== ACT && c.command.kind !== SUMMON) continue;
    const map = mapOf(c.map);
    const data = engineData(map);
    const state = decodeState(inflateBlock(c.block));
    const actor = nextActor(state).actor;
    const command: Command = { ...c.command, to: { x: c.command.to[0], y: c.command.to[1] }, target: { x: c.command.target[0], y: c.command.target[1] } };
    const trace: StrikeRecord[] = [];
    const steps: TurnStep[] = [];
    if (!apply(data, state, command, 'received', trace, steps).ok) continue;
    const cost = command.kind === SUMMON ? natialOf(data.natials, command.number).summonMp : data.actions[command.number].mpCost;
    const side = unitOf(state, actor).side;
    let drawn: GameState = state;
    runCommand(new Stage(loadBattleArt(exe, read, map), state), data, state, actor, command, true, trace, steps, { show: (s) => (drawn = s), done: () => {} });
    checked++;
    if (drawn.sideStates[side].mp !== state.sideStates[side].mp - cost) wrong.push(`${c.label}: MP ${drawn.sideStates[side].mp}, 원작 ${state.sideStates[side].mp} − ${cost}`);
  }
  expect(checked).toBeGreaterThan(5);
  expect(wrong).toEqual([]);
}, 60_000);

// 픽스처 밖의 흐름도 끝까지 돌아야 한다: 게임 픽스처의 모든 명령을 걷기 없이, 그대로·MP 부족(정각 직전, MP 0, 배율 0)·모든 유닛 HP 1(차례 시작 지형으로 쓰러짐)·사람 확정으로
it('게임 픽스처의 모든 명령이 차례 흐름을 끝까지 마친다(예외·멈춤 없음, 끝 종류가 엔진 결과와 같음)', () => {
  const games = readGolden<{ args: { map: number; commands: readonly RawCommand[] }; expected: { first: string; blocks: readonly string[] } }>('games');
  const wrong: string[] = [];
  const seen = { victims: 0, died: 0, kinds: new Set<number>() };
  games.forEach((g, gi) => {
    const map = mapOf(g.args.map);
    const data = engineData(map);
    const art = loadBattleArt(exe, read, map);
    g.args.commands.forEach((c, k) => {
      const block = decodeState(inflateBlock(k ? g.expected.blocks[k - 1] : g.expected.first));
      const variants: GameState[] = [
        block,
        { ...block, timeOfDay: 59, sideStates: [{ ...block.sideStates[0], mp: 0, mpMultiplier: 0 }, { ...block.sideStates[1], mp: 0, mpMultiplier: 0 }] },
        { ...block, units: block.units.map((u) => u && { ...u, hp: 1 }) },
      ];
      variants.forEach((state, v) => flow(gi, k, v, state, c, data, art, true));
      flow(gi, k, 3, block, c, data, art, false); // 사람 확정(0x406d13 바로)
    });
  });
  function flow(gi: number, k: number, v: number, state: GameState, c: RawCommand, data: ReturnType<typeof engineData>, art: ReturnType<typeof loadBattleArt>, received: boolean): void {
    {
      const command: Command = { ...c, to: { x: c.to[0], y: c.to[1] }, target: { x: c.target[0], y: c.target[1] } };
      const trace: StrikeRecord[] = [];
      const steps: TurnStep[] = [];
      let r: ReturnType<typeof apply>;
      try {
        r = apply(data, state, command, 'received', trace, steps);
      } catch {
        return; // 고친 상태가 원작 정의되지 않은 동작(없앨 네이티얼 없는 MP 부족)
      }
      if (!r.ok) return;
      seen.kinds.add(c.kind);
      seen.victims += steps.filter((s) => s.kind === 'time' && s.victims.length).length;
      seen.died += steps.filter((s) => s.kind === 'start' && s.died).length;
      try {
        const stage = new Stage(art, state);
        let end: boolean | null = null;
        runCommand(stage, data, state, nextActor(state).actor, command, received, trace, steps, { show: () => {}, done: (battleEnd) => (end = battleEnd) });
        for (let t = 0; t < 3000 && end === null; t++) stage.tick();
        if (end === null) wrong.push(`게임 ${gi} 명령 ${k} 경우 ${v}: 끝나지 않음`);
        else if (end !== 'winner' in r) wrong.push(`게임 ${gi} 명령 ${k} 경우 ${v}: 끝 종류 ${end}`);
      } catch (e) {
        wrong.push(`게임 ${gi} 명령 ${k} 경우 ${v}(종류 ${c.kind}): ${e instanceof Error ? e.message : e}`);
      }
    }
  }
  expect(wrong).toEqual([]);
  expect([...seen.kinds].sort()).toEqual([0, 1, 2]);
  expect(seen.victims).toBeGreaterThan(0);
  expect(seen.died).toBeGreaterThan(0);
}, 300_000);
