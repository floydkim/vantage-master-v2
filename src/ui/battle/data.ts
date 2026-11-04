// 원본(exe와 DAT 읽기)에서 엔진 자료를 만든다. 연출 스크립트(DATA12)는 쓸 때 읽는다.
import { readCombatTables } from '../../engine/rules/combat.ts';
import type { AiData } from '../../ai/world.ts';
import type { EngineData } from '../../engine/turn.ts';
import { readActionCosts, readActions, readActionScripts, readSpeedFactors } from '../../formats/actionTable.ts';
import { readHits } from '../../formats/effectScript.ts';
import type { ExeImage } from '../../formats/exeImage.ts';
import { readMapAi } from '../../formats/mapAi.ts';
import type { GameMap } from '../../formats/mapData.ts';
import { readLightBonus, readNatialTable } from '../../formats/natialTable.ts';
import { readTerrainTables } from '../../formats/terrainTable.ts';
import type { VmDat } from '../../formats/vmFiles.ts';
import type { ReadAny } from './sheet.ts';

const SCRIPTS = 0xc0000;

export function engineData(exe: ExeImage, read: ReadAny, map: GameMap): EngineData {
  return {
    map,
    natials: readNatialTable(exe),
    lightBonus: readLightBonus(exe),
    oa: { actionCosts: readActionCosts(exe), speedFactors: readSpeedFactors(exe) },
    terrain: readTerrainTables(exe),
    combat: readCombatTables(exe),
    actions: readActions(exe),
    scriptHits: (n) => readHits(read(SCRIPTS + n)),
    actionScripts: readActionScripts(exe),
  };
}

/** CPU 생각에 쓰는 자료: 엔진 자료 + 맵 AI 자료(DATA10) */
export const aiData = (exe: ExeImage, read: ReadAny, map: GameMap, dat10: VmDat): AiData => ({ ...engineData(exe, read, map), mapAi: readMapAi(dat10, map.index) });
