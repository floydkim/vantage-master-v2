import { crc32 } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { readScenarioData, resultLevelUp } from '../../src/engine/scenario.ts';
import { decodeState } from '../../src/engine/state.ts';
import { readMasterTable } from '../../src/formats/masterTable.ts';
import { dibColors, resultPalette } from '../../src/ui/battle/palette.ts';
import { battleEndText, drawResultButtons, drawResultPage, loadResultArt, RESULT_W, resultHit } from '../../src/ui/battle/resultWindow.ts';
import { byteKey } from '../../src/i18n/ko.ts';
import { inflateBlock, readGolden } from '../engine/block.ts';
import { exe, read } from './screenCases.ts';

interface ResultCase {
  readonly kind?: 'scenario';
  readonly args: { readonly game: number; readonly block: string; readonly winner: number; readonly won: number; readonly selected?: number };
  readonly expected: {
    readonly pages: readonly (readonly number[])[] | Readonly<Record<string, readonly number[]>>;
    readonly palette?: string;
    readonly buttons?: readonly { page: number; hover: number; frame: number; crc: number }[];
    readonly last?: number;
    readonly reward?: number;
  };
}
const all = readGolden<ResultCase>('resultWindow');
const cases = all.filter((c) => !c.kind) as (ResultCase & { expected: { pages: readonly (readonly number[])[] } })[];
const bands = (img: Uint8Array) => Array.from({ length: 35 }, (_, b) => crc32(img.subarray(b * 12 * RESULT_W, (b + 1) * 12 * RESULT_W)));

describe('결과 창', () => {
  it('쪽 0~4(요약, 네이티얼, 마법; 마스터 자세 8·9, 목록에 없으면 색 0x79)가 원작과 같다', () => {
    const wrong: string[] = [];
    for (const c of cases) {
      const state = decodeState(inflateBlock(c.args.block));
      const art = loadResultArt(exe, read, state.sides);
      c.expected.pages.forEach((want, page) => {
        const ours = bands(drawResultPage(art, state, c.args.winner, page));
        const diff = want.flatMap((v, i) => (ours[i] === v ? [] : [i]));
        if (diff.length) wrong.push(`판 ${c.args.game} 승자 ${c.args.winner} 쪽 ${page}: 띠 ${diff.slice(0, 8)}`);
      });
    }
    expect(wrong).toEqual([]);
  });

  it('단추(Prev 0쪽 없음, Next/END, 마우스 위 노랑, 프레임 8개)가 원작과 같다', () => {
    const c = cases.find((k) => k.expected.buttons)!;
    const state = decodeState(inflateBlock(c.args.block));
    const art = loadResultArt(exe, read, state.sides);
    for (const b of c.expected.buttons!) {
      const image = drawResultPage(art, state, c.args.winner, b.page);
      drawResultButtons(art, image, b.page, b.hover, b.frame);
      const strip = new Uint8Array(108 * 24);
      for (let y = 0; y < 24; y++) strip.set(image.subarray((372 + y) * RESULT_W + 480, (372 + y) * RESULT_W + 588), y * 108);
      expect(crc32(strip), JSON.stringify(b)).toBe(b.crc);
    }
  });

  it('결과 팔레트(공통 리소스 1·2 + DATA00 0x21)가 원작 DIB 색 표와 같다(전투 값이 남는 17~59·239번은 빼고)', () => {
    for (const c of cases.filter((k) => k.expected.palette)) {
      const dib = dibColors(resultPalette(read, new Uint8Array(236 * 4)));
      const ours = Buffer.concat([dib.subarray(10 * 4, 17 * 4), dib.subarray(60 * 4, 239 * 4), dib.subarray(240 * 4, 246 * 4)]).toString('hex');
      expect(ours).toBe(c.expected.palette);
    }
  });

  it('단추 판정(0x40aa34)', () => {
    expect(resultHit(480, 372, 1)).toBe(0);
    expect(resultHit(527, 395, 1)).toBe(0);
    expect(resultHit(500, 380, 0)).toBe(-1);
    expect(resultHit(540, 380, 0)).toBe(1);
    expect(resultHit(587, 380, 4)).toBe(1);
    expect(resultHit(588, 380, 4)).toBe(-1);
    expect(resultHit(500, 396, 1)).toBe(-1);
  });

  it('전투 끝 문구(0x401ec3·0x402020): 사람 진영 이름, Won/Lost, 무승부, 항복', () => {
    const state = decodeState(inflateBlock(cases[0].args.block));
    const as = (c0: number, c1: number) => ({ ...state, sideStates: [{ ...state.sideStates[0], controller: c0 }, { ...state.sideStates[1], controller: c1 }] as typeof state.sideStates });
    const [a, b] = state.sides.map((s) => s.name);
    expect(battleEndText(exe, as(0, 1), 0)).toEqual({ text: `${a} has\xa1\xa1Woned`, won: true });
    expect(battleEndText(exe, as(0, 1), 1)).toEqual({ text: `${a} has\xa1\xa1Losted`, won: false });
    expect(battleEndText(exe, as(1, 1), 1)).toEqual({ text: `${b} has\xa1\xa1Woned`, won: true });
    expect(battleEndText(exe, as(0, 0), 1)).toEqual({ text: `${b} has\xa1\xa1Woned`, won: true });
    const draw = battleEndText(exe, as(0, 1), -1);
    expect({ ...draw, text: byteKey(draw.text) }).toEqual({ text: 'f3d3d809ffafb88f', won: false }); // 무승부 글(원작 문장은 해시로)
    expect(battleEndText(exe, as(0, 1), 1, 0)).toEqual({ text: `${a} has surrendered`, won: false });
    expect(battleEndText(exe, as(0, 0), 1, 0)).toEqual({ text: `${a} has surrendered`, won: true });
  });

  it('시나리오에서 이기면(0x4080ac·0x408447) 레벨 + 1 < 40일 때 쪽 5(레벨·능력치 전후, 오르면 색 0x7b, 보상 그림·"%s is acquired."·설명, 0x409c6d), 쪽 4 단추는 Next', () => {
    const data = { masters: readMasterTable(exe), ...readScenarioData(exe) };
    const wrong: string[] = [];
    for (const c of all.filter((k) => k.kind === 'scenario')) {
      const state = decodeState(inflateBlock(c.args.block));
      const up = resultLevelUp(data, state.sides[0], c.args.selected!);
      const label = `판 ${c.args.game} 맵 ${c.args.selected}`;
      expect(up ? 5 : 4, label).toBe(c.expected.last);
      if (up) expect(up.reward, label).toBe(c.expected.reward);
      const art = loadResultArt(exe, read, state.sides);
      for (const [page, want] of Object.entries(c.expected.pages)) {
        const ours = bands(drawResultPage(art, state, c.args.winner, Number(page), -1, 0, up));
        const diff = want.flatMap((v, i) => (ours[i] === v ? [] : [i]));
        if (diff.length) wrong.push(`${label} 쪽 ${page}: 띠 ${diff.slice(0, 8)}`);
      }
    }
    expect(wrong).toEqual([]);
  });
});
