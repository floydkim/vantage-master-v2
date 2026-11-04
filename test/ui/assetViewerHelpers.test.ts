import { describe, expect, it } from 'vitest';
import { guessKind, hexDump, parseLayerSpec } from '../../src/ui/assetViewer/helpers.ts';

describe('guessKind', () => {
  it('RIFF로 시작하면 이름과 상관없이 wav', () => {
    expect(guessKind(null, Uint8Array.from([0x52, 0x49, 0x46, 0x46]))).toBe('wav');
  });
  it('DIR 확장자로 종류를 정하고 모르면 image', () => {
    const bytes = new Uint8Array(4);
    expect(guessKind('SYSPAL._PL', bytes)).toBe('palette');
    expect(guessKind('MOJI._FN', bytes)).toBe('font');
    expect(guessKind('MAP000._SC', bytes)).toBe('text');
    expect(guessKind('BTLCMD._BM', bytes)).toBe('image');
    expect(guessKind(null, bytes)).toBe('image');
  });
});

describe('parseLayerSpec', () => {
  it('"DAT:항목@시작칸"을 공백이나 쉼표로 구분해 읽는다', () => {
    expect(parseLayerSpec(' 0:1@10, 9:23@50 ')).toEqual([
      { dat: 0, entry: 1, start: 10 },
      { dat: 9, entry: 23, start: 50 },
    ]);
  });
  it('빈 문자열은 빈 목록', () => expect(parseLayerSpec('')).toEqual([]));
  it('형식이 틀리면 예시를 담아 실패한다', () => expect(() => parseLayerSpec('0:1')).toThrow('예: 0:1@10'));
  it('시작 칸이 255를 넘으면 실패한다', () => expect(() => parseLayerSpec('0:1@256')).toThrow('0~255'));
});

describe('hexDump', () => {
  it('오프셋, 16진수, ASCII를 한 줄에 쓴다', () => {
    expect(hexDump(Uint8Array.from([0x41, 0x00]))).toBe('000000  41 00'.padEnd(55) + '  A.');
  });
  it('limit 바이트까지만 쓴다', () => {
    expect(hexDump(new Uint8Array(100), 32).split('\n')).toHaveLength(2);
  });
});
