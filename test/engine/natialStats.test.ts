import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { expect, it } from 'vitest';
import { natialStats } from '../../src/engine/rules/natialStats.ts';
import { openExeImage } from '../../src/formats/exeImage.ts';
import { type Light, readLightBonus, readNatialTable } from '../../src/formats/natialTable.ts';
import { readOriginal } from '../original.ts';

// vmv2.exe 0x40fe72를 오라클로 실행해 만든 정답(24종 × 레벨 3 × 밝기 3). 재생성: pnpm oracle natial_stats
interface Case {
  readonly args: { readonly natial: number; readonly level: 0 | 1 | 2; readonly light: Light };
  readonly expected: Record<string, number>;
}
const golden: { readonly cases: readonly Case[] } = JSON.parse(
  readFileSync(new URL('../golden/natialStats.json', import.meta.url), 'utf8'),
);

it('natialStats가 원작 0x40fe72와 216가지 경우 모두 같다', () => {
  const exe = openExeImage(readOriginal('vmv2.exe'));
  const table = readNatialTable(exe);
  const bonus = readLightBonus(exe);
  const mismatches = golden.cases
    .map((c) => ({ ...c, actual: natialStats(table[c.args.natial - 1], c.args.level, c.args.light, bonus) }))
    .filter((c) => !isDeepStrictEqual(c.actual, c.expected));
  expect(golden.cases).toHaveLength(216);
  expect(mismatches).toEqual([]);
});
