import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { oaCost } from '../../src/engine/rules/oaCost.ts';
import { ACTION_COUNT, MAX_SPEED, readActionCosts, readSpeedFactors } from '../../src/formats/actionTable.ts';
import { openExeImage } from '../../src/formats/exeImage.ts';
import { readOriginal } from '../original.ts';

// vmv2.exe 0x4113da를 오라클로 실행해 만든 정답(속도 21 × 이동 여부 2 × 행동 34). 재생성: pnpm oracle oa_cost
interface Case {
  readonly args: { readonly speed: number; readonly moved: boolean; readonly action: number };
  readonly expected: number;
}
const golden: { readonly cases: readonly Case[] } = JSON.parse(
  readFileSync(new URL('../golden/oaCost.json', import.meta.url), 'utf8'),
);
const exe = openExeImage(readOriginal('vmv2.exe'));
const tables = { actionCosts: readActionCosts(exe), speedFactors: readSpeedFactors(exe) };

it('oaCost가 원작 0x4113da와 1428가지 경우 모두 같다', () => {
  expect(golden.cases).toHaveLength((MAX_SPEED + 1) * 2 * ACTION_COUNT);
  const mismatches = golden.cases.filter((c) => oaCost(tables, c.args.speed, c.args.moved, c.args.action) !== c.expected);
  expect(mismatches).toEqual([]);
});

it('표 범위 밖의 속도나 행동 번호는 RangeError', () => {
  expect(() => oaCost(tables, MAX_SPEED + 1, false, 0)).toThrow(RangeError);
  expect(() => oaCost(tables, 0, false, ACTION_COUNT)).toThrow(RangeError);
  expect(() => oaCost(tables, -1, false, 0)).toThrow(RangeError);
});
