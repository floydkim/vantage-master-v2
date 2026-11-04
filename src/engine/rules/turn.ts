// 차례 진행. vmv2.exe 0x0040536c: 쓰러진 네이티얼 정리(0x412843) → 차례 받을 유닛 고르기(0x4129fb) → 그만큼 시간 진행(0x4022d7).
// MP가 모자라 네이티얼을 없앴으면 원작은 사라지는 연출 뒤 처음부터 다시 한다.
import type { NatialType } from '../../formats/natialTable.ts';
import { type GameState, MASTERS, type Mutable, type SideState, type UnitRecord, unitOf } from '../state.ts';
import { advanceTime, upkeepOf } from './time.ts';

const MAX_WAIT = 0xb40;

export interface TurnStart {
  readonly state: GameState;
  /** 차례를 받은 유닛(state.units의 번호) */
  readonly actor: number;
}

// vmv2.exe 0x00412843 + 0x004128c8: HP가 1 미만인 네이티얼을 유닛 표 순서대로 없애고 칸을 비운다(null). 마스터는 남기고 anyDead로만 알린다
export function removeDead(state: GameState, natials: readonly NatialType[]): { state: GameState; anyDead: boolean } {
  const units: (Mutable<UnitRecord> | null)[] = state.units.map((u) => u && { ...u });
  const sideStates: Mutable<SideState>[] = state.sideStates.map((s) => ({ ...s }));
  let anyDead = false;
  for (const [index, dead] of units.entries()) {
    if (!dead || dead.hp >= 1) continue;
    anyDead = true;
    if (index < MASTERS) continue;
    for (const u of units) if (u && dead.summonOrder < u.summonOrder) u.summonOrder--;
    sideStates[dead.side].unitCount--;
    sideStates[dead.side].upkeep -= upkeepOf(natials, dead.type);
    units[index] = null;
  }
  return { state: { ...state, units, sideStates: [sideStates[0], sideStates[1]] }, anyDead };
}

// vmv2.exe 0x004129fb: OA + 상태 이상 남은 분이 가장 작은 유닛. 같으면 소환 순번이 같거나 작은 뒤쪽 유닛
export function nextActor(state: GameState): { actor: number; wait: number } {
  let actor = -1;
  let wait = MAX_WAIT;
  state.units.forEach((u, i) => {
    if (!u) return;
    const w = u.oa + u.statusMinutes;
    if (w > wait) return;
    if (w === wait) {
      if (actor < 0) throw new Error(`대기 시간이 ${MAX_WAIT}분인 유닛을 비교할 수 없습니다(원작은 널 포인터를 읽음)`);
      if (u.summonOrder > unitOf(state, actor).summonOrder) return;
    }
    actor = i;
    wait = w;
  });
  if (actor < 0) throw new Error(`차례를 받을 유닛이 없습니다(모든 유닛의 대기 시간이 ${MAX_WAIT}분 이상)`);
  return { actor, wait };
}

/**
 * 차례 흐름 기록(연출이 원작 차례로 보이도록): 명령을 마친 상태(OA까지), 쓰러진 유닛 정리(0x412843), 마정석 점령(0x41481d), 경험치(0x4147f2),
 * 진영 몰락(0x40612c: 마스터가 쓰러진 진영의 네이티얼 HP −10), 전투 끝, 시간 진행(0x40536c → 0x4022d7: 다음 차례 유닛, MP 부족으로 없앤 칸),
 * 차례 시작 지형 효과(0x40546d). 상태는 그 단계를 마친 상태
 */
export type TurnStep =
  | { readonly kind: 'act'; readonly state: GameState }
  | { readonly kind: 'remove'; readonly state: GameState }
  | { readonly kind: 'capture'; readonly unit: number; readonly state: GameState }
  | { readonly kind: 'exp'; readonly unit: number; readonly gain: number; readonly state: GameState }
  | { readonly kind: 'fall'; readonly doomed: readonly number[]; readonly state: GameState }
  | { readonly kind: 'end'; readonly winner: number }
  | { readonly kind: 'time'; readonly actor: number; readonly victims: readonly number[]; readonly state: GameState }
  | { readonly kind: 'start'; readonly actor: number; readonly died: boolean; readonly state: GameState };

// vmv2.exe 0x0040536c
export function beginTurn(state: GameState, natials: readonly NatialType[], steps?: TurnStep[]): TurnStart {
  for (;;) {
    const removed = removeDead(state, natials);
    state = removed.state;
    if (removed.anyDead) steps?.push({ kind: 'remove', state });
    const { actor, wait } = nextActor(state);
    const advanced = advanceTime(state, natials, wait);
    state = advanced.state;
    steps?.push({ kind: 'time', actor, victims: advanced.victims, state });
    if (!advanced.deficit) return { state, actor };
  }
}
