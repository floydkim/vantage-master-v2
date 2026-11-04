import { expect, it } from 'vitest';
import { indexedToRgba } from '../../src/formats/indexedImage.ts';

it('팔레트를 적용해 RGBA로 바꾸고 너비로 나누어떨어지지 않는 바이트는 버린다', () => {
  const palette = new Uint8Array(768);
  palette.set([10, 20, 30], 3);
  const image = indexedToRgba(Uint8Array.from([0, 1, 1, 0, 1]), 2, palette);
  expect([image.width, image.height]).toEqual([2, 2]);
  expect(image.data.length).toBe(16);
  expect([...image.data.subarray(0, 4)]).toEqual([0, 0, 0, 255]);
  expect([...image.data.subarray(4, 8)]).toEqual([10, 20, 30, 255]);
});

it('너비가 양의 정수가 아니면 RangeError', () => {
  const palette = new Uint8Array(768);
  expect(() => indexedToRgba(new Uint8Array(4), 0, palette)).toThrow(RangeError);
  expect(() => indexedToRgba(new Uint8Array(4), -2, palette)).toThrow(RangeError);
  expect(() => indexedToRgba(new Uint8Array(4), 1.5, palette)).toThrow(RangeError);
});
