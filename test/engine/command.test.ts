import { expect, it } from 'vitest';
import { ACT, decodeCommand, encodeCommand } from '../../src/engine/command.ts';

it('명령을 원작 메시지 u16 두 개로 바꾸고 되돌린다(0x406d13·0x40672d 배치)', () => {
  const command = { to: { x: 21, y: 18 }, direction: 5, kind: ACT, number: 9, target: { x: 20, y: 17 } };
  const [a, b] = encodeCommand(command);
  expect(a).toBe(21 | (18 << 5) | (5 << 10) | (1 << 13));
  expect(b).toBe(9 | (20 << 6) | (17 << 11));
  expect(decodeCommand(a, b)).toEqual(command);
});

it('메시지 칸을 넘는 값은 RangeError', () => {
  expect(() => encodeCommand({ to: { x: 32, y: 0 }, direction: 0, kind: 0, number: 0, target: { x: 0, y: 0 } })).toThrow(RangeError);
  expect(() => encodeCommand({ to: { x: 0, y: 0 }, direction: 0, kind: 1, number: 64, target: { x: 0, y: 0 } })).toThrow(RangeError);
});
