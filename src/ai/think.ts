// CPU AI 진입점. vmv2.exe 0x00445b20: 분석 격자 x·y, 진영 분석(0x44b207), 생각 가중치(0x445d57), 떠 두기(0x44ba74),
// 결정 가중치(0x446106), 결정(0x446434 또는 No Guard 네이티얼 0x4462ef), 되돌리기(0x44bb31), 명령 메시지(0x406573에 넘김).
import { type Command, decodeCommand } from '../engine/command.ts';
import type { GameState } from '../engine/state.ts';
import { type AiWeight, analyzeSide, decideWeights, initialWeights, thinkWeights } from './analysis.ts';
import { decideNoGuard, decideStandard } from './decide.ts';
import { CELLS, DIRECTION, KIND, Mind, NUMBER, RECORD, TARGET_X, TARGET_Y, X, Y } from './mind.ts';
import { type AiData, World } from './world.ts';

/** 원작 옵션 "CPU's thinking pattern": Standard ver.2.0, No Guard(옵션 0x503ff0 비트 8) */
export type ThinkingPattern = 'standard' | 'noGuard';

/** 블록 밖의 AI 기억. 원작은 저장하지 않고 전투 시작·되살리기 때 처음 값으로 돌아간다 */
export interface AiMemory {
  /** C 런타임 난수 상태(0x475da0). 연출 프레임도 소비한다 */
  readonly seed: number;
  /** 유닛 표 칸마다 +0x60·+0x64 */
  readonly weights: readonly (AiWeight | null)[];
  /** AI 작업 버퍼(0x43ff60, i32) */
  readonly arena: Int32Array;
}

/** 전투 시작·되살리기 직후의 AI 기억: 가중치는 소환·되살리기 값, 작업 버퍼는 맵 AI 자료(0x44c8c3) */
export function initialMemory(data: AiData, state: GameState, seed: number): AiMemory {
  return { seed: seed >>> 0, weights: initialWeights(data, state), arena: data.mapAi.ints.slice() };
}

/** 입력 대기 상태에서 actor(state.units 칸) 차례의 CPU 명령과 바뀐 AI 기억 (vmv2.exe 0x00445b20) */
export function cpuCommand(data: AiData, state: GameState, actor: number, pattern: ThinkingPattern, memory: AiMemory): { command: Command; memory: AiMemory } {
  // 원작은 소환(0x40f910)·되살리기 때 가중치를 쓰고 생각은 풀기 네이티얼 뒤 칸의 값을 그대로 둔다. 없으면 이어 간 기억이 틀린 것이다
  state.units.forEach((u, i) => {
    if (u && !memory.weights[i]) throw new Error(`유닛 표 ${i}번 칸의 AI 가중치가 기억에 없습니다(소환한 칸은 처음 가중치를 넣어야 함)`);
  });
  const arena = memory.arena.slice();
  for (let i = 0; i < CELLS; i++) {
    arena[i * RECORD + X] = i & 31;
    arena[i * RECORD + Y] = i >> 5;
  }
  const sides = [analyzeSide(data, state, 0), analyzeSide(data, state, 1)];
  const think = thinkWeights(data, state, actor, memory.weights);
  const world = new World(data, state, think);
  world.save();
  decideWeights(data, state, think).forEach((v, i) => {
    const u = world.units[i];
    if (u && v) {
      u.w60 = v.w60;
      u.w64 = v.w64;
    }
  });
  const m = new Mind(
    world,
    arena,
    actor,
    memory.seed,
    sides.map((s) => s.score),
    sides.map((s) => s.statusThreat),
  );
  if (!m.actor.natial || pattern === 'standard') decideStandard(m);
  else decideNoGuard(m);
  const D = m.decision;
  const a = (D[X] & 0x1f) | ((D[Y] & 0x1f) << 5) | ((D[DIRECTION] & 7) << 10) | ((D[KIND] & 7) << 13);
  const b = (D[NUMBER] & 0x3f) | ((D[TARGET_X] & 0x1f) << 6) | ((D[TARGET_Y] & 0x1f) << 11);
  return { command: decodeCommand(a, b), memory: { seed: m.seed, weights: think, arena } };
}
