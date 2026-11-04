// 행동 표와 속도 계수 표. 행동 표: 0x465908 + 행동 × 0x14. 0~9번은 공격, 10~33번은 마법이고 뒤는 다른 데이터다.
// +0x00 i32 MP 비용(0x406d13), +0x04 u16 OA에 더하는 행동 비용(0x4113da), +0x06 종류(1 회복, 2 상태 이상, 3 풀기, 4 물높이 등),
// +0x07 세부(공격: 0이면 공격 − 방어, 아니면 마력 − 마법방어. 상태 이상: 0·1·2 → 상태 비트 1·2·4), +0x08 범위 종류(0x41074b),
// +0x09 사거리, +0x0a 효과 반경(0x410d77). 0이 아니면 데미지 방향의 원점도 지정 칸(0x410fda), +0x0b 미해독, +0x0c 연출 번호(0x413820의 함수 표 0x45f8d0),
// +0x0d 위력, +0x10 이름 포인터(일부는 실행 중에 채워짐). 유닛 +0x08이 그 유닛의 공격 행동 번호다(네이티얼 표 +0x46, 마스터는 진영 레코드 +0x18).
// 속도 계수 표: 0x45f77c + 속도 × 4, i32. 속도 0~20(481 → 136)이 유효하다.
import type { ExeImage } from './exeImage.ts';

const ACTIONS = 0x465908;
const ACTION_SIZE = 0x14;
const ACTION_SCRIPTS = 0x4612b4; // 행동별 연출 스크립트 리소스 ID(0x422c16): 0xc0000 + DATA12 항목, 없으면 0
const DATA12 = 0xc0000;
const SPEED_FACTORS = 0x45f77c;
export const ACTION_COUNT = 34;
export const MAX_SPEED = 20;

export function readActionCosts(exe: ExeImage): number[] {
  return readActions(exe).map((a) => a.oaCost);
}

export function readSpeedFactors(exe: ExeImage): number[] {
  const v = new DataView(exe.read(SPEED_FACTORS, (MAX_SPEED + 1) * 4).buffer);
  return Array.from({ length: MAX_SPEED + 1 }, (_, i) => v.getInt32(i * 4, true));
}

export interface Action {
  readonly mpCost: number;
  readonly oaCost: number;
  readonly kind: number;
  readonly sub: number;
  readonly rangeKind: number;
  readonly range: number;
  /** 효과 반경. 0이 아니면 데미지 방향의 원점이 시전자 대신 지정 칸 */
  readonly areaRadius: number;
  /** 포물선 높이(범위 종류 1, 0x410499) */
  readonly arcHeight: number;
  /** 연출 번호(0x413820) */
  readonly effect: number;
  readonly power: number;
}

/** 행동마다 마법 연출 스크립트(0x413c45가 0x422c16(행동, 1)로 읽음)의 DATA12 항목 번호. 없으면 null(공격 0~9, 마법 16~19) */
export function readActionScripts(exe: ExeImage): (number | null)[] {
  const v = new DataView(exe.read(ACTION_SCRIPTS, ACTION_COUNT * 4).buffer);
  return Array.from({ length: ACTION_COUNT }, (_, i) => {
    const id = v.getUint32(i * 4, true);
    if (id === 0) return null;
    if ((id & 0xffff0000) !== DATA12) throw new Error(`행동 ${i}의 연출 스크립트 리소스가 DATA12가 아닙니다: 0x${id.toString(16)}`);
    return id & 0xffff;
  });
}

export function readActions(exe: ExeImage): Action[] {
  const r = exe.read(ACTIONS, ACTION_COUNT * ACTION_SIZE);
  const v = new DataView(r.buffer);
  return Array.from({ length: ACTION_COUNT }, (_, i) => {
    const at = i * ACTION_SIZE;
    return {
      mpCost: v.getInt32(at, true),
      oaCost: v.getUint16(at + 4, true),
      kind: r[at + 6],
      sub: r[at + 7],
      rangeKind: r[at + 8],
      range: r[at + 9],
      areaRadius: r[at + 0x0a],
      arcHeight: r[at + 0x0b],
      effect: r[at + 0x0c],
      power: r[at + 0x0d],
    };
  });
}

/** 행동 이름(행동 표 +0x10의 문자열 포인터, 0x425ea9 마법 목록이 쓴다). 공격 행동(0~9, 16~19)은 실행 중에 채우는 자리(0x483e5c~)를
 *  가리켜 exe에 글자가 없으므로 null */
export function readActionNames(exe: ExeImage): (string | null)[] {
  const v = new DataView(exe.read(ACTIONS, ACTION_COUNT * ACTION_SIZE).buffer);
  return Array.from({ length: ACTION_COUNT }, (_, i) => {
    const at = v.getUint32(i * ACTION_SIZE + 0x10, true);
    const bytes = exe.read(at, 1);
    return bytes[0] === 0 ? null : exe.cString(at);
  });
}
