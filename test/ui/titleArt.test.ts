import { crc32 } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { aviOrigin, glintFrame, loadTitleArt, MENU_ITEMS, TITLE_H, TITLE_W, titleAction, titleHit, titleImage, titleOrigin, titlePalette } from '../../src/ui/title/titleArt.ts';
import { readGolden } from '../engine/block.ts';
import { exe, read } from './screenCases.ts';

interface Case {
  readonly kind: 'palette' | 'title' | 'hit' | 'return' | 'glint' | 'click';
  readonly args: { hover?: number; t0?: number };
  readonly expected: {
    colors?: string;
    bands?: number[];
    points?: number[][];
    ticks?: [number, number[]][];
    sameDib?: boolean;
    clicks?: Record<string, { sounds: number[]; called: number[]; hover: number; closed: boolean; destroyed: number }>;
  };
}
const cases = readGolden<Case>('title');
const art = loadTitleArt(exe, read);
const bands = (img: Uint8Array) => Array.from({ length: TITLE_H / 32 }, (_, b) => crc32(img.subarray(b * 32 * TITLE_W, (b + 1) * 32 * TITLE_W)));
const differ = (ours: number[], want: number[]) => want.flatMap((v, i) => (ours[i] === v ? [] : [i]));

describe('타이틀(장면 1)', () => {
  it('팔레트(0x439d23): DATA00 1·2번, DATA07 0x15b·0x1a7, 16 검정, 15 파랑', () => {
    expect(Buffer.from(titlePalette(art).subarray(40, 246 * 4)).toString('hex')).toBe(cases.find((k) => k.kind === 'palette')!.expected.colors);
  });

  it('그림(0x439c0b·0x42626f): 바탕 0x1a8·0x1a9 − 7, 로고 0x18a (67, 17), 메뉴 6항목 × 마우스 위', () => {
    const wrong: string[] = [];
    for (const c of cases.filter((k) => k.kind === 'title')) {
      const d = differ(bands(titleImage(art, c.args.hover!, 0)), c.expected.bands!);
      if (d.length) wrong.push(`마우스 위 ${c.args.hover}: 띠 ${d}`);
    }
    expect(wrong).toEqual([]);
    expect(cases.find((k) => k.kind === 'return')!.expected.sameDib, '돌아오는 경로(0x425fa0)도 같은 그림').toBe(true);
  });

  it('반짝임(0x439f40): 메뉴가 뜬 틱 T0 뒤 200틱마다 25프레임(DATA07 0x18b~0x1a3, 사각형 표 0x4731e8)', () => {
    const c = cases.find((k) => k.kind === 'glint')!;
    const wrong: string[] = [];
    for (const [t, want] of c.expected.ticks!) {
      const d = differ(bands(titleImage(art, -1, glintFrame(t - c.args.t0!))), want);
      if (d.length) wrong.push(`틱 ${t}(프레임 ${glintFrame(t - c.args.t0!)}): 띠 ${d}`);
    }
    expect(wrong).toEqual([]);
    expect([glintFrame(200), glintFrame(201), glintFrame(225), glintFrame(226), glintFrame(401)]).toEqual([0, 1, 25, 0, 1]);
  });

  it('판정(0x4269d0): x 316~451, y 336 + 20i ~ 351 + 20i, 틈은 −1', () => {
    for (const [x, y, want] of cases.find((k) => k.kind === 'hit')!.expected.points!) expect(titleHit(x, y), `${x},${y}`).toBe(want);
  });

  it('메뉴 글자(0x465cf8, 17글자)', () => {
    expect(MENU_ITEMS.map((i) => i.length)).toEqual([17, 17, 17, 17, 17, 17]);
    expect(MENU_ITEMS.map((s) => s.trim())).toEqual(['Scenario Mode', 'Expert Mode', 'Free Battle', 'Network Battle', 'Load Data', 'Quit']);
  });

  it('클릭(0x426a3a): 누른 점으로 마우스 위를 다시 정하고, 항목이면 소리 1과 그 항목의 다음 단계', () => {
    // 원작이 부르는 함수 → TS 동작: 0x426727 Select Level, 0x450e35 Expert(마스터 만들기), 0x450ed7 월드, 0x44f2e0 네트워크, 0x441c62 이어 하기·게임 데이터, DestroyWindow(타이틀·프레임) Quit
    const ACTION: Record<number, string> = { 0x426727: 'selectLevel', 0x450e35: 'expertMode', 0x450ed7: 'freeBattle', 0x44f2e0: 'networkBattle', 0x441c62: 'loadData' };
    for (const [key, c] of Object.entries(cases.find((k) => k.kind === 'click')!.expected.clicks!)) {
      const hit = Number(key);
      const want = c.called.length ? ACTION[c.called[0]] : c.destroyed === 2 ? 'quit' : null;
      expect(titleAction(hit), key).toBe(want);
      expect([c.hover, c.sounds], key).toEqual([hit, hit >= 0 ? [1] : []]);
    }
  });

  it('자리: 그림은 화면 가운데(C 나눗셈, 640 × 480은 음수 원점), AVI 320 × 240도 가운데', () => {
    expect(titleOrigin({ width: 1024, height: 768 })).toEqual({ x: 128, y: 128 });
    expect(titleOrigin({ width: 800, height: 600 })).toEqual({ x: 16, y: 44 });
    expect(titleOrigin({ width: 640, height: 480 })).toEqual({ x: -64, y: -16 });
    expect(titleOrigin({ width: 1280, height: 1024 })).toEqual({ x: 256, y: 256 });
    expect(aviOrigin({ width: 1024, height: 768 })).toEqual({ x: 352, y: 264 });
  });
});
