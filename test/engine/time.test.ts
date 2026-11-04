import { expect, it } from 'vitest';
import { advanceTime } from '../../src/engine/rules/time.ts';
import { decodeState, encodeState, STATE_SIZE } from '../../src/engine/state.ts';
import { openExeImage } from '../../src/formats/exeImage.ts';
import { readNatialTable } from '../../src/formats/natialTable.ts';
import { readOriginal } from '../original.ts';
import { blockDifferences, inflateBlock, readGolden } from './block.ts';

// 원작 프리 배틀에 소환하고 값을 흔든 블록과, 그 상태에서 0x4022d7을 실행한 뒤의 블록. 재생성: pnpm oracle advance_time
interface Case {
  readonly args: { readonly block: string; readonly minutes: number };
  readonly expected: { readonly block: string; readonly deficit: number };
}
const golden = readGolden<Case>('advanceTime');
const natials = readNatialTable(openExeImage(readOriginal('vmv2.exe')));

it('시간 진행이 원작과 같다(300가지: MP 부족, 상태 이상, 수위 복귀, 날짜·누적 시각 넘김 + 유지 MP가 어긋난 손상 블록 20가지)', () => {
  expect(golden).toHaveLength(320);
  expect(golden.filter((c) => c.expected.deficit).length).toBeGreaterThan(20);
  for (const [k, c] of golden.entries()) {
    const result = advanceTime(decodeState(inflateBlock(c.args.block)), natials, c.args.minutes);
    expect(blockDifferences(encodeState(result.state), inflateBlock(c.expected.block)), `경우 ${k}`).toEqual([]);
    expect(result.deficit, `경우 ${k}`).toBe(c.expected.deficit === 1);
  }
});

it('MP가 모자란데 네이티얼이 없으면 실패한다(원작 정의되지 않은 동작)', () => {
  const block = new Uint8Array(STATE_SIZE);
  const v = new DataView(block.buffer);
  v.setInt32(0x9ec + 0x10, 50, true); // 진영 0 유지 MP 50, 네이티얼 없음
  expect(() => advanceTime(decodeState(block), natials, 60)).toThrow('없앨 네이티얼이 없습니다');
});

it('물높이가 −1·0·1 밖이면 원작처럼 단계는 두고 남은 분만 0으로 한다(0x42562e)', () => {
  const block = new Uint8Array(STATE_SIZE);
  [5, 2, 10].forEach((x, k) => new DataView(block.buffer).setInt32(0xba0 + k * 4, x, true));
  expect(advanceTime(decodeState(block), natials, 20).state).toMatchObject({ waterLevel: 4, waterStage: 2, waterMinutes: 0 });
});
