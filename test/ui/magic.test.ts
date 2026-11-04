import { expect, it } from 'vitest';
import { readGolden } from '../engine/block.ts';
import { type EffectCase, runEffect } from './effectCases.ts';

const cases = readGolden<EffectCase>('magic');

it('마법 연출이 틱마다 원작 풀·타이머·HP·색 표·화면과 같다(시전, 대상 칸 효과, 투사체형, 둘레 타격, 상태 이상, 물높이·Bless)', () => {
  const wrong: string[] = [];
  for (const c of cases) {
    try {
      runEffect(c, 'magic', wrong);
    } catch (e) {
      wrong.push(`${c.label}: ${e instanceof Error ? e.message : e}`);
    }
  }
  expect(wrong).toEqual([]);
}, 120_000);
