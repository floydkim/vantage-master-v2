import { expect, it } from 'vitest';
import { basePalette, dibColors, timePalette } from '../../src/ui/battle/palette.ts';
import { decodeState } from '../../src/engine/state.ts';
import { inflateBlock, readGolden } from '../engine/block.ts';
import { cases, exe, mapOf, read, stateOf } from './screenCases.ts';

it('팔레트가 원작 DIB 색 표와 같다(픽스처 전부, 첫 차례 진행 뒤 시각)', () => {
  for (const c of cases) {
    const map = mapOf(c.args.map);
    const colors = dibColors(timePalette(exe, map, basePalette(read, map), stateOf(c).timeOfDay));
    expect(Buffer.from(colors.subarray(40, 246 * 4)).toString('hex'), c.args.label).toBe(c.expected.dib);
  }
});

it("대화 상자 음영 'base'(0x402902)가 원작 DIB 색 표와 같다: 어두운 칸 0x76~0xe5번 = 기본 팔레트 6~0x75번(시각 보정 없음), 나머지는 시각 팔레트", async () => {
  const { battleColors, loadBattleArt } = await import('../../src/ui/battle/screen.ts');
  const shades = readGolden<{ args: { label: string; map: number; block: string }; expected: { before: string; dib: string } }>('baseShade');
  expect(shades.length).toBe(3);
  for (const c of shades) {
    const art = loadBattleArt(exe, read, mapOf(c.args.map));
    const state = decodeState(inflateBlock(c.args.block));
    expect(Buffer.from(battleColors(art, state, 'base').subarray(40, 246 * 4)).toString('hex'), c.args.label).toBe(c.expected.dib);
  }
});
