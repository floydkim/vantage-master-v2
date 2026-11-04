import { describe, expect, it } from 'vitest';
import { readScenarioData, type ScenarioMode } from '../../src/engine/scenario.ts';
import { decodeState, STATE_SIZE } from '../../src/engine/state.ts';
import { readMasterTable } from '../../src/formats/masterTable.ts';
import { afterBattle, tallyOf, titlePrompt } from '../../src/ui/world/scenarioFlow.ts';
import { readGolden } from '../engine/block.ts';
import { exe } from './screenCases.ts';

// 원작 결과 창 END(0x408034). 재생성: pnpm oracle scenario_world
interface Case {
  readonly kind: string;
  readonly args: { mode: ScenarioMode; flags: number[]; selected: number; winner: number; stats: number[]; days: number; side: string };
  readonly expected: { next: number; kind: number; called: string[]; flags: number[]; stats: number[]; side: string };
}
const cases = readGolden<Case>('scenarioWorld').filter((c) => c.kind === 'end');
const data = { masters: readMasterTable(exe), ...readScenarioData(exe) };
const sideOf = (hex: string) => {
  const block = new Uint8Array(STATE_SIZE);
  block.set(Buffer.from(hex, 'hex'), 0x18);
  return decodeState(block).sides[0];
};

describe('결과 END(0x408034)', () => {
  it('이기면 통계 누적(0x41bd98)·진행(0x45157b), 장면이면 장면 창(0x41bec1) 아니면 월드. 지거나 비기면 그대로 월드 — 깬 맵 다시·맵 26·맵 29·Expert 30·37', () => {
    for (const c of cases) {
      const player = sideOf(c.args.side);
      const settings = {
        sides: [player, player] as const,
        controllers: [0, 1] as const,
        timeLimit: 3,
        selected: c.args.selected,
        scenario: { mode: c.args.mode, flags: c.args.flags, stats: new Array<number>(59).fill(0) },
      };
      const r = afterBattle(data, settings, c.args.winner, { elapsed: c.args.stats[0], stones: c.args.days, stats: c.args.stats.slice(1, 1 + 57) });
      const label = JSON.stringify({ mode: c.args.mode, selected: c.args.selected, winner: c.args.winner });
      expect(r.scene, label).toBe(c.expected.next === 0x41bec1 ? c.expected.kind : -1);
      expect(c.expected.called.includes('world'), label).toBe(r.scene === -1);
      expect(r.settings.scenario!.flags, label).toEqual(c.expected.flags);
      expect(r.settings.scenario!.stats, label).toEqual(c.expected.stats);
      expect(r.settings.sides[0], label).toEqual(sideOf(c.expected.side));
    }
  });

  it('타이틀로 갈 때 묻기: 월드(0x451bbb(1))는 시나리오면 게임 데이터 저장(0x84), 결과 창(0x407ff9(1))은 시나리오면 버릴지(예/아니오), 프리는 묻지 않음', () => {
    expect([titlePrompt('world', true), titlePrompt('world', false), titlePrompt('result', true), titlePrompt('result', false)]).toEqual(['saveGameData', null, 'abandon', null]);
  });
});

it('전투 끝 블록에서 0x41bd98에 넘기는 것: +0xbac 누적 분, 진영 상태 0 +0xc − 2, 진영 0 결과 창 통계', () => {
  const state = decodeState(new Uint8Array(STATE_SIZE));
  const stats0 = state.stats[0].map((_, k) => k + 1);
  const s = { ...state, elapsedMinutes: 90, sideStates: [{ ...state.sideStates[0], mpMultiplier: 5 }, state.sideStates[1]] as typeof state.sideStates, stats: [stats0, state.stats[1]] as typeof state.stats };
  expect(tallyOf(s)).toEqual({ elapsed: 90, stones: 3, stats: stats0 });
});
