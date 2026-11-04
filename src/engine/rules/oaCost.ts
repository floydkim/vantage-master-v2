export interface OaTables {
  readonly actionCosts: readonly number[];
  readonly speedFactors: readonly number[];
}

/** 행동을 마친 유닛의 OA(다음 차례까지 남은 시간). 속도가 클수록 작고, 이동했거나 행동 비용이 클수록 크다. */
// vmv2.exe 0x004113da: ((이동했으면 45, 아니면 30) + 행동 비용) × 속도 계수 + 128을 256으로 나눈 몫
export function oaCost(tables: OaTables, speed: number, moved: boolean, action: number): number {
  const factor = tables.speedFactors[speed];
  const cost = tables.actionCosts[action];
  if (factor === undefined) throw new RangeError(`속도 범위 밖: ${speed}`);
  if (cost === undefined) throw new RangeError(`행동 번호 범위 밖: ${action}`);
  return ((moved ? 45 : 30) + cost) * factor + 128 >> 8;
}
