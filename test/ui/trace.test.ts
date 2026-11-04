import { expect, it } from 'vitest';
import { apply } from '../../src/engine/apply.ts';
import type { Command } from '../../src/engine/command.ts';
import { decodeState } from '../../src/engine/state.ts';
import type { TurnStep } from '../../src/engine/rules/turn.ts';
import type { StrikeRecord } from '../../src/engine/turn.ts';
import { inflateBlock, readGolden } from '../engine/block.ts';
import { engineData } from './engineData.ts';
import { mapOf } from './screenCases.ts';

interface RawCommand {
  readonly to: readonly [number, number];
  readonly direction: number;
  readonly kind: number;
  readonly number: number;
  readonly target: readonly [number, number];
}
const commandOf = (c: RawCommand): Command => ({ ...c, to: { x: c.to[0], y: c.to[1] }, target: { x: c.target[0], y: c.target[1] } });
const games = readGolden<{ args: { map: number; commands: readonly RawCommand[] }; expected: { first: string; blocks: readonly string[] } }>('games');
const attacks = readGolden<{ label: string; map: number; block: string; command: RawCommand; strikes: readonly number[][]; ticks: readonly { hp: readonly (number | null)[] }[] }>('attack');

it('타격 기록을 줘도 명령 결과는 같다(게임 픽스처의 모든 명령)', () => {
  let recorded = 0;
  for (const g of games) {
    const data = engineData(mapOf(g.args.map));
    g.args.commands.forEach((c, k) => {
      const state = decodeState(inflateBlock(k ? g.expected.blocks[k - 1] : g.expected.first));
      const trace: StrikeRecord[] = [];
      const plain = apply(data, state, commandOf(c), 'received');
      expect(apply(data, state, commandOf(c), 'received', trace)).toEqual(plain);
      recorded += trace.length;
      if (c.kind !== 1) expect(trace).toEqual([]);
    });
  }
  expect(recorded).toBeGreaterThan(100);
});

it('타격 기록이 원작 타격(0x40354b) 차례·칸과 맞은 뒤 HP와 같다', () => {
  for (const c of attacks) {
    const data = engineData(mapOf(c.map));
    const trace: StrikeRecord[] = [];
    expect(apply(data, decodeState(inflateBlock(c.block)), commandOf(c.command), 'received', trace).ok, c.label).toBe(true);
    expect(trace.map((r) => [r.x, r.y]), c.label).toEqual(c.strikes.map((s) => [s[1], s[2]]));
    trace.forEach((r, i) => {
      expect(r.unit, c.label).not.toBeNull();
      expect(r.hp, `${c.label} 타격 ${i}`).toBe(c.ticks[c.strikes[i][0]].hp[r.unit!]);
    });
  }
});

const magic = readGolden<{ label: string; map: number; block: string; command: RawCommand; strikes: readonly number[][]; ticks: readonly { hp: readonly (number | null)[] }[] }>('magic');

it('마법 타격 기록이 원작과 같고, 특수(0x2b)는 물높이 필드 또는 Bless 뒤 HP를 담는다', () => {
  let specials = 0;
  for (const c of magic) {
    const data = engineData(mapOf(c.map));
    const trace: StrikeRecord[] = [];
    expect(apply(data, decodeState(inflateBlock(c.block)), commandOf(c.command), 'received', trace).ok, c.label).toBe(true);
    const hits = trace.filter((r) => !r.special);
    expect(hits.map((r) => [r.x, r.y]), c.label).toEqual(c.strikes.map((s) => [s[1], s[2]]));
    hits.forEach((r, i) => r.unit !== null && expect(r.hp, `${c.label} 타격 ${i}`).toBe(c.ticks[c.strikes[i][0]].hp[r.unit]));
    for (const r of trace.filter((r) => r.special)) {
      specials++;
      const last = c.ticks[c.ticks.length - 1].hp;
      if (r.special!.units) r.special!.units.forEach((u, i) => u && expect(u.hp, `${c.label} 유닛 ${i}`).toBe(last[i]));
      else expect(Object.keys(r.special!).sort(), c.label).toEqual(['waterLevel', 'waterMinutes', 'waterStage']);
    }
  }
  expect(specials).toBe(3);
});

it('차례 흐름 기록: 명령을 마친 상태로 시작해 다음 차례 시작(또는 전투 끝)으로 끝나고, 결과 상태와 같다', () => {
  let kinds = new Set<string>();
  for (const g of games) {
    const data = engineData(mapOf(g.args.map));
    g.args.commands.forEach((c, k) => {
      const state = decodeState(inflateBlock(k ? g.expected.blocks[k - 1] : g.expected.first));
      const steps: TurnStep[] = [];
      const r = apply(data, state, commandOf(c), 'received', undefined, steps);
      if (!r.ok) return;
      steps.forEach((s) => kinds.add(s.kind));
      expect(steps[0].kind).toBe('act');
      const last = steps[steps.length - 1];
      if ('winner' in r) expect(last).toEqual({ kind: 'end', winner: r.winner });
      else expect(last).toEqual({ kind: 'start', actor: r.actor, died: false, state: r.state });
    });
  }
  expect([...kinds].sort()).toEqual(['act', 'capture', 'end', 'exp', 'fall', 'remove', 'start', 'time']);
});
