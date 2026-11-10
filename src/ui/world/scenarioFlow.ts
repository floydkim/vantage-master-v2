// 시나리오 흐름의 갈림: 결과 창 END(vmv2.exe 0x00408034)가 통계·진행을 하고 장면 창으로 갈지 정한다. 해독 메모 re/scenario.md
import { accumulateStats, progressScenario, type ScenarioData } from '../../engine/scenario.ts';
import type { GameState } from '../../engine/state.ts';
import type { WorldSettings } from './WorldScene.tsx';

/** 전투 끝 블록에서 0x41bd98이 읽는 것: +0xbac 누적 분, 진영 상태 0 +0xc(− 2를 넘김), 진영 0 결과 창 통계 0x39칸 */
export interface BattleTally {
  readonly elapsed: number;
  readonly stones: number;
  readonly stats: readonly number[];
}

export const tallyOf = (state: GameState): BattleTally => ({ elapsed: state.elapsedMinutes, stones: state.sideStates[0].mpMultiplier - 2, stats: state.stats[0] });

/**
 * 타이틀로 갈 때 묻기. 월드(vmv2.exe 0x00451bbb(1))는 시나리오면(+0x8) 0x42e92b(대화 상자 0x84, 게임 데이터 저장 질문),
 * 결과 창(0x00407ff9(1))은 시나리오면 0x42e7f7(예/아니오 "Do you wish to abbandon the game?"). 프리는 묻지 않는다
 */
export function titlePrompt(from: 'world' | 'result', scenario: boolean): 'saveGameData' | 'abandon' | null {
  if (!scenario) return null;
  return from === 'world' ? 'saveGameData' : 'abandon';
}

/**
 * vmv2.exe 0x00408034: 시나리오이고 진영 0이 이겼으면(0x476bd4 = 0) 통계를 더하고(0x41bd98) 진행한다(0x45157b: 깬 맵, 묶음 열기, 레벨 + 1·보상).
 * 장면 종류가 −1이 아니면 장면 창(0x41beb4 → 0x41becb), 아니면 월드(0x44fd31). 프리·짐·비김은 그대로 월드
 */
export function afterBattle(data: ScenarioData, settings: WorldSettings, winner: number, tally: BattleTally): { settings: WorldSettings; scene: number } {
  const s = settings.scenario;
  if (!s || winner !== 0) return { settings, scene: -1 };
  const stats = accumulateStats(s.stats, tally.elapsed, tally.stones, tally.stats);
  const r = progressScenario(data, s.flags, settings.selected, s.mode, settings.sides[0]);
  return { settings: { ...settings, sides: [r.player, settings.sides[1]], scenario: { ...s, flags: r.flags, stats } }, scene: r.scene };
}
