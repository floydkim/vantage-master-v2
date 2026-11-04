import { expect, it } from 'vitest';
import { cdiv, ftol } from '../../src/engine/rules/cint.ts';

it('C 정수 나눗셈은 0 쪽으로 버리고 −0을 만들지 않는다', () => {
  expect(cdiv(7, 2)).toBe(3);
  expect(cdiv(-7, 2)).toBe(-3);
  expect(Object.is(cdiv(-1, 10), 0)).toBe(true);
});

it('ftol은 원작 __ftol(0x452538: fistp qword의 하위 dword)과 같다', () => {
  expect(ftol(-1.5)).toBe(-1);
  expect(ftol(2 ** 31)).toBe(-(2 ** 31)); // 하위 dword만 남는다
  expect(ftol(Number.NaN)).toBe(0); // 정수 부정값 0x8000000000000000의 하위 dword
  expect(ftol(Number.POSITIVE_INFINITY)).toBe(0);
});
