import { expect, it } from 'vitest';
import { composePalette, parsePalette } from '../../src/formats/palette.ts';
import { openVmDat } from '../../src/formats/vmFiles.ts';
import { readOriginal } from '../original.ts';

it('PALETTEENTRY 배열에서 RGB만 꺼낸다', () => {
  expect(parsePalette(Uint8Array.from([1, 2, 3, 1, 4, 5, 6, 1]))).toEqual([
    [1, 2, 3],
    [4, 5, 6],
  ]);
});

it('길이가 4의 배수가 아니면 실패한다', () => {
  expect(() => parsePalette(new Uint8Array(3))).toThrow('4의 배수');
});

it('지정한 칸부터 채우고 빈 칸은 마젠타, 256칸을 넘는 색은 버린다', () => {
  const table = composePalette([
    { colors: [[1, 2, 3]], start: 10 },
    { colors: [[7, 8, 9], [4, 4, 4]], start: 255 },
  ]);
  expect(table.length).toBe(768);
  expect([...table.subarray(0, 3)]).toEqual([255, 0, 255]);
  expect([...table.subarray(30, 33)]).toEqual([1, 2, 3]);
  expect([...table.subarray(765, 768)]).toEqual([7, 8, 9]);
});

it('원본 SYSPAL은 40색이고 0번은 검정, 1번은 (255, 255, 240)', () => {
  const colors = parsePalette(openVmDat(0, readOriginal('DATA00.DAT')).read(1));
  expect(colors.length).toBe(40);
  expect(colors.slice(0, 2)).toEqual([
    [0, 0, 0],
    [255, 255, 240],
  ]);
});
