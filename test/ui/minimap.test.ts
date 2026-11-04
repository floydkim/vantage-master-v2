import { createHash } from 'node:crypto';
import { crc32 } from 'node:zlib';
import { expect, it } from 'vitest';
import { workGrid } from '../../src/engine/rules/terrain.ts';
import { decodeState } from '../../src/engine/state.ts';
import { drawMinimap, MINIMAP_H, MINIMAP_W, minimapMarks, minimapSamples, minimapTerrain, shrinkTables } from '../../src/ui/battle/minimap.ts';
import { timePalette } from '../../src/ui/battle/palette.ts';
import { CHIP, CHIP_W } from '../../src/ui/battle/sheet.ts';
import { loadBattleArt } from '../../src/ui/battle/screen.ts';
import { inflateBlock, readGolden } from '../engine/block.ts';
import { exe, mapOf, read } from './screenCases.ts';

interface MinimapCase {
  readonly label: string;
  readonly map: number;
  readonly block: string;
  /** 원작 칩 색 표본(0x476de8, 0x2000바이트)을 가린 것(투명이 낀 2 × 2 자리 0)의 해시: 원작 그림에서 뽑은 자료라 저장소에 두지 않는다 */
  readonly samplesSha: string;
  /** 그때의 LOGPALETTE 10~245번 RGB의 해시 */
  readonly paletteSha: string;
  readonly terrain: readonly number[];
  readonly marks: readonly (readonly [number, number, number])[];
}
const cases = readGolden<MinimapCase>('minimap');
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex').slice(0, 16);
const rgb = (palette: Uint8Array) => Uint8Array.from({ length: 236 * 3 }, (_, j) => palette[Math.floor(j / 3) * 4 + (j % 3)]);
const rows = (image: Uint8Array) => Array.from({ length: MINIMAP_H }, (_, r) => crc32(image.subarray(r * MINIMAP_W, (r + 1) * MINIMAP_W)));

it('전투 시작의 팔레트(LOGPALETTE 10~245번)는 그 시각의 팔레트다', () => {
  for (const c of cases) {
    const map = mapOf(c.map);
    const art = loadBattleArt(exe, read, map);
    const state = decodeState(inflateBlock(c.block));
    expect(sha(rgb(timePalette(exe, map, art.base, state.timeOfDay))), c.label).toBe(c.paletteSha);
  }
});

it('미니맵 표본(0x40d53d·0x4232a9, 맵별 부류 0x4231af), 우리 표본으로 그린 지형 버퍼(0x40d5ca), 유닛 표식 목록(0x40d977)이 원작과 같다', () => {
  const wrong: string[] = [];
  for (const c of cases) {
    const map = mapOf(c.map);
    const art = loadBattleArt(exe, read, map);
    const state = decodeState(inflateBlock(c.block));
    const logical = new Uint8Array(1024); // 원작 색표 대신 우리 색표(위 시험이 같음을 확인)
    logical.set(timePalette(exe, map, art.base, state.timeOfDay).subarray(0, 236 * 4), 10 * 4);
    const samples = minimapSamples(art.sheet.chips, logical, shrinkTables(exe, map));
    // 2 × 2에 투명(0) 칸이 있으면 원작은 작업 버퍼(0x483f00)에 남은 값을 둔다: 어느 부품도 쓰지 않는 칩이라 0으로 가려 비교한다(생성기도 같은 가림)
    const opaque = (k: number) => {
      const e = k >> 2;
      const at = (e >> 1) * CHIP + (e & 1) * 6 * CHIP_W + (k & 3) * 6;
      return [0, 1, CHIP_W, CHIP_W + 1].every((d) => art.sheet.chips[at + d] !== 0);
    };
    if (sha(samples.map((v, k) => (opaque(k) ? v : 0))) !== c.samplesSha) wrong.push(`${c.label}: 표본 해시 다름`);
    const grid = workGrid(map, state);
    const ourRows = rows(minimapTerrain(map, grid, samples)).flatMap((v, r) => (v !== c.terrain[r] ? [r] : []));
    if (ourRows.length) wrong.push(`${c.label}: 우리 표본으로 그린 지형 줄 ${ourRows.slice(0, 6)}`);
    const marks = minimapMarks(map, grid, state).map((m) => [m.x, m.y, m.side]);
    if (JSON.stringify(marks) !== JSON.stringify(c.marks)) wrong.push(`${c.label}: 표식 ${JSON.stringify(marks)} / ${JSON.stringify(c.marks)}`);
  }
  expect(wrong).toEqual([]);
}, 120_000);

it('미니맵 창: 유닛 표식은 6 × 6(모서리 없음, 테두리 0xb, 안 4 × 4 진영색 0x79·0x75), 보이는 사각형은 전장 픽셀 / 6에 펜 0xb 안쪽·0xa 바깥(0x40dc9d)', () => {
  const bg = new Uint8Array(MINIMAP_W * MINIMAP_H).fill(0x50); // 바깥 펜 0xa는 바탕색(10)과 같아 다른 값으로 채운다
  const at = (img: Uint8Array, x: number, y: number) => img[y * MINIMAP_W + x];
  const img = drawMinimap(bg, [{ x: 5, y: 30, side: 0 }, { x: 20, y: 30, side: 1 }], { left: 600, top: 360, right: 1200, bottom: 720 });
  // 표식: x0 = 4x + 1, y0 = 2y
  expect([at(img, 21, 60), at(img, 21, 57), at(img, 22, 61), at(img, 22, 60), at(img, 22, 56), at(img, 26, 57)]).toEqual([0xb, 0xb, 0xb, 0x79, 0xb, 0xb]);
  expect([at(img, 21, 61), at(img, 21, 56), at(img, 26, 61)]).toEqual([0x50, 0x50, 0x50]); // 모서리
  expect(at(img, 82, 58)).toBe(0x75);
  // 사각형 (100, 60)~(200, 120): 안쪽 둘레 0xb, 바깥 0xa(왼쪽 위 모서리 바깥은 비움)
  const ring = (x0: number, y0: number, x1: number, y1: number) => [...Array(x1 - x0 + 1).keys()].flatMap((i) => [[x0 + i, y0], [x0 + i, y1]]).concat([...Array(y1 - y0 + 1).keys()].flatMap((i) => [[x0, y0 + i], [x1, y0 + i]]));
  expect(new Set(ring(100, 60, 199, 119).map(([x, y]) => at(img, x, y)))).toEqual(new Set([0xb]));
  const corner = (x: number, y: number) => (x === 99 || x === 200) && (y === 59 || y === 120);
  expect(new Set(ring(99, 59, 200, 120).filter(([x, y]) => !corner(x, y)).map(([x, y]) => at(img, x, y)))).toEqual(new Set([0xa]));
  // 바깥 선 넷은 따로 그어 LineTo가 끝점을 그리지 않으므로 바깥 모서리 넷은 비고, 안은 그대로
  expect([at(img, 99, 59), at(img, 200, 59), at(img, 200, 120), at(img, 99, 120), at(img, 150, 90)]).toEqual([0x50, 0x50, 0x50, 0x50, 0x50]);
});
