// 맵별 AI 표. vmv2.exe 0x0044c8c3: 리소스(표 0x460634[맵] = DATA10 0xac + 맵 × 2, 0x320c8바이트)를 읽어 네 표로 나눈다.
// 층은 25개다: 0층은 마스터, 1~24층은 네이티얼 종류(자료가 없을 때 계산하는 0x44c5a2 기준). 층마다 i32 32×32(행 우선, 칸 = y × 32 + x).
// penalty(0x4ead6c): 그 유닛이 멈출 수 없는 칸 −5000, 지형 종류 5 칸은 −3 × 가중치(0x44c2d5·0x44c4fa).
// value(0x4d1c70): 칸마다 자리 값을 층 최댓값 기준 1024로 맞춘 것. penaltyMax(0x4ceff0)·valueMax(0x503d70)는 층마다 최댓값.
import type { VmDat } from './vmFiles.ts';

export const AI_LAYERS = 25;
const LAYER = 32 * 32;
const SIZE = 0x320c8;
const FIRST_ENTRY = 0xac;

export interface MapAi {
  /** 자료 전체(i32). 원작은 이것을 AI 작업 버퍼(0x43ff60)에 읽고 그 앞부분을 CPU 생각의 작업 칸으로 다시 쓴다 */
  readonly ints: Int32Array;
  readonly penalty: Int32Array;
  readonly value: Int32Array;
  readonly penaltyMax: Int32Array;
  readonly valueMax: Int32Array;
}

export function readMapAi(dat10: VmDat, map: number): MapAi {
  const bytes = dat10.read(FIRST_ENTRY + map * 2);
  if (bytes.length !== SIZE) throw new Error(`맵 ${map}의 AI 자료 크기가 0x${SIZE.toString(16)}가 아닙니다: ${bytes.length}`);
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ints = (at: number, count: number) => Int32Array.from({ length: count }, (_, i) => v.getInt32(at + i * 4, true));
  const table = AI_LAYERS * LAYER * 4;
  return {
    ints: ints(0, SIZE / 4),
    penalty: ints(0, AI_LAYERS * LAYER),
    value: ints(table, AI_LAYERS * LAYER),
    penaltyMax: ints(table * 2, AI_LAYERS),
    valueMax: ints(table * 2 + AI_LAYERS * 4, AI_LAYERS),
  };
}
