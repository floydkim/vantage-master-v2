import { expect, it } from 'vitest';
import { apply } from '../../src/engine/apply.ts';
import type { Command } from '../../src/engine/command.ts';
import { nextActor } from '../../src/engine/rules/turn.ts';
import { decodeState, type GameState } from '../../src/engine/state.ts';
import { SELF_RANGE, type StrikeRecord } from '../../src/engine/turn.ts';
import { loadBattleArt } from '../../src/ui/battle/screen.ts';
import { actingState, exeScript } from '../../src/ui/battle/attack.ts';
import { Stage } from '../../src/ui/battle/stage.ts';
import { inflateBlock, readGolden } from '../engine/block.ts';
import { type EffectCase, type RawCommand, runEffect } from './effectCases.ts';
import { engineData } from './engineData.ts';
import { exe, mapOf, read } from './screenCases.ts';

const cases = readGolden<EffectCase>('attack');

it('공격 연출이 틱마다 원작 풀·타이머·HP·색 표와 같다(근접, 투사체, 쓰러짐, 마스터 쓰러짐, 팔레트 번쩍임)', () => {
  const wrong: string[] = [];
  for (const c of cases) {
    try {
      runEffect(c, 'attack', wrong);
    } catch (e) {
      wrong.push(`${c.label}: ${e instanceof Error ? e.message : e}`);
    }
  }
  expect(wrong).toEqual([]);
}, 120_000);

// 픽스처 밖의 행동도 끝까지 돌아야 한다: 게임 픽스처의 모든 행동 명령(공격·마법)을 그 앞 블록에서 걷기 없이 연출
it('게임 픽스처의 모든 행동 명령이 연출을 끝까지 마친다(예외·멈춤 없음)', () => {
  const games = readGolden<{ args: { map: number; commands: readonly RawCommand[] }; expected: { first: string; blocks: readonly string[] } }>('games');
  const wrong: string[] = [];
  let ran = 0;
  games.forEach((g, gi) => {
    const map = mapOf(g.args.map);
    const data = engineData(map);
    const art = loadBattleArt(exe, read, map);
    g.args.commands.forEach((c, k) => {
      if (c.kind !== 1) return;
      const state = decodeState(inflateBlock(k ? g.expected.blocks[k - 1] : g.expected.first));
      const command: Command = { ...c, to: { x: c.to[0], y: c.to[1] }, target: { x: c.target[0], y: c.target[1] } };
      const trace: StrikeRecord[] = [];
      expect(apply(data, state, command, 'received', trace).ok).toBe(true);
      const actor = nextActor(state).actor;
      const { to } = command;
      const moved: GameState = { ...state, units: state.units.map((u, i) => (i === actor ? { ...u!, x: to.x, y: to.y, direction: command.direction } : u)) };
      const aim = data.actions[command.number].rangeKind === SELF_RANGE ? to : command.target;
      try {
        const acting = actingState(moved, trace);
        const stage = new Stage(art, acting);
        let done = false;
        stage.act(data, acting, actor, command.number, aim, trace, () => {}, () => (done = true));
        for (let t = 0; t < 1000 && !done; t++) stage.tick();
        if (!done) wrong.push(`게임 ${gi} 명령 ${k}: 끝나지 않음`);
        ran++;
      } catch (e) {
        wrong.push(`게임 ${gi} 명령 ${k}(행동 ${c.number}): ${e instanceof Error ? e.message : e}`);
      }
    });
  });
  expect(wrong).toEqual([]);
  expect(ran).toBeGreaterThan(100);
}, 120_000);

it('연출을 거는 도중 예외가 나면 연출 객체·이어 하기를 남기지 않는다(다음 틱에 예외가 되풀이되지 않음)', () => {
  const c = cases[0];
  const map = mapOf(c.map);
  const data = engineData(map);
  const art = loadBattleArt(exe, (id) => {
    if (id >>> 16 === 2) throw new Error('DATA02.DAT을 미리 읽지 않았습니다');
    return read(id);
  }, map);
  const state = decodeState(inflateBlock(c.block));
  const actor = nextActor(state).actor;
  const command: Command = { ...c.command, to: { x: c.command.to[0], y: c.command.to[1] }, target: { x: c.command.target[0], y: c.command.target[1] } };
  const trace: StrikeRecord[] = [];
  apply(data, state, command, 'received', trace);
  const stage = new Stage(art, state);
  let continued = false;
  expect(() => stage.act(data, state, actor, command.number, command.target, trace, () => {}, () => (continued = true))).toThrow('DATA02');
  expect(stage.busy()).toBe(false);
  for (let t = 0; t < 8; t++) expect(() => stage.tick()).not.toThrow();
  expect(continued).toBe(false);
});

it('exe 스크립트는 인자 워드에 든 0x31이 아니라 명령 길이 표(0x414939)로 찾은 끝 명령 0x31까지 읽는다', () => {
  const script = new Int32Array([0x2d, 0x31, 0, 0x2c, 0x31, 7, 7]); // 0x2d n x(몫 n/10) → 0x2c → 끝
  const stage = { art: { exe: { read: () => new Uint8Array(script.buffer) } } } as unknown as Stage;
  expect([...exeScript(stage, 0)]).toEqual([0x2d, 0x31, 0, 0x2c, 0x31]);
});
