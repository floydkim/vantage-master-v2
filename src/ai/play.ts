// CPU 차례 진행 도우미. 진영 제어(진영 상태 +0x00)가 CPU면 생각(0x445b20)한 명령을 엔진 apply로 실행하고(원작은 받은 메시지 경로
// 0x406573로 실행), 생각 사이 AI 기억을 이어 간다. 사람 차례가 되거나 전투가 끝나면 멈춘다.
import { apply } from '../engine/apply.ts';
import type { Command } from '../engine/command.ts';
import { natialOf } from '../engine/rules/summon.ts';
import { type GameState, MASTERS, unitOf } from '../engine/state.ts';
import type { TurnStep } from '../engine/rules/turn.ts';
import type { StrikeRecord, TurnResult } from '../engine/turn.ts';
import { type AiMemory, cpuCommand, type ThinkingPattern } from './think.ts';
import type { AiData } from './world.ts';

const CPU = 1;

/** apply 뒤의 AI 기억: 사라진 칸은 null, 새로 소환한 칸은 처음 가중치(0x40f910: +0x60 = +0x64 = 표 +0x4c), 나머지는 그대로.
 *  CPU 차례(cpuTurn)뿐 아니라 사람 명령의 apply 뒤에도 불러야 한다. 빠뜨리면 비웠다가 다시 소환한 칸에 옛 가중치가 남아
 *  다음 CPU 생각이 오류 없이 원작과 갈라진다 */
export function memoryAfterApply(data: AiData, before: GameState, after: GameState, memory: AiMemory): AiMemory {
  const weights = after.units.map((u, i) => {
    if (!u) return null;
    if (before.units[i]) return memory.weights[i] ?? null; // 한 번의 apply 안에서는 비운 칸을 소환이 다시 쓰지 않는다(소환이 쓰러짐 정리보다 먼저)
    if (i < MASTERS) throw new Error(`마스터 칸 ${i}이 새로 생겼습니다`);
    const w = natialOf(data.natials, u.type).aiWeight;
    return { w60: w, w64: w };
  });
  return { ...memory, weights };
}

/** 지금 차례 유닛을 CPU로 생각해 두고, 다음 차례 결과와 이어 간 기억을 돌려준다. apply가 거부하면 버그라 오류. trace는 타격 기록(apply) */
export function cpuTurn(
  data: AiData,
  turn: { readonly state: GameState; readonly actor: number },
  pattern: ThinkingPattern,
  memory: AiMemory,
  trace?: StrikeRecord[],
  steps?: TurnStep[],
): { command: Command; result: TurnResult; memory: AiMemory } {
  const thought = cpuCommand(data, turn.state, turn.actor, pattern, memory);
  const r = apply(data, turn.state, thought.command, 'received', trace, steps);
  if (!r.ok) throw new Error(`CPU 명령을 엔진이 거부했습니다(${r.reason}): ${JSON.stringify(thought.command)}`);
  return { command: thought.command, result: r, memory: memoryAfterApply(data, turn.state, r.state, thought.memory) };
}

/** 진영 제어가 CPU인 차례를 사람 차례나 전투 끝까지 둔다. beforeThink는 생각 전 기억을 바꿀 기회(연출이 쓴 난수·그림 읽기) */
export function playUntilHuman(
  data: AiData,
  result: TurnResult,
  pattern: ThinkingPattern,
  memory: AiMemory,
  beforeThink: (memory: AiMemory, turn: { readonly state: GameState; readonly actor: number }) => AiMemory = (m) => m,
): { result: TurnResult; memory: AiMemory; commands: Command[] } {
  const commands: Command[] = [];
  while (!('winner' in result) && result.state.sideStates[unitOf(result.state, result.actor).side].controller === CPU) {
    const t = cpuTurn(data, result, pattern, beforeThink(memory, result));
    commands.push(t.command);
    result = t.result;
    memory = t.memory;
  }
  return { result, memory, commands };
}
