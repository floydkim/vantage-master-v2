import { expect, it } from 'vitest';
import { ACTION_COUNT, readActionCosts, readActionNames, readActions, readActionScripts } from '../../src/formats/actionTable.ts';
import { openExeImage } from '../../src/formats/exeImage.ts';
import { readOriginal } from '../original.ts';

const exe = openExeImage(readOriginal('vmv2.exe'));

it('행동 표 항목을 원작 오프셋(0x465908 + 행동 × 0x14)에서 읽는다', () => {
  const actions = readActions(exe);
  expect(actions).toHaveLength(ACTION_COUNT);
  // 2번: 공격(OA 40, 범위 종류 1 포물선, 사거리 6), 12번: 마법(MP 26, 범위 종류 3, 사거리 3, 연출 2), 30번: 효과 반경 2
  expect(actions[2]).toEqual({ mpCost: 0, oaCost: 40, kind: 0, sub: 0, rangeKind: 1, range: 6, areaRadius: 0, arcHeight: 16, effect: 0, power: 4 });
  expect(actions[12]).toEqual({ mpCost: 26, oaCost: 20, kind: 0, sub: 1, rangeKind: 3, range: 3, areaRadius: 0, arcHeight: 16, effect: 2, power: 4 });
  expect(actions[30]).toMatchObject({ mpCost: 15, oaCost: 40, rangeKind: 4, areaRadius: 2, power: 9 });
  expect(actions.map((a) => a.oaCost)).toEqual(readActionCosts(exe));
});

it('행동별 마법 연출 스크립트(표 0x4612b4): 공격 0~9와 마법 16~19는 없음, 마스터 마법 10~15는 DATA12 0x41~0x46, 네이티얼 마법 20~33은 0x47~0x54', () => {
  const scripts = readActionScripts(exe);
  expect(scripts).toHaveLength(ACTION_COUNT);
  expect(scripts.slice(0, 10)).toEqual(Array(10).fill(null));
  expect(scripts.slice(10, 20)).toEqual([0x41, 0x42, 0x43, 0x44, 0x45, 0x46, null, null, null, null]);
  expect(scripts.slice(20)).toEqual([0x51, 0x4f, 0x53, 0x48, 0x4c, 0x49, 0x4b, 0x47, 0x4e, 0x50, 0x4d, 0x52, 0x54, 0x4a]);
});

it('행동 이름(+0x10): 마법만 exe에 있고 공격 0~9·16~19는 실행 중에 채우는 자리라 null', () => {
  const names = readActionNames(exe);
  expect(names.slice(0, 10)).toEqual(Array(10).fill(null));
  expect(names.slice(10, 16)).toEqual(['Uptide', 'Downtide', 'Vanish', 'Bless', 'Medic', 'Conjurate']);
  expect(names.slice(16, 20)).toEqual(Array(4).fill(null));
  expect(names[32]).toBe('Destruction');
});
