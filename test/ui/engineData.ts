import type { EngineData } from '../../src/engine/turn.ts';
import type { GameMap } from '../../src/formats/mapData.ts';
import { engineData as build } from '../../src/ui/battle/data.ts';
import { exe, read } from './screenCases.ts';

const cache = new Map<GameMap, EngineData>();
export const engineData = (map: GameMap): EngineData => {
  let d = cache.get(map);
  if (!d) cache.set(map, (d = build(exe, read, map)));
  return d;
};
