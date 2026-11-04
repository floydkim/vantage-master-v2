import { expect, it } from 'vitest';
import { readHits } from '../../src/formats/effectScript.ts';
import { openVmDat } from '../../src/formats/vmFiles.ts';
import { readOriginal } from '../original.ts';

const dat12 = openVmDat(12, readOriginal('DATA12.DAT'));

it('DATA12 공격 연출 스크립트에서 타격 명령을 읽는다', () => {
  expect(readHits(dat12.read(0))).toEqual([{ kind: 'rest' }]); // 마스터 0
  expect(readHits(dat12.read(5))).toEqual([]); // 마스터 5: 투사체가 따로 맞힌다
  expect(readHits(dat12.read(0x1a + 4))).toEqual([{ kind: 'part', tenths: 0 }, { kind: 'rest' }]); // 네이티얼 4: 경험치를 두 번 계산
  expect(readHits(dat12.read(0x1a + 2))).toEqual([{ kind: 'part', tenths: 5 }, { kind: 'rest' }]);
  expect(readHits(dat12.read(45))).toEqual([{ kind: 'part', tenths: 3 }, { kind: 'part', tenths: 3 }, { kind: 'rest' }]);
});

it('DATA12 마법 연출 스크립트: 0x2b 특수 효과(물높이·Bless), 0x2e·0x2f 둘레', () => {
  expect(readHits(dat12.read(0x41))).toEqual([{ kind: 'special' }]); // Uptide
  expect(readHits(dat12.read(0x44))).toEqual([{ kind: 'special' }]); // Bless
  expect(readHits(dat12.read(0x4d))).toEqual([{ kind: 'ring', distance: 1 }, { kind: 'ring', distance: 2 }]); // Merstorm
  expect(readHits(dat12.read(0x54))).toEqual([{ kind: 'rest' }, { kind: 'ring', distance: 1 }, { kind: 'ring', distance: 2 }]); // Destruction
});

it('모르는 명령이나 끝이 없는 스크립트는 실패한다', () => {
  expect(() => readHits(Uint8Array.of(0x12, 0, 0, 0))).toThrow('모르는 명령 0x12');
  expect(() => readHits(Uint8Array.of(0x2c, 0, 0, 0))).toThrow('끝나지 않습니다');
  expect(() => readHits(Uint8Array.of(0x2d, 0, 0, 0, 5, 0))).toThrow('끝나지 않습니다'); // 인자 워드가 잘림
});
