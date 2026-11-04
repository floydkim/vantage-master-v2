// 프리 배틀 한 판의 진행(DOM 없음). 차례 유닛 진영의 제어(진영 상태 +0x00)가 사람(0)이면 입력 세션을 두고, CPU(1)면 생각(③a)으로 둔다.
// 사람 명령도 CPU 명령처럼 apply 뒤 AI 기억을 이어 간다(memoryAfterApply, ③a-3 계약).
import { cpuTurn, memoryAfterApply } from '../../ai/play.ts';
import { type AiMemory, initialMemory, type ThinkingPattern } from '../../ai/think.ts';
import type { AiData } from '../../ai/world.ts';
import { apply } from '../../engine/apply.ts';
import { type BattleData, type FreeBattleSetup, startFreeBattle } from '../../engine/battleStart.ts';
import type { Command } from '../../engine/command.ts';
import { type GameState, unitOf } from '../../engine/state.ts';
import type { TurnStep } from '../../engine/rules/turn.ts';
import { startTurn, type StrikeRecord, type TurnResult } from '../../engine/turn.ts';
import { type Session, startInput, type Step } from './session.ts';

const HUMAN = 0;

export interface GameSetup {
  readonly map: number;
  /** 월드 장면에서 정한 진영 레코드·조종·시간 제한 */
  readonly battle: FreeBattleSetup;
  readonly pattern: ThinkingPattern;
}

export interface Game {
  readonly data: AiData;
  readonly pattern: ThinkingPattern;
  readonly result: TurnResult;
  readonly memory: AiMemory;
  /** 사람 차례의 입력 세션. CPU 차례나 승패가 나면 null */
  readonly session: Session | null;
}

export function whoseTurn(g: Pick<Game, 'result'>): 'human' | 'cpu' | 'over' {
  if ('winner' in g.result) return 'over';
  const side = unitOf(g.result.state, g.result.actor).side;
  return g.result.state.sideStates[side].controller === HUMAN ? 'human' : 'cpu';
}

const withSession = (g: Game): Game => ({ ...g, session: 'winner' in g.result || whoseTurn(g) !== 'human' ? null : startInput(g.result) });

/** 새 전투(진영 0 사람·1 CPU, 0x450ed7)의 첫 차례. seed는 CPU 생각의 난수 상태 */
export function startGame(data: AiData, battle: BattleData, setup: GameSetup, seed: number): Game {
  const result = startTurn(data, startFreeBattle(battle, data.map, setup.battle));
  return withSession({ data, pattern: setup.pattern, result, memory: initialMemory(data, result.state, seed), session: null });
}

/** 되살리기(0x401899 → 0x401b12 → 0x40536c): 저장 블록의 상태로 같은 차례 입력 대기(지형 효과는 이미 줬다). AI 기억은 처음 값(스펙: 되살리면 initialMemory) */
export function resumeGame(data: AiData, state: GameState, pattern: ThinkingPattern, seed: number): Game {
  const result = startTurn(data, state);
  return withSession({ data, pattern, result, memory: initialMemory(data, result.state, seed), session: null });
}

/** 사람 입력 한 번. 명령이 있으면 실행하고 다음 차례로. UI가 만든 명령을 엔진이 거부하면 버그라 예외(스펙 §6). trace는 타격 기록(apply) */
export function humanStep(g: Game, step: Step, trace?: StrikeRecord[], steps?: TurnStep[]): Game {
  if (!g.session || 'winner' in g.result) throw new Error('사람 차례가 아닙니다');
  if (!step.command) return { ...g, session: step.session };
  const before = g.result.state;
  const r = apply(g.data, before, step.command, 'ui', trace, steps);
  if (!r.ok) throw new Error(`UI가 만든 명령을 엔진이 거부했습니다(${r.reason}): ${JSON.stringify(step.command)}`);
  return withSession({ ...g, result: r, memory: memoryAfterApply(g.data, before, r.state, g.memory) });
}

/** CPU 차례 하나. trace는 타격 기록(apply) */
export function cpuStep(g: Game, trace?: StrikeRecord[], steps?: TurnStep[]): { game: Game; command: Command } {
  if (whoseTurn(g) !== 'cpu' || 'winner' in g.result) throw new Error('CPU 차례가 아닙니다');
  const t = cpuTurn(g.data, g.result, g.pattern, g.memory, trace, steps);
  return { game: withSession({ ...g, result: t.result, memory: t.memory }), command: t.command };
}

/** 원작이 시작 때 두는 난수 시드(0x452ecf): GetSystemTime의 분 × 60000 + 초 × 1000 + 밀리초 */
export const seedFromClock = (d: Date): number => d.getUTCMinutes() * 60000 + d.getUTCSeconds() * 1000 + d.getUTCMilliseconds();
