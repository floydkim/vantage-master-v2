import { expect, it } from 'vitest';
import { extractStrings } from '../../src/formats/strings.ts';
import { openVmDat } from '../../src/formats/vmFiles.ts';
import { readOriginal } from '../original.ts';

it('ASCII와 Shift-JIS 2바이트 문자 묶음을 위치와 함께 꺼낸다', () => {
  const bytes = Uint8Array.from([0, 0x48, 0x69, 0x21, 0x21, 0, 0x82, 0xa0, 0x82, 0xa2, 0x82, 0xa4, 0x82, 0xa6, 0]);
  expect(extractStrings(bytes)).toEqual([
    { offset: 1, text: 'Hi!!' },
    { offset: 6, text: 'あいうえ' },
  ]);
});

it('최소 글자 수보다 짧은 묶음은 버린다', () => {
  expect(extractStrings(Uint8Array.from([0x41, 0x42, 0, 0x43]))).toEqual([]);
});

it('원본 MAP000 스크립트의 첫 문자열은 맵 이름', () => {
  expect(extractStrings(openVmDat(10, readOriginal('DATA10.DAT')).read(0))[0]).toEqual({ offset: 0, text: 'Silent Hill' });
});
