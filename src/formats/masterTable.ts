// 마스터 능력치 표: vmv2.exe 0x4690f0 + (마스터 × 40 + 레벨) × 0x1c, i32 7개. 0~26번(27명)이 유효하고 뒤는 다른 데이터다.
// 근거: 0x42dae0이 진영 레코드 +0x9c(마스터)·+0xa0(레벨)로 읽어 레코드 +0xa4~+0xbc에 넣는다.
// 이름 근거: +0xa4는 현재 MP의 상한(0x4022d7 부근, 0x40218f), +0xa8~+0xbc는 "Master Edit" 대화상자(리소스 125)의
// Attack/Defense/Magic Power/Magic Defense/Speed/Move 칸(0x643~0x648)에 들어간다.
import type { ExeImage } from './exeImage.ts';

const STATS = 0x4690f0;
const ATTACK_ACTION = 0x470710; // [마스터 × 4] 바이트: 공격 행동 번호 → 진영 레코드 +0x18 → 마스터 유닛 +0x08
export const MASTER_COUNT = 27;
export const MASTER_LEVELS = 40;

export interface MasterStats {
  readonly maxMp: number;
  readonly attack: number;
  readonly defense: number;
  readonly magic: number;
  readonly magicDefense: number;
  readonly speed: number;
  readonly movement: number;
}

export interface MasterType {
  readonly id: number;
  /** 레벨 1~40(배열 0~39) */
  readonly levels: readonly MasterStats[];
  /** 마스터 유닛 +0x08로 가는 값. 네이티얼 표 +0x46과 같은 자리(공격 범위 번호로 추정) */
  readonly attackAction: number;
}

/** vmv2.exe 0x0042dae0이 읽는 평탄한 행(마스터 × 40 + 레벨). 레벨 40부터는 다음 마스터의 행, 27 × 40행 뒤는 exe의 다른 데이터다 */
export function readMasterStats(exe: ExeImage, row: number): MasterStats {
  const r = exe.read(STATS + row * 0x1c, 0x1c);
  const v = new DataView(r.buffer, r.byteOffset, r.byteLength);
  const i32 = (k: number) => v.getInt32(k * 4, true);
  return { maxMp: i32(0), attack: i32(1), defense: i32(2), magic: i32(3), magicDefense: i32(4), speed: i32(5), movement: i32(6) };
}

export function readMasterTable(exe: ExeImage): MasterType[] {
  const masters: MasterType[] = [];
  for (let id = 0; id < MASTER_COUNT; id++) {
    const levels = Array.from({ length: MASTER_LEVELS }, (_, level) => readMasterStats(exe, id * MASTER_LEVELS + level));
    masters.push({ id, levels, attackAction: exe.read(ATTACK_ACTION + id * 4, 1)[0] });
  }
  return masters;
}

const FREE_MODE_NAMES = 0x468fa8; // 문자열 포인터 2개: 프리 모드의 진영 이름(0x42d2bc)

/** 마스터 27명의 기본 이름(0x42d2bc: 표준 이름, Standard Name) */
export function readMasterNames(exe: ExeImage): string[] {
  const v = new DataView(exe.read(FREE_MODE_NAMES, MASTER_COUNT * 4).buffer);
  return Array.from({ length: MASTER_COUNT }, (_, m) => exe.cString(v.getUint32(m * 4, true)));
}

/** 프리 모드 두 진영의 기본 이름 */
export function readFreeModeNames(exe: ExeImage): [string, string] {
  const v = new DataView(exe.read(FREE_MODE_NAMES, 8).buffer);
  return [exe.cString(v.getUint32(0, true)), exe.cString(v.getUint32(4, true))];
}
