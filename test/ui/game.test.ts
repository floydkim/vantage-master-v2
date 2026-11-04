import { expect, it } from 'vitest';
import { freeModeSides } from '../../src/engine/battleStart.ts';
import { unitOf } from '../../src/engine/state.ts';
import { summonCells } from '../../src/engine/rules/summon.ts';
import { workGrid } from '../../src/engine/rules/terrain.ts';
import { readFreeModeNames, readMasterTable } from '../../src/formats/masterTable.ts';
import { aiData } from '../../src/ui/battle/data.ts';
import { cpuStep, type Game, humanStep, seedFromClock, startGame, whoseTurn } from '../../src/ui/battle/game.ts';
import { chooseMenu, press, type Session } from '../../src/ui/battle/session.ts';
import { datFileName, openVmDat } from '../../src/formats/vmFiles.ts';
import { readOriginal } from '../original.ts';
import { pixelOf } from './pixels.ts';
import { exe, mapOf, read } from './screenCases.ts';

const dat10 = openVmDat(10, readOriginal(datFileName(10)));
const battle = { masters: readMasterTable(exe), oa: aiData(exe, read, mapOf(3), dat10).oa, names: readFreeModeNames(exe) };
const setup = { map: 3, battle: { sides: freeModeSides(battle, [{ master: 0, level: 24 }, { master: 1, level: 24 }]), controllers: [0, 1] as const, timeLimit: 3 }, pattern: 'standard' as const };
const begin = () => startGame(aiData(exe, read, mapOf(3), dat10), battle, setup, 1);

// 차례 유닛을 두 번 눌러 제자리에서 명령 메뉴(단계 3)
function standing(g: Game): Session {
  const s = g.session!;
  const where = pixelOf(g.data.map, s.base, unitOf(s.base, s.actor));
  return press(g.data, press(g.data, s, ...where).session, ...where).session;
}

it('사람이 대기만 하는 판을 CPU와 끝까지 또는 120차례 둔다', () => {
  let g = begin();
  const turns = { human: 0, cpu: 0 };
  for (let k = 0; k < 120 && whoseTurn(g) !== 'over'; k++) {
    if (whoseTurn(g) === 'human') {
      g = humanStep(g, chooseMenu(g.data, standing(g), 1));
      turns.human++;
    } else {
      g = cpuStep(g).game;
      turns.cpu++;
    }
  }
  expect(turns.human).toBeGreaterThan(5);
  expect(turns.cpu).toBeGreaterThan(5);
}, 120_000);

it('사람이 소환한 뒤 CPU 생각이 이어진다', () => {
  let g = begin();
  while (whoseTurn(g) !== 'human') g = cpuStep(g).game;
  const s = standing(g);
  const type = s.moved.sides[unitOf(s.moved, s.actor).side].natials[0];
  const phase5 = chooseMenu(g.data, s, 4, type).session;
  expect(phase5.phase).toBe(5);
  const [cell] = summonCells(g.data.map, g.data.terrain, workGrid(g.data.map, s.moved), g.data.natials, s.moved, s.actor, type);
  g = humanStep(g, press(g.data, phase5, ...pixelOf(g.data.map, s.moved, cell)));
  expect(g.result.state.units.filter(Boolean)).toHaveLength(3);
  let cpu = 0;
  for (let k = 0; k < 20 && whoseTurn(g) !== 'over'; k++) {
    if (whoseTurn(g) === 'human') g = humanStep(g, chooseMenu(g.data, standing(g), 1));
    else {
      g = cpuStep(g).game;
      cpu++;
    }
  }
  expect(cpu).toBeGreaterThan(0);
}, 120_000);

it('승패가 나면 over이고 세션이 없으며 진행 함수는 거부한다', () => {
  const g = begin();
  const over: Game = { ...g, result: { state: g.result.state, winner: 0 }, session: null };
  expect(whoseTurn(over)).toBe('over');
  expect(() => cpuStep(over)).toThrow();
  expect(() => humanStep(over, { session: g.session! })).toThrow();
});

it('시드는 UTC 분·초·밀리초(0x452ecf)', () => {
  expect(seedFromClock(new Date('2026-10-22T01:02:03.004Z'))).toBe(2 * 60000 + 3 * 1000 + 4);
});
