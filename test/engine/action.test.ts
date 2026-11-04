import { expect, it } from 'vitest';
import { ringCells } from '../../src/engine/rules/action.ts';
import { openExeImage } from '../../src/formats/exeImage.ts';
import { readTerrainTables } from '../../src/formats/terrainTable.ts';
import { readOriginal } from '../original.ts';

const tables = readTerrainTables(openExeImage(readOriginal('vmv2.exe')));

it('둘레 타격 칸(0x414939 0x2e·0x2f): 거리 1은 이웃 6칸을 방향 순서로, 거리 2는 12칸, 격자 밖은 버린다', () => {
  // 짝수 줄 (10, 10)의 이웃: 서, 북서, 북동, 동, 남동, 남서(0x473ed0·0x473f00)
  expect(ringCells(tables, 10, 10, 1)).toEqual([
    { x: 9, y: 10 }, { x: 9, y: 9 }, { x: 10, y: 9 }, { x: 11, y: 10 }, { x: 10, y: 11 }, { x: 9, y: 11 },
  ]);
  const two = ringCells(tables, 10, 10, 2);
  expect(two).toHaveLength(12);
  expect(new Set(two.map((c) => `${c.x},${c.y}`)).size).toBe(12);
  expect(ringCells(tables, 0, 0, 1)).toEqual([{ x: 1, y: 0 }, { x: 0, y: 1 }]); // 모서리: 동, 남동만
});
