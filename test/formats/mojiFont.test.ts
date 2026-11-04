import { expect, it } from 'vitest';
import { mojiAtlas } from '../../src/formats/mojiFont.ts';
import { openVmDat } from '../../src/formats/vmFiles.ts';
import { readOriginal } from '../original.ts';

it('글자 16개씩 한 줄로 늘어놓고 최상위 비트가 왼쪽 픽셀이다', () => {
  const font = new Uint8Array(17 * 16);
  font[16 * 16] = 0x80; // 17번째 글자의 첫 줄 맨 왼쪽
  const { width, pixels } = mojiAtlas(font);
  expect(width).toBe(128);
  expect(pixels.length).toBe(128 * 32);
  expect(pixels[16 * 128]).toBe(1);
  expect(pixels.reduce((sum, p) => sum + p, 0)).toBe(1);
});

it('원본 MOJI의 "!"(0x21, 두 번째 글자) 둘째 줄은 가운데 두 칸', () => {
  const { pixels } = mojiAtlas(openVmDat(0, readOriginal('DATA00.DAT')).read(0));
  expect([...pixels.subarray(128 + 8, 128 + 16)]).toEqual([0, 0, 0, 1, 1, 0, 0, 0]);
});
