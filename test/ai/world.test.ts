import { expect, it } from 'vitest';
import { initialWeights } from '../../src/ai/analysis.ts';
import { type AiData, World } from '../../src/ai/world.ts';
import { fighterOf, readCombatTables } from '../../src/engine/rules/combat.ts';
import { lightPhase } from '../../src/engine/rules/light.ts';
import { decodeState } from '../../src/engine/state.ts';
import { readActionCosts, readActions, readActionScripts, readSpeedFactors } from '../../src/formats/actionTable.ts';
import { openExeImage } from '../../src/formats/exeImage.ts';
import { readMapAi } from '../../src/formats/mapAi.ts';
import { loadMap, type ReadResource } from '../../src/formats/mapData.ts';
import { readLightBonus, readNatialTable } from '../../src/formats/natialTable.ts';
import { readTerrainTables } from '../../src/formats/terrainTable.ts';
import { openVmDat } from '../../src/formats/vmFiles.ts';
import { inflateBlock, readGolden } from '../engine/block.ts';
import { readOriginal } from '../original.ts';

// 상태는 CPU AI 분석 픽스처(aiAnalysis)의 첫 경우를 빌린다(소환·OA·상태 이상·MP·시각·물높이를 흔든 전투)
const golden = readGolden<{ args: { map: number; block: string } }>('aiAnalysis');
const exe = openExeImage(readOriginal('vmv2.exe'));
const dat10 = openVmDat(10, readOriginal('DATA10.DAT'));
const read: ReadResource = (id) => dat10.read(id & 0xffff);
const map = golden[0].args.map;
const data: AiData = {
  map: loadMap(exe, read, map),
  mapAi: readMapAi(dat10, map),
  natials: readNatialTable(exe),
  lightBonus: readLightBonus(exe),
  oa: { actionCosts: readActionCosts(exe), speedFactors: readSpeedFactors(exe) },
  terrain: readTerrainTables(exe),
  combat: readCombatTables(exe),
  actions: readActions(exe),
  scriptHits: () => [],
  actionScripts: readActionScripts(exe),
};
const state = decodeState(inflateBlock(golden[0].args.block));

it('세계의 유닛 능력치는 엔진 fighterOf와 같고 마스터 마법·이동은 진영 레코드에서 온다', () => {
  const w = new World(data, state, initialWeights(data, state));
  const light = lightPhase(state.timeOfDay, data.map.header);
  expect(w.units.length).toBe(state.units.length);
  for (const [i, u] of w.units.entries()) {
    const f = fighterOf(state, data.natials, data.lightBonus, light, i);
    expect({ attack: u!.attack, defense: u!.defense, magic: u!.magic, magicDefense: u!.magicDefense, element: u!.element, expValue: u!.expValue }).toEqual({
      attack: f.attack,
      defense: f.defense,
      magic: f.magic,
      magicDefense: f.magicDefense,
      element: f.element,
      expValue: f.expValue,
    });
  }
  const m = w.units[0]!;
  expect(m.spells).toEqual(state.sides[m.side].spells);
  expect(m.movement).toBe(state.sides[m.side].movement);
});

it('되돌리면 값은 떠 둔 때로 돌아가고 칸 레코드는 같은 객체다(원작 포인터는 칸 주소)', () => {
  const w = new World(data, state, initialWeights(data, state));
  const last = w.units.length - 1;
  const before = w.units[last]!;
  const hp = before.hp;
  w.save();
  before.hp = 1;
  w.units[last] = null;
  const temp = w.allocate(w.newNatial(1, 0));
  expect(w.units.indexOf(temp)).toBe(last);
  expect(temp).toBe(before);
  w.restore();
  expect(w.units[last]).toBe(before);
  expect(before.hp).toBe(hp);
  expect(before.type).toBe(state.units[last]!.type);
});
