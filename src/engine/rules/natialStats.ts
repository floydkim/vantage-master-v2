import type { Light, NatialType } from '../../formats/natialTable.ts';

export interface NatialStats {
  readonly attack: number;
  readonly defense: number;
  readonly magic: number;
  readonly magicDefense: number;
  readonly speed: number;
  /** 유닛 +0x5c: 경험치 값(0x411484·0x411556) = 소환 MP << 레벨 */
  readonly expValue: number;
}

/** level은 0~2(레벨 1~3), lightBonus는 readLightBonus 결과([성향][밝기]). */
// vmv2.exe 0x0040fe72: 공격·방어·마력·마법방어에만 밝기 보정을 더한다. 속도에는 없다.
export function natialStats(type: NatialType, level: 0 | 1 | 2, light: Light, lightBonus: readonly (readonly number[])[]): NatialStats {
  const bonus = lightBonus[type.lightPreference][light];
  return {
    attack: type.attack[level] + bonus,
    defense: type.defense[level] + bonus,
    magic: type.magic[level] + bonus,
    magicDefense: type.magicDefense[level] + bonus,
    speed: type.speed[level],
    expValue: type.summonMp << level,
  };
}
