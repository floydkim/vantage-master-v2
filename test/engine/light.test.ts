import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { lightPhase } from '../../src/engine/rules/light.ts';
import type { Light } from '../../src/formats/natialTable.ts';

// vmv2.exe 0x402272를 오라클로 실행해 만든 정답. 재생성: pnpm oracle light_phase
interface Case {
  readonly args: { readonly minute: number; readonly lightChanges: boolean; readonly fixedLight: Light };
  readonly expected: Light;
}
const golden: { readonly cases: readonly Case[] } = JSON.parse(
  readFileSync(new URL('../golden/lightPhase.json', import.meta.url), 'utf8'),
);

it('lightPhase가 원작 0x402272와 같다(밝기 변화 맵 -500~2000분, 고정 밝기 맵)', () => {
  const mismatches = golden.cases.filter(
    (c) => lightPhase(c.args.minute, { lightChanges: c.args.lightChanges, fixedLight: c.args.fixedLight }) !== c.expected,
  );
  expect(golden.cases).toHaveLength(1453);
  expect(mismatches).toEqual([]);
});
