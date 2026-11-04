import { expect, it } from 'vitest';
import { startFreeBattle } from '../../src/engine/battleStart.ts';
import { GRID, partByte, workGrid } from '../../src/engine/rules/terrain.ts';
import { unitOf } from '../../src/engine/state.ts';
import { masterText, readDescriptions, titleOf } from '../../src/formats/descriptions.ts';
import { masDescription } from '../../src/engine/scenario.ts';
import { readFreeModeNames, readMasterTable } from '../../src/formats/masterTable.ts';
import { cursorStatus, pointer, startInput } from '../../src/ui/battle/session.ts';
import { engineData } from './engineData.ts';
import { pixelOf } from './pixels.ts';
import { exe, mapOf, read } from './screenCases.ts';

const texts = readDescriptions(exe);

it('설명 표(0x46222c 지형, 0x46226c 네이티얼, 0x4622d0 마스터)', () => {
  expect(texts.terrain).toHaveLength(17);
  expect(texts.terrain[0].startsWith(' <Plain> \nA flat and even area.')).toBe(true);
  expect(texts.natials[1].startsWith(' <Fa-Rancell> ')).toBe(true);
  expect(texts.masters.map(titleOf).slice(0, 3)).toEqual(['Fighter', 'Duke', 'Swordsman']);
});

it('단계 1의 상태 줄은 커서 칸의 유닛 또는 지형 설명(0x403bde)', () => {
  const map = mapOf(3);
  const data = engineData(map);
  const state = startFreeBattle({ masters: readMasterTable(exe), oa: data.oa, names: readFreeModeNames(exe) }, map);
  const s = startInput({ state, actor: 0 });
  const master = unitOf(state, 0);
  expect(cursorStatus(data, texts, s)).toBe(texts.masters[master.type]);
  const plain = { x: master.x, y: master.y + 2 };
  const grid = workGrid(map, state);
  const there = pointer(data, s, ...pixelOf(map, state, plain), false);
  expect(cursorStatus(data, texts, there)).toBe(texts.terrain[partByte(map, grid[plain.y * GRID + plain.x], 0x62)]);
  expect(cursorStatus(data, texts, { ...s, cursor: null })).toBe('');
  expect(cursorStatus(data, texts, { ...s, phase: 2 })).toBeNull();
});

it('시나리오의 진영 1 마스터 설명은 맵 MAS의 글(0x42d2e9 → 0x424fbf: MAS +0x1c → 0x483bec, 0x424ed3·0x424f45)', () => {
  const map = mapOf(0);
  const data = engineData(map);
  const state = startFreeBattle({ masters: readMasterTable(exe), oa: data.oa, names: readFreeModeNames(exe) }, map);
  const scenario = { ...texts, enemyMaster: masDescription(read(map.header.enemyMasterId)) };
  expect(scenario.enemyMaster.startsWith(' <Rami-Ruth> \nA guardian warrior of law.')).toBe(true);
  const enemy = unitOf(state, 1);
  expect(enemy.side).toBe(1);
  const s = startInput({ state, actor: 0 });
  const there = pointer(data, s, ...pixelOf(map, state, { x: enemy.x, y: enemy.y }), false);
  expect(cursorStatus(data, scenario, there)).toBe(scenario.enemyMaster);
  expect(cursorStatus(data, texts, there)).toBe(texts.masters[enemy.type]);
  expect(cursorStatus(data, scenario, s)).toBe(texts.masters[unitOf(state, 0).type]);
  expect([masterText(scenario, 0, 3), masterText(scenario, 1, 3), masterText(texts, 1, 3)]).toEqual([texts.masters[3], scenario.enemyMaster, texts.masters[3]]);
});
