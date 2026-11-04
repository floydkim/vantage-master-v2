// 명령 적용(스펙 §8). 명령은 늘 지금 차례 유닛의 것이다. 규칙에 어긋나면 상태를 그대로 두고 { ok: false, reason }을,
// 원작이 정의되지 않은 동작을 하는 경로(연출 스크립트가 없는 마법 16~19 등)는 예외를 던진다.
import type { Command } from './command.ts';
import type { GameState } from './state.ts';
import type { TurnStep } from './rules/turn.ts';
import { applyCommand, type CommandSource, type EngineData, RuleViolation, type StrikeRecord, type TurnResult } from './turn.ts';

export type ApplyResult = ({ readonly ok: true } & TurnResult) | { readonly ok: false; readonly reason: string };

export function apply(data: EngineData, state: GameState, command: Command, source: CommandSource = 'ui', trace?: StrikeRecord[], steps?: TurnStep[]): ApplyResult {
  try {
    return { ok: true, ...applyCommand(data, state, command, source, trace, steps) };
  } catch (e) {
    if (e instanceof RuleViolation) return { ok: false, reason: e.message };
    throw e;
  }
}
