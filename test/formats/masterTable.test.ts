import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { openExeImage } from '../../src/formats/exeImage.ts';
import { MASTER_COUNT, MASTER_LEVELS, readMasterTable } from '../../src/formats/masterTable.ts';
import { readOriginal } from '../original.ts';

// vmv2.exe 0x42dae0을 오라클로 실행해 만든 정답(27명 × 레벨 40). 재생성: pnpm oracle master_stats
interface Case {
  readonly args: { readonly master: number; readonly level: number };
  readonly expected: Record<string, number>;
}
const golden: { readonly cases: readonly Case[] } = JSON.parse(
  readFileSync(new URL('../golden/masterStats.json', import.meta.url), 'utf8'),
);

it('마스터 표 읽기가 원작 0x42dae0이 진영 레코드에 넣는 값과 1080가지 경우 모두 같다', () => {
  const table = readMasterTable(openExeImage(readOriginal('vmv2.exe')));
  expect(table).toHaveLength(MASTER_COUNT);
  expect(golden.cases).toHaveLength(MASTER_COUNT * MASTER_LEVELS);
  for (const c of golden.cases) {
    const master = table[c.args.master];
    expect({ ...master.levels[c.args.level], attackAction: master.attackAction }).toEqual(c.expected);
  }
});
