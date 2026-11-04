import { crc32 } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { dibColors } from '../../src/ui/battle/palette.ts';
import { roundAway } from '../../src/ui/title/opening/engine.ts';
import { Opening } from '../../src/ui/title/opening/scenes.ts';
import { loadTitleArt, titleImage } from '../../src/ui/title/titleArt.ts';
import { readGolden } from '../engine/block.ts';
import { exe, read } from './screenCases.ts';

interface Case {
  readonly kind: 'natural';
  readonly expected: {
    /** 틱마다 [상태, 대본 칸, 스텝, DIB CRC, 색 표 10~245번 CRC] */
    readonly ticks: [number, number, number, number, number][];
    readonly scenes: { tick: number; script: number; bands: number[] }[];
    readonly rand: [number, number];
    /** 오프닝 동안 원작이 부른 BGM(0x443770)·효과음(0x443d19) */
    readonly bgm: number[];
    readonly sounds: number[];
  };
}
const [natural] = readGolden<Case>('opening');

it('자연 재생 오프닝 동안 원작은 BGM·효과음을 부르지 않는다(오프닝 엔진도 소리 호출이 없다)', () => {
  expect([natural.expected.bgm, natural.expected.sounds]).toEqual([[], []]);
});
interface Variant {
  readonly kind: 'catchup' | 'skip';
  readonly args: { at?: number };
  readonly expected: {
    ticks?: [number, number, number, number, number][];
    click?: number[];
    color16?: number[];
    after?: number[][];
    rand: [number, number];
    bgm: number[];
  };
}
const variants = readGolden<Variant>('openingVariants');
/** gen_opening_variants.py의 카운터 줄이기: 뒤진 틱(따라잡기)·큰 건너뜀 */
const drop = (t: number) => (t >= 100 && t < 130 ? 62 : t === 400 ? 300 : t >= 500 && t < 600 ? (t % 2 ? 2 : 4) : t >= 1000 && t < 1050 ? 20 : 3);
/** 따라잡기가 3장 글 카드의 다음 장 읽기를 가로질러 원작만 칸 0이 덮이는 틱(의도적 차이, re/ui-input.md): DIB만 비교하지 않는다 */
const ARENA = { from: 129, to: 202 };

const art = loadTitleArt(exe, read);
const menu = crc32(titleImage(art, -1, 0));
const menuColors = crc32(art.colors.subarray(40, 246 * 4));

/** 오라클처럼 틱마다 16ms 카운터를 3 줄이고 48ms 콜백(0x426ca9)을 부른다. 콜백이 끝(false)을 돌려주면 메뉴(상태 2, 0x426235)로 넘어가
 *  그 뒤 화면은 타이틀 메뉴(titleImage)다. 첫 어긋난 틱을 돌려준다 */
function firstMismatch(last: number): { at: string | null; opening: Opening } {
  const o = new Opening(exe, read, natural.expected.rand[0]);
  o.start();
  const e = o.engine;
  let state = 1;
  for (let t = 1; t <= last; t++) {
    e.counter -= 3;
    if (!e.tick() && state !== 2) {
      state = 2;
      if (Buffer.compare(e.dib, art.base) !== 0) return { at: `틱 ${t}: 타이틀 장면 DIB ≠ titleArt 바탕`, opening: o };
    }
    const want = natural.expected.ticks[t - 1];
    const got = [state, e.scriptAt, e.steps, state === 2 ? menu : crc32(e.dib), crc32(dibColors(e.colors).subarray(40, 246 * 4))];
    if (got.some((v, i) => v !== want[i])) return { at: `틱 ${t}: ${JSON.stringify(got)} ≠ ${JSON.stringify(want)}`, opening: o };
  }
  return { at: null, opening: o };
}

describe('오프닝 엔진(0x4887d8)', () => {
  it('__ftol 앞 반올림: 0에서 먼 쪽', () => {
    expect([roundAway(1.5), roundAway(-1.5), roundAway(2.49), roundAway(-0.4)]).toEqual([2, -2, 2, -0]);
  });

  it('시계(0x43307e): 카운터가 300 앞서 가면 한 틱에 80스텝을 따라잡는다(마지막 60 안쪽에서 멈춤)', () => {
    const o = new Opening(exe, read, natural.expected.rand[0]);
    o.start();
    o.engine.counter -= 300;
    o.engine.tick();
    expect(o.engine.steps).toBe(80);
  });

  it('16ms 카운터(0x44e9b1): 오래 멈췄다 와도 0에서 멈추고, 시계가 0x34bc0으로 다시 맞춰 끝까지 돈다', () => {
    const o = new Opening(exe, read, natural.expected.rand[0]);
    o.start();
    o.engine.elapse(0x34bc0 + 10000); // 약 1시간 정지
    expect(o.engine.counter).toBe(0);
    let t = 0;
    while (o.engine.tick() && t++ < 5000) o.engine.elapse(3);
    expect(t).toBeLessThan(5000);
  });

  it('따라잡기(카운터를 고르지 않게 줄임): 상태·대본·스텝·색 표는 틱마다, DIB는 칸 0 별칭 구간 밖에서 원작과 같다', () => {
    const c = variants.find((k) => k.kind === 'catchup')!;
    const o = new Opening(exe, read, c.expected.rand[0]);
    o.start();
    const e = o.engine;
    let state = 1;
    const wrong: string[] = [];
    c.expected.ticks!.forEach((want, i) => {
      const t = i + 1;
      e.elapse(drop(t));
      if (!e.tick() && state !== 2) state = 2;
      const got = [state, e.scriptAt, e.steps, state === 2 ? menu : crc32(e.dib), crc32(dibColors(e.colors).subarray(40, 246 * 4))];
      const skipDib = t >= ARENA.from && t <= ARENA.to;
      if (got.some((v, k) => (k !== 3 || !skipDib) && v !== want[k]) && wrong.length < 5) wrong.push(`틱 ${t}: ${JSON.stringify(got)} ≠ ${JSON.stringify(want)}`);
    });
    expect(wrong).toEqual([]);
    expect(state).toBe(2);
    expect([o.seed, c.expected.bgm]).toEqual([c.expected.rand[1], []]);
  });

  it('중간 건너뛰기(0x426c7c, 틱 650·1800): 클릭 직후 화면은 검정(0x10, 색 16 = 검정), 다음 틱 타이틀 메뉴(titleArt), BGM 8, 난수 그대로', () => {
    const black = crc32(new Uint8Array(768 * 512).fill(0x10));
    for (const c of variants.filter((k) => k.kind === 'skip')) {
      const o = new Opening(exe, read, natural.expected.rand[0]);
      o.start();
      for (let t = 1; t < c.args.at!; t++) {
        o.engine.elapse(3);
        o.engine.tick();
      }
      const label = `틱 ${c.args.at}`;
      expect(o.seed, `${label} 클릭 때 난수`).toBe(c.expected.rand[0]);
      expect([c.expected.click![3], c.expected.color16], `${label} 클릭 직후(TitleScreen 'skip' 단계는 검정)`).toEqual([black, [0, 0, 0]]);
      for (const a of c.expected.after!) expect([a[0], a[3], a[4]], `${label} 뒤`).toEqual([2, menu, menuColors]);
      expect([c.expected.rand[1], c.expected.bgm], label).toEqual([c.expected.rand[0], [8]]);
    }
  });

  it('1~7장과 글 카드, 로고(틱 1~1858), 1859에 타이틀 장면(0x439d23 = titleArt 바탕)으로 메뉴, 난수 4번(2장 거품)', () => {
    const { at, opening } = firstMismatch(1860);
    expect(at).toBeNull();
    expect(opening.seed).toBe(natural.expected.rand[1]);
  });
});
