import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { readMapAi } from '../../src/formats/mapAi.ts';
import { openVmDat } from '../../src/formats/vmFiles.ts';
import { readGolden } from '../engine/block.ts';
import { readOriginal } from '../original.ts';

// 원작 0x44c8c3이 맵마다 메모리에 둔 표 네 개의 SHA-256. 재생성: pnpm oracle map_ai
interface Case {
  readonly args: { readonly map: number };
  readonly expected: { readonly penalty: string; readonly value: string; readonly penaltyMax: string; readonly valueMax: string };
}
const sha = (a: Int32Array) => createHash('sha256').update(new Uint8Array(a.buffer, a.byteOffset, a.byteLength)).digest('hex');

it('맵별 AI 표가 원작 0x44c8c3이 읽은 것과 같다(52맵)', () => {
  const dat10 = openVmDat(10, readOriginal('DATA10.DAT'));
  const golden = readGolden<Case>('mapAi');
  expect(golden).toHaveLength(52);
  for (const c of golden) {
    const ai = readMapAi(dat10, c.args.map);
    expect({ penalty: sha(ai.penalty), value: sha(ai.value), penaltyMax: sha(ai.penaltyMax), valueMax: sha(ai.valueMax) }, `맵 ${c.args.map}`).toEqual(c.expected);
  }
});

it('ints는 자료 전체(i32)이고 표 넷은 그 조각이다(원작은 자료를 AI 작업 버퍼에 읽는다)', () => {
  const ai = readMapAi(openVmDat(10, readOriginal('DATA10.DAT')), 0);
  expect(ai.ints).toHaveLength(0x320c8 / 4);
  expect(ai.ints.subarray(0, ai.penalty.length)).toEqual(ai.penalty);
  expect(ai.ints.subarray(ai.penalty.length, ai.penalty.length * 2)).toEqual(ai.value);
});
