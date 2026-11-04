import { describe, expect, it } from 'vitest';
import { lbDecompress } from '../../src/formats/lbDecompress.ts';

const run = (bytes: number[]) => new TextDecoder('latin1').decode(lbDecompress(Uint8Array.from(bytes)));

// 블록 = u16 크기 + 본문 + u8 계속 여부. 모드 A의 크기에는 크기 필드 2바이트가 포함된다.
describe('모드 A (바이트 토큰)', () => {
  it('짧은 리터럴 0x00~0x1f', () => expect(run([6, 0, 0x03, 0x61, 0x62, 0x63, 0])).toBe('abc'));
  it('긴 리터럴 0x20~0x3f', () => expect(run([7, 0, 0x20, 0x03, 0x61, 0x62, 0x63, 0])).toBe('abc'));
  it('짧은 반복 0x40~0x4f: 개수+4', () => expect(run([4, 0, 0x41, 0x78, 0])).toBe('xxxxx'));
  it('긴 반복 0x50~0x7f: 개수+4', () => expect(run([5, 0, 0x50, 0x01, 0x7a, 0])).toBe('zzzzz'));
  it('역참조 0x80~: 겹쳐서 복사', () => expect(run([7, 0, 0x02, 0x61, 0x62, 0x80, 0x02, 0])).toBe('ababab'));
  it('역참조 직후 0x60~0x7f는 이어서 복사', () =>
    expect(run([8, 0, 0x02, 0x61, 0x62, 0x80, 0x02, 0x62, 0])).toBe('abababab'));
  it('계속 바이트가 0이 아니면 다음 블록을 읽는다', () =>
    expect(run([4, 0, 0x41, 0x78, 1, 6, 0, 0x03, 0x61, 0x62, 0x63, 0])).toBe('xxxxxabc'));
});

// 본문 = 0x00 + 첫 플래그 바이트(8비트) + 비트·바이트가 섞인 스트림. 비트가 떨어지면 u16 LE를 새로 읽는다.
describe('모드 B (비트 플래그 LZ)', () => {
  it('리터럴 후 거리 0으로 끝', () => expect(run([6, 0, 0, 0x06, 0x41, 0, 0])).toBe('A'));
  it('역참조, 중간에 비트 재충전', () =>
    expect(run([12, 0, 0, 0x74, 0x41, 0x42, 0x02, 0, 0, 0, 0])).toBe('ABAB'));
  it('거리 1은 반복: 개수+14', () =>
    expect(run([10, 0, 0, 0x03, 0x01, 0x30, 0x00, 0x71, 0x00, 0x00])).toBe('q'.repeat(14)));
});

describe('손상된 입력', () => {
  it('잘린 입력은 RangeError', () => expect(() => run([6, 0, 0x03, 0x61])).toThrow(/잘렸습니다/));
  it('출력보다 먼 역참조는 RangeError', () => expect(() => run([4, 0, 0x80, 0x05, 0])).toThrow(/역참조/));
  it('모드 A 블록 크기를 넘으면 RangeError', () =>
    expect(() => run([3, 0, 0x03, 0x61, 0x62, 0x63, 0])).toThrow(/블록 크기/));
});
