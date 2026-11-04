import type { Light } from '../../formats/natialTable.ts';

export interface LightMap {
  /** 맵 구조체 +0x34가 0이 아님: 시각에 따라 밝기가 바뀐다(맵 정보 표시 "Bright Change", 0x468c4c) */
  readonly lightChanges: boolean;
  /** 맵 구조체 +0x38: 밝기가 바뀌지 않는 맵의 고정 밝기("Always blurry/bright/dark" 표 0x468b84의 칸) */
  readonly fixedLight: Light;
}

/** 하루 중 시각(분)의 밝기. 범위 밖 값도 원작처럼 비교만 한다. */
// vmv2.exe 0x00402272: 4:00 전·20:00 이후 밤, 8:00~15:59 낮, 나머지 희미함
export function lightPhase(minuteOfDay: number, map: LightMap): Light {
  if (!map.lightChanges) return map.fixedLight;
  if (minuteOfDay < 240 || minuteOfDay > 1199) return 2;
  if (minuteOfDay < 480 || minuteOfDay > 959) return 0;
  return 1;
}
