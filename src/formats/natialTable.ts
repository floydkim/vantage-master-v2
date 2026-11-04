// 네이티얼 종류 표: vmv2.exe 0x4749d8 + 종류 × 0x58. 1~24번이 네이티얼이고 0번은 빈 칸이다.
// 오프셋 근거: 0x40fc66(압축 레코드에서 네이티얼 되살리기)과 0x40fe72(능력치 계산)가 읽는 위치.
// 이름 근거: 소환 목록 대화상자(리소스 111)에 값을 채우는 코드(0x444ec8 부근)와 그 칸의 라벨.
import type { ExeImage } from './exeImage.ts';

const TABLE = 0x4749d8;
const RECORD_SIZE = 0x58;
const LIGHT_BONUS = 0x45f584; // [성향 × 3 + 밝기] i32
export const NATIAL_COUNT = 24;

/** 0 희미함, 1 낮, 2 밤 (vmv2.exe 0x402272, 정보 대화상자 라디오 버튼 "Lettle Bright"/"Bright"/"Dark") */
export type Light = 0 | 1 | 2;
type ByLevel = readonly [number, number, number];

export interface NatialType {
  readonly id: number;
  readonly name: string;
  readonly attackName: string;
  /** 레벨 1~3의 공격·방어·마력·마법방어·속도(대화상자 Attack, Defense, Magic Power, Magic, Speed) */
  readonly attack: ByLevel;
  readonly defense: ByLevel;
  readonly magic: ByLevel;
  readonly magicDefense: ByLevel;
  readonly speed: ByLevel;
  /** 1 땅, 2 물, 3 불, 4 하늘 (이름 표 0x474838: None/Earth/Water/Fire/Heaven) */
  readonly element: number;
  /** 0 없음, 1 낮에 강함, 2 밤에 강함 (이름 표 0x47484c: Normal/Day type/Night type) */
  readonly lightPreference: number;
  /** 소환에 드는 MP("MP Need"). 정각마다 드는 유지 MP("MP Maint")는 이 값을 8로 나눈 몫이다 */
  readonly summonMp: number;
  /** 이동력("Move") → 유닛 +0x48 */
  readonly movement: number;
  /** 이동 타입 0 Walk, 1 Walk 2, 2 Swim, 3 Swim 2, 4 Fly (이름 표 0x45f254) → 유닛 +0x28 */
  readonly moveType: number;
  /** +0x46 → 유닛 +0x08: 공격 행동 번호(행동 표 0x465908의 번호, 0x406d13·0x41074b) */
  readonly attackAction: number;
  /** +0x47 마법 행동 번호(20~33, 0이면 없음): 0x40f910·0x40fc66이 유닛 +0x0c = 1, +0x10 = 이 값으로 둔다 */
  readonly magicAction: number;
  /** +0x4c AI 가중치(400~1600): 소환·되살리기 때 유닛 +0x60·+0x64의 처음 값. CPU AI가 생각할 때마다 이것으로 다시 구한다(0x445d57) */
  readonly aiWeight: number;
}

export function readNatialTable(exe: ExeImage): NatialType[] {
  const types: NatialType[] = [];
  for (let id = 1; id <= NATIAL_COUNT; id++) {
    const r = exe.read(TABLE + id * RECORD_SIZE, RECORD_SIZE);
    const v = new DataView(r.buffer, r.byteOffset, r.byteLength);
    const i32 = (o: number) => v.getInt32(o, true);
    const byLevel = (o: number): ByLevel => [i32(o), i32(o + 4), i32(o + 8)];
    types.push({
      id,
      name: exe.cString(v.getUint32(0x50, true)),
      attackName: exe.cString(v.getUint32(0x54, true)),
      attack: byLevel(0x04),
      defense: byLevel(0x10),
      magic: byLevel(0x1c),
      magicDefense: byLevel(0x28),
      speed: byLevel(0x34),
      element: r[0x44],
      lightPreference: r[0x45],
      summonMp: i32(0x00),
      movement: i32(0x40),
      moveType: r[0x48],
      attackAction: r[0x46],
      magicAction: r[0x47],
      aiWeight: i32(0x4c),
    });
  }
  return types;
}

/** [성향][밝기]의 능력치 보정값 */
export function readLightBonus(exe: ExeImage): number[][] {
  const v = new DataView(exe.read(LIGHT_BONUS, 36).buffer);
  return [0, 1, 2].map((pref) => [0, 1, 2].map((light) => v.getInt32((pref * 3 + light) * 4, true)));
}
