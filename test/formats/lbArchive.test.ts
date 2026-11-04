import { describe, expect, it } from 'vitest';
import { parseLbDat, parseLbDir } from '../../src/formats/lbArchive.ts';
import { readOriginal } from '../original.ts';

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

/** 항목들로 LB DAT를 만든다. 오프셋 표 = 항목 시작들 + 끝 표시(파일 크기) + 빈 슬롯 2개. */
function makeDat(entries: number[][]): Uint8Array {
  const slots = entries.length + 3;
  const header = 16 + 4 * slots;
  const bytes = new Uint8Array(header + entries.reduce((n, e) => n + e.length, 0));
  bytes.set([...ascii('LB DAT'), 0x1a, 0]);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, slots, true);
  let at = header;
  entries.forEach((e, i) => {
    view.setUint32(16 + i * 4, at, true);
    bytes.set(e, at);
    at += e.length;
  });
  view.setUint32(16 + entries.length * 4, at, true);
  return bytes;
}

function makeDir(names: string[]): Uint8Array {
  const bytes = new Uint8Array(16 + 36 * names.length);
  bytes.set([...ascii('LB DIR'), 0x1a, 0]);
  new DataView(bytes.buffer).setUint32(8, names.length, true);
  names.forEach((n, i) => bytes.set(ascii(n), 16 + i * 36));
  return bytes;
}

describe('parseLbDat', () => {
  it('끝 표시까지의 오프셋으로 항목을 나눈다', () => {
    const dat = parseLbDat(makeDat([[1, 2, 3], [4]]));
    expect(dat.entryCount).toBe(2);
    expect([...dat.entry(0)]).toEqual([1, 2, 3]);
    expect([...dat.entry(1)]).toEqual([4]);
  });

  it('범위 밖 항목은 RangeError', () => {
    const dat = parseLbDat(makeDat([[1]]));
    expect(() => dat.entry(1)).toThrow(RangeError);
    expect(() => dat.entry(-1)).toThrow(RangeError);
  });

  it('시그니처가 다르면 실패한다', () => {
    expect(() => parseLbDat(new Uint8Array(32))).toThrow('시그니처');
  });

  it('끝 표시가 없으면 실패한다', () => {
    const bytes = makeDat([[1, 2]]);
    new DataView(bytes.buffer).setUint32(20, 0, true);
    expect(() => parseLbDat(bytes)).toThrow('끝 표시');
  });

  it('원본 DATA00은 75개, DATA13은 154개 항목', () => {
    expect(parseLbDat(readOriginal('DATA00.DAT')).entryCount).toBe(75);
    expect(parseLbDat(readOriginal('DATA13.DAT')).entryCount).toBe(154);
  });
});

describe('parseLbDir', () => {
  it('이름과 확장자를 붙이고 빈 슬롯은 null', () => {
    expect(parseLbDir(makeDir(['MOJI    ._FN', '/_______.___']))).toEqual(['MOJI._FN', null]);
  });

  it('시그니처가 다르면 실패한다', () => {
    expect(() => parseLbDir(new Uint8Array(16))).toThrow('시그니처');
  });

  it('슬롯 수보다 짧으면 실패한다', () => {
    expect(() => parseLbDir(makeDir(['MOJI    ._FN']).subarray(0, 40))).toThrow('잘렸습니다');
  });

  it('원본 DIR 이름이 DAT 항목 순서와 맞는다', () => {
    const names00 = parseLbDir(readOriginal('DATA00.DIR'));
    expect(names00.slice(0, 2)).toEqual(['MOJI._FN', 'SYSPAL._PL']);
    expect(names00.filter(Boolean).length).toBe(75);
    expect(parseLbDir(readOriginal('DATA09.DIR'))[0]).toBe('ED000._SC');
  });
});
