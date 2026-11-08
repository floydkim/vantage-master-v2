import { expect, it } from 'vitest';
import { loadMap } from '../../src/formats/mapData.ts';
import { mapDescription } from '../../src/ui/world/worldArt.ts';
import { exe, read } from './screenCases.ts';

it('맵 설명(0x424e78): 시나리오 플래그가 서 있으면(시나리오·Expert) 맵 구조체 +0x78, 아니면 +0x1a0', () => {
  const silentHill = loadMap(exe, read, 0);
  const scenario = mapDescription(silentHill, true);
  const free = mapDescription(silentHill, false);
  expect([scenario.includes('Natials have relativity'), scenario.includes('definately advantageous')]).toEqual([true, false]);
  expect([free.includes('Natials have relativity'), free.includes('definately advantageous')]).toEqual([false, true]);
  expect(mapDescription(loadMap(exe, read, 33), true)).toContain('Room of Rituals is of symmetrical form');
});
