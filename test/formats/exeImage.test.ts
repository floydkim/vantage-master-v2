import { expect, it } from 'vitest';
import { openExeImage } from '../../src/formats/exeImage.ts';
import { readOriginal } from '../original.ts';

it('PE가 아니거나 잘린 실행 파일은 한국어 오류로 실패한다', () => {
  expect(() => openExeImage(new Uint8Array(10))).toThrow('너무 작습니다');
  expect(() => openExeImage(new Uint8Array(0x100))).toThrow('PE 실행 파일이 아닙니다');
  const exe = readOriginal('vmv2.exe');
  expect(() => openExeImage(exe.subarray(0, 0x400))).toThrow('잘렸습니다');
});
