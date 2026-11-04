// 시간 진행. vmv2.exe 0x004022d7(경과 분)과 그 안의 수위 복귀(0x00425755 → 0x0042562e)를 옮겼다.
// 밝기가 바뀌면 원작은 네이티얼 능력치를 다시 계산하지만(0x40fe72) 실행 중 값이라 상태 블록에는 남지 않는다.
import type { NatialType } from '../../formats/natialTable.ts';
import { type GameState, MASTERS, type Mutable, type SideState, STAT_USED_MP, type UnitRecord } from '../state.ts';

const DAY_MINUTES = 0x5a0;
const ELAPSED_WRAP = 0x22ce0; // 99일
const NO_ORDER = 0x32; // 소환 순번 상한(유닛 50)
const DEFICIT_DAMAGE = 10;
const MAX_HP = 10;
const WATER_RETURN_MINUTES = 0x78;

export interface AdvanceResult {
  readonly state: GameState;
  /** MP가 모자라 네이티얼을 없앴다. 원작은 이때 사망 정리부터 차례 선택을 다시 한다(0x40536c) */
  readonly deficit: boolean;
  /** MP가 모자라 없앤 네이티얼 칸, 없앤 차례대로(같은 칸이 다시 나올 수 있다: 원작은 그때마다 사라짐 연출 0x41461a) */
  readonly victims: readonly number[];
}

/** 정각마다 드는 유지 MP = 소환 MP / 8 (C 나눗셈) */
export function upkeepOf(natials: readonly NatialType[], type: number): number {
  const natial = natials[type - 1];
  if (!natial) throw new RangeError(`네이티얼 종류 ${type}이 표에 없습니다`);
  return Math.trunc(natial.summonMp / 8);
}

// vmv2.exe 0x0042562e: 물높이 −1·0·1 → 단계 0·1·2와 물이 돌아올 때까지 남은 분
export function applyWaterLevel(level: number): { waterStage: number; waterMinutes: number } | null {
  if (level === -1) return { waterStage: 0, waterMinutes: WATER_RETURN_MINUTES };
  if (level === 0) return { waterStage: 1, waterMinutes: 0 };
  if (level === 1) return { waterStage: 2, waterMinutes: WATER_RETURN_MINUTES };
  return null; // 원작은 그대로 둔다
}

// vmv2.exe 0x00425755: 남은 분을 깎고, 다하면 물높이를 한 단계 보통 쪽으로 되돌린다(0x4255d0·0x4255ff)
function returnWater(state: GameState, minutes: number): Pick<GameState, 'waterLevel' | 'waterStage' | 'waterMinutes'> {
  const { waterLevel, waterStage, waterMinutes } = state;
  if (waterMinutes === 0) return { waterLevel, waterStage, waterMinutes };
  if (minutes < waterMinutes) return { waterLevel, waterStage, waterMinutes: waterMinutes - minutes };
  let level = waterLevel;
  if (waterStage === 0 && level < 1) level++;
  else if (waterStage === 2 && level > -1) level--;
  return { waterLevel: level, ...(applyWaterLevel(level) ?? { waterStage, waterMinutes: 0 }) };
}

// vmv2.exe 0x004022d7
export function advanceTime(state: GameState, natials: readonly NatialType[], minutes: number): AdvanceResult {
  const units: (Mutable<UnitRecord> | null)[] = state.units.map((u) => u && { ...u });
  const sideStates: Mutable<SideState>[] = state.sideStates.map((s) => ({ ...s }));
  const usedMp = [state.stats[0][STAT_USED_MP], state.stats[1][STAT_USED_MP]];
  for (const u of units) {
    if (!u) continue;
    if (u.statusMinutes < 1) u.oa -= minutes;
    else if (minutes < u.statusMinutes) u.statusMinutes -= minutes;
    else {
      u.oa -= minutes - u.statusMinutes;
      u.statusMinutes = 0;
      u.status &= 0xfff8;
    }
  }
  let deficit = false;
  const victims: number[] = [];
  // 원작의 희생자 변수는 함수 전체에서 하나다: 이번 훑기에서 못 찾으면 앞서 고른 유닛(다른 진영일 수도 있음)을 다시 없앤다
  let victim: Mutable<UnitRecord> | undefined;
  const hours = Math.trunc((state.timeOfDay + minutes) / 60) - Math.trunc(state.timeOfDay / 60);
  for (let h = hours; h > 0; h--) {
    for (let side = 0; side < 2; side++) {
      const s = sideStates[side];
      s.mp += state.sides[side].magic * s.mpMultiplier - s.upkeep;
      usedMp[side] += s.upkeep;
      if (s.mp < 0) {
        // 소환 순번이 작은 네이티얼부터 없앤다. HP가 이미 0인 네이티얼도(아직 정리 전) 다시 고른다
        let last = -1;
        while (s.mp < 0) {
          let best = NO_ORDER;
          let found: Mutable<UnitRecord> | undefined;
          for (const u of units.slice(MASTERS)) {
            if (u && u.side === side && u.summonOrder < best && last < u.summonOrder) {
              best = u.summonOrder;
              found = u;
            }
          }
          last = best;
          victim = found ?? victim;
          if (!victim) throw new Error(`진영 ${side}의 MP가 모자란데 없앨 네이티얼이 없습니다(원작 정의되지 않은 동작)`);
          const refund = upkeepOf(natials, victim.type);
          if (!found && refund <= 0) throw new Error(`진영 ${side}의 MP 부족이 끝나지 않습니다(원작은 멈추지 않음)`);
          victim.hp = Math.min(Math.max(victim.hp - DEFICIT_DAMAGE, 0), MAX_HP); // 0x403a62
          victims.push(units.indexOf(victim));
          s.mp += refund;
          usedMp[side] -= refund;
        }
        deficit = true;
        usedMp[side] += s.mp;
        s.mp = 0;
      } else if (state.sides[side].maxMp < s.mp) {
        s.mp = state.sides[side].maxMp;
      }
    }
  }
  return {
    state: {
      ...state,
      units,
      sideStates: [sideStates[0], sideStates[1]],
      stats: [0, 1].map((n) => state.stats[n].map((x, k) => (k === STAT_USED_MP ? usedMp[n] : x))) as [number[], number[]],
      timeOfDay: (state.timeOfDay + minutes) % DAY_MINUTES,
      elapsedMinutes: (state.elapsedMinutes + minutes) % ELAPSED_WRAP,
      ...returnWater(state, minutes),
    },
    deficit,
    victims,
  };
}
