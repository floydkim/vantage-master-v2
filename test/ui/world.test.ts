import { crc32 } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { freeModeSides, toggleItem } from '../../src/engine/battleStart.ts';
import type { SideRecord } from '../../src/engine/state.ts';
import { readFreeModeNames, readMasterTable } from '../../src/formats/masterTable.ts';
import { readActionCosts, readSpeedFactors } from '../../src/formats/actionTable.ts';
import { dibColors, worldPalette } from '../../src/ui/battle/palette.ts';
import {
  clickSounds,
  loadWorldArt,
  MAP_INFO_W,
  mapInfoHit,
  mapInfoImage,
  mapSelectOrder,
  MASTER_INFO_W,
  masterInfoHit,
  masterInfoImage,
  WORLD_W,
  worldHit,
  worldImage,
} from '../../src/ui/world/worldArt.ts';
import { readGolden } from '../engine/block.ts';
import { exe, mapOf, read } from './screenCases.ts';

interface Case {
  readonly kind: string;
  readonly args: Record<string, never> & { selected?: number; hover?: number; frame?: number; map?: number | null; timeLimit?: number; editable?: number; steps?: [string, number][] };
  readonly expected: { bands?: number[]; points?: number[][]; colors?: string; sounds?: number[]; sides?: { spells: number[]; natials: number[]; controller: number }[] };
}
const cases = readGolden<Case>('world');
const art = loadWorldArt(exe, read);
const flags = new Array(52).fill(1);
const bands = (img: Uint8Array, width: number, rows: number) => Array.from({ length: img.length / width / rows }, (_, b) => crc32(img.subarray(b * rows * width, (b + 1) * rows * width)));
const differ = (ours: number[], want: number[]) => want.flatMap((v, i) => (ours[i] === v ? [] : [i]));
const preview = (m: number) => read((10 << 16) | (0xad + m * 2));
const battle = { masters: readMasterTable(exe), oa: { actionCosts: readActionCosts(exe), speedFactors: readSpeedFactors(exe) }, names: readFreeModeNames(exe) };

describe('월드 장면', () => {
  it('월드 창(0x452175): 고른 맵 × 마우스 위 × 깜빡임 프레임', () => {
    const wrong: string[] = [];
    for (const c of cases.filter((k) => k.kind === 'world')) {
      const d = differ(bands(worldImage(art, flags, c.args.selected!, c.args.hover!, c.args.frame!), WORLD_W, 32), c.expected.bands!);
      if (d.length) wrong.push(`${JSON.stringify(c.args)}: 띠 ${d.slice(0, 6)}`);
    }
    expect(wrong).toEqual([]);
  });

  it('점 판정(0x452385): 가운데 ±8', () => {
    for (const [x, y, want] of cases.find((k) => k.kind === 'worldHit')!.expected.points!) expect(worldHit(art, flags, x, y), `${x},${y}`).toBe(want);
  });

  it('맵 정보 창(0x429eec): 맵 52개, 맵 3의 마우스 위·프레임·시간 제한', () => {
    const wrong: string[] = [];
    for (const c of cases.filter((k) => k.kind === 'mapInfo')) {
      const m = c.args.map!;
      const img = mapInfoImage(art, mapOf(m), preview(m), { hover: c.args.hover!, frame: c.args.frame!, timeLimit: c.args.timeLimit! });
      const d = differ(bands(img, MAP_INFO_W, 20), c.expected.bands!);
      if (d.length) wrong.push(`${JSON.stringify(c.args)}: 띠 ${d.slice(0, 6)}`);
    }
    expect(wrong).toEqual([]);
  });

  it('맵 정보 판정(0x42ab35)', () => {
    for (const [x, y, want] of cases.find((k) => k.kind === 'mapInfoHit')!.expected.points!) expect(mapInfoHit(x, y), `${x},${y}`).toBe(want);
  });

  it('마스터 정보 창(0x42b5c2): 마우스 위, 아이콘 토글(0x42d762)·조종(0x42b502) 뒤', () => {
    let sides: [SideRecord, SideRecord] = freeModeSides(battle);
    let controllers: [number, number] = [0, 1];
    const wrong: string[] = [];
    for (const c of cases.filter((k) => k.kind === 'masterInfo')) {
      for (const [kind, n] of c.args.steps ?? []) {
        if (kind === 'toggle') sides = sides.map((r, s) => (s === Math.trunc(n / 30) ? toggleItem(r, n % 30) : r)) as [SideRecord, SideRecord];
        else controllers = controllers.map((v, s) => (s === n ? (v === 0 ? 1 : 0) : v)) as [number, number];
      }
      if (c.expected.sides) {
        c.expected.sides.forEach((e, s) => {
          expect(sides[s].spells, '마법').toEqual(e.spells.slice(1, 1 + e.spells[0]));
          expect(sides[s].natials, '네이티얼').toEqual(e.natials.slice(1, 1 + e.natials[0]));
          expect(controllers[s], '조종').toBe(e.controller);
        });
      }
      const d = differ(bands(masterInfoImage(art, sides, controllers, c.args.hover!, c.args.editable === 1), MASTER_INFO_W, 16), c.expected.bands!);
      if (d.length) wrong.push(`${JSON.stringify(c.args)}: 띠 ${d.slice(0, 6)}`);
    }
    expect(wrong).toEqual([]);
  });

  it('마스터 정보 판정(0x42bef4): 편집 가능 1·0', () => {
    for (const [editable, x, y, want] of cases.find((k) => k.kind === 'masterInfoHit')!.expected.points!) expect(masterInfoHit(x, y, editable === 1), `${editable} ${x},${y}`).toBe(want);
  });

  it('클릭 효과음 표: 점 1·READY 1 + 1·시간 제한 4(같은 값도)·아이콘·조종 4·초상 1, 마우스 위·빈 곳 없음', () => {
    for (const c of cases.filter((k) => k.kind === 'mapInfo' && k.expected.sounds)) {
      // 맵 고르기(0x4514a2(맵, 0))와 시간 제한(0x429db7)이 픽스처에 기록한 소리
      const sounds = c.args.timeLimit === 3 && c.expected.sounds!.length && c.expected.sounds![0] === 1 ? clickSounds('world', c.args.map!) : clickSounds('mapInfo', 2 + c.args.timeLimit!);
      expect(sounds, JSON.stringify(c.args)).toEqual(c.expected.sounds);
    }
    for (const c of cases.filter((k) => k.kind === 'masterInfo' && k.expected.sounds)) {
      const hits = c.args.steps!.map(([kind, n]) => (kind === 'toggle' ? Math.trunc(n / 30) * 32 + 2 + (n % 30) : n * 32 + 1));
      expect(hits.flatMap((h) => clickSounds('masterInfo', h)), JSON.stringify(c.args.steps)).toEqual(c.expected.sounds);
    }
    expect(clickSounds('mapInfo', 0)).toEqual([1, 1]); // READY: 0x45042d·0x429a67
    expect(clickSounds('masterInfo', 0)).toEqual([1]); // 초상(0x42bd5e)
    expect(clickSounds('masterInfo', 32)).toEqual([1]);
    for (const [w, hit] of [['world', -1], ['mapInfo', -1], ['mapInfo', 1], ['masterInfo', -1]] as const) expect(clickSounds(w, hit), `${w} ${hit}`).toEqual([]);
  });

  it('월드 팔레트(공통 + DATA00 0x1d + 50~117의 v/3 사본, 맵을 고르면 7~49번 맵 _PL)', () => {
    const before = cases.find((k) => k.kind === 'palette')!.expected.colors!;
    const ours = Buffer.from(dibColors(worldPalette(read, null)).subarray(40, 246 * 4)).toString('hex');
    const skip = (hex: string) => hex.slice(0, (17 - 10) * 8) + hex.slice((60 - 10) * 8); // 17~59번은 맵 _PL(고르기 전엔 앞 장면 값)
    expect(skip(ours)).toBe(skip(before));
    const m3 = cases.find((k) => k.kind === 'mapInfo' && k.args.map === 3 && k.expected.colors)!;
    expect(Buffer.from(dibColors(worldPalette(read, read(mapOf(3).header.paletteId))).subarray(40, 246 * 4)).toString('hex')).toBe(m3.expected.colors);
  });
});

describe('맵 고르기 창 순서(0x4514a2)', () => {
  it('새로 만든 맵 정보·마스터 정보만 맨 위로, 그 뒤 월드 창이 맨 위면 맨 아래로, 이미 열린 창은 그대로', () => {
    // 처음: 두 창을 만든다(만든 차례로 위), 월드는 맨 위가 아니라 그대로
    expect(mapSelectOrder(['help', 'world'], ['mapInfo', 'masterInfo'], 'world')).toEqual(['help', 'world', 'mapInfo', 'masterInfo']);
    // 두 창이 열린 채 월드가 맨 위: 월드만 맨 아래로
    expect(mapSelectOrder(['help', 'mapInfo', 'masterInfo', 'world'], [], 'world')).toEqual(['world', 'help', 'mapInfo', 'masterInfo']);
    // 도움말이 맨 위: 아무것도 올리지 않는다
    expect(mapSelectOrder(['world', 'mapInfo', 'masterInfo', 'help'], [], 'world')).toEqual(['world', 'mapInfo', 'masterInfo', 'help']);
    // 마스터 정보만 닫혀 있었다: 그것만 새로 맨 위
    expect(mapSelectOrder(['world', 'mapInfo', 'help'], ['masterInfo'], 'world')).toEqual(['world', 'mapInfo', 'help', 'masterInfo']);
  });
});
