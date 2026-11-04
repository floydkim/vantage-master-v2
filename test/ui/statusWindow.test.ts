import { crc32 } from 'node:zlib';
import { expect, it } from 'vitest';
import { nextActor } from '../../src/engine/rules/turn.ts';
import { decodeState, unitOf } from '../../src/engine/state.ts';
import { datFileName, openVmDat } from '../../src/formats/vmFiles.ts';
import { readMapLabel } from '../../src/formats/descriptions.ts';
import { aiData } from '../../src/ui/battle/data.ts';
import { loadBattleArt } from '../../src/ui/battle/screen.ts';
import { formatC, STATUS_H, STATUS_W, StatusWindow, type StatusView } from '../../src/ui/battle/statusWindow.ts';
import { inflateBlock, readGolden } from '../engine/block.ts';
import { readOriginal } from '../original.ts';
import { exe, mapOf, read } from './screenCases.ts';

interface Scene {
  readonly cursor: readonly [number, number] | null;
  readonly unit: number | null;
  readonly water: number;
  readonly rows: readonly number[];
}
interface StatusCase {
  readonly label: string;
  readonly map: number;
  readonly block: string;
  readonly mapLabel: string;
  readonly scenes: readonly Scene[];
}
const cases = readGolden<StatusCase>('statusWindow');
const dat10 = openVmDat(10, readOriginal(datFileName(10)));
const rowsOf = (image: Uint8Array) => Array.from({ length: STATUS_H }, (_, r) => crc32(image.subarray(r * 0x104, r * 0x104 + STATUS_W)));

it('formatC는 원작 sprintf의 쓰는 부분과 같다', () => {
  expect(formatC('%3d', 7)).toBe('  7');
  expect(formatC('%02d', 5)).toBe('05');
  expect(formatC('%*d', 2, 9)).toBe(' 9');
  expect(formatC('B/H%3d', 120)).toBe('B/H120');
  expect(formatC('%3d(+%3d)', 40, 5)).toBe(' 40(+  5)');
  expect(formatC('%s', 'Walk')).toBe('Walk');
});

it('전투 상태 창이 원작과 같다(장면을 차례로 이어 그림)', () => {
  const wrong: string[] = [];
  for (const c of cases) {
    const map = mapOf(c.map);
    const state = decodeState(inflateBlock(c.block));
    expect(readMapLabel(exe, c.map), c.label).toBe(c.mapLabel); // 0x450b40
    const env = { exe, read, art: loadBattleArt(exe, read, map), data: aiData(exe, read, map, dat10), mapLabel: readMapLabel(exe, c.map) };
    const actor = nextActor(state).actor;
    const a = unitOf(state, actor);
    let window: StatusWindow | null = null;
    c.scenes.forEach((s, i) => {
      // 장면 0: 차례 진행(0x40536c → 0x403c8e)이 커서를 차례 유닛 칸에 두고 그린 상태
      const view: StatusView = i === 0 ? { state, cursor: { x: a.x, y: a.y }, unit: actor, water: 0 } : { state, cursor: s.cursor && { x: s.cursor[0], y: s.cursor[1] }, unit: s.unit, water: s.water };
      if (!window) window = new StatusWindow(env, view);
      else window.update(view);
      const diff = rowsOf(window.image).flatMap((v, r) => (v === s.rows[r] ? [] : [r]));
      if (diff.length) wrong.push(`${c.label} 장면 ${i}: 줄 ${diff.slice(0, 6)}${diff.length > 6 ? ` 외 ${diff.length - 6}` : ''}`);
    });
  }
  expect(wrong).toEqual([]);
}, 60_000);
