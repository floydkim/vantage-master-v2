import { describe, expect, it } from 'vitest';
import { openExeImage } from '../../src/formats/exeImage.ts';
import { NATIAL_COUNT, readLightBonus, readNatialTable } from '../../src/formats/natialTable.ts';
import { readOriginal } from '../original.ts';

const exe = openExeImage(readOriginal('vmv2.exe'));

describe('openExeImage', () => {
  it('PE가 아니면 실패한다', () => expect(() => openExeImage(new Uint8Array(64))).toThrow('PE 실행 파일이 아닙니다'));
  it('섹션 밖 주소는 RangeError', () => expect(() => exe.read(0x100, 4)).toThrow(RangeError));
  it('파일에 없는 데이터 영역(초기화되지 않은 전역)은 0으로 읽는다', () => {
    expect([...exe.read(0x4cc810, 4)]).toEqual([0, 0, 0, 0]);
  });
});

describe('readNatialTable', () => {
  const table = readNatialTable(exe);
  it('네이티얼 24종이 6종씩 속성 1~4로 묶여 있다', () => {
    expect(table).toHaveLength(NATIAL_COUNT);
    expect(table.map((t) => t.element)).toEqual(Array.from({ length: 24 }, (_, i) => Math.floor(i / 6) + 1));
  });
  it('이름과 공격 이름', () => {
    expect(table[0]).toMatchObject({ id: 1, name: 'Fa-Rancell', attackName: 'Top Spin' });
    expect(table[23]).toMatchObject({ id: 24, name: 'Regna-Croxe', attackName: 'Great Bash' });
  });
  it('마법 행동(+0x47): 14종만 20~33, 나머지 0', () => {
    expect(table.map((t) => t.magicAction)).toEqual([0, 0, 0, 27, 23, 25, 0, 33, 0, 26, 24, 30, 0, 0, 0, 28, 21, 0, 29, 20, 0, 31, 22, 32]);
  });
  it('레벨 1~3 능력치', () => {
    expect(table[0]).toMatchObject({
      attack: [8, 11, 14],
      defense: [6, 7, 8],
      magic: [3, 3, 3],
      magicDefense: [7, 8, 9],
      speed: [11, 11, 11],
    });
  });
});

it('밝기 보정 표: 성향 없음 0, 낮 성향은 낮 +2·밤 -2, 밤 성향은 그 반대', () => {
  expect(readLightBonus(exe)).toEqual([
    [0, 0, 0],
    [0, 2, -2],
    [0, -2, 2],
  ]);
});
