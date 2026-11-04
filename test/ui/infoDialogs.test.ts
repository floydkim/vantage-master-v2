import { crc32 } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { SideRecord } from '../../src/engine/state.ts';
import type { Light } from '../../src/formats/natialTable.ts';
import {
  infoRadios,
  magicInfo,
  magicPicture,
  MASTER_PAGE,
  masterInfo,
  NATIAL_PAGE,
  natialInfo,
  readInfoTables,
  unitPortrait,
} from '../../src/ui/battle/infoDialogs.ts';
import { loadBattleArt } from '../../src/ui/battle/screen.ts';
import { readGolden } from '../engine/block.ts';
import { exe, mapOf, read } from './screenCases.ts';

interface Expected {
  readonly texts?: Readonly<Record<string, string>>;
  readonly enabled?: Readonly<Record<string, boolean>>;
  readonly checked?: readonly number[];
  readonly sounds?: readonly number[];
  readonly help?: readonly number[];
  readonly picture?: readonly number[];
  readonly zero?: boolean;
}
interface Case {
  readonly kind: 'natial' | 'radios' | 'magic' | 'master' | 'blank';
  readonly args: Record<string, unknown>;
  readonly expected: Expected;
}
const cases = readGolden<Case>('infoDialogs');
const of = (kind: Case['kind']) => cases.filter((c) => c.kind === kind);
const tables = readInfoTables(exe);
const art = loadBattleArt(exe, read, mapOf(3)); // 오라클 전투(start_screen_battle 맵 3)
const rows = (image: Uint8Array, width: number) => Array.from({ length: image.length / width }, (_, r) => crc32(image.subarray(r * width, (r + 1) * width)));
const keyed = (texts: Readonly<Record<number, string>>) => Object.fromEntries(Object.entries(texts).map(([k, v]) => [k, v]));

describe('정보 대화 상자', () => {
  it('네이티얼 칸(0x444ec8)이 종류 × 레벨 × 밝기마다 원작과 같다(마법 없으면 None과 빈 칸)', () => {
    for (const c of of('natial')) {
      const a = c.args as { type: number; level: 0 | 1 | 2; light: Light };
      expect(keyed(natialInfo(tables, a.type, a.level, a.light)), JSON.stringify(a)).toEqual(c.expected.texts);
    }
  });

  it('레벨·밝기 라디오(0x444c2b)의 체크와 켬이 원작과 같다', () => {
    for (const c of of('radios')) {
      const a = c.args as { type: number | null; allowed: number; lightChanges: number; level: number; light: number };
      const levels = a.allowed !== 0 && a.type !== null;
      const light = levels && tables.natials[a.type! - 1].lightPreference !== 0 && a.lightChanges !== 0;
      const r = infoRadios(a.level, a.light, levels, light);
      const enabled = Object.fromEntries(Object.keys(c.expected.enabled!).map((id) => [id, !r.disabled.includes(Number(id))]));
      expect(enabled, JSON.stringify(a)).toEqual(c.expected.enabled);
      expect(Object.keys(r.checked).map(Number).sort(), JSON.stringify(a)).toEqual(c.expected.checked);
    }
  });

  it('마법 칸(0x4258ca)이 행동마다 원작과 같다(선택이 바뀐 경우만 소리 0·도움말)', () => {
    let last: number | null = null;
    for (const c of of('magic')) {
      const a = c.args as { list: number[]; index: number };
      const action = a.list[a.index];
      if (action === last) {
        expect(c.expected.texts).toEqual({});
        continue;
      }
      last = action;
      expect(keyed(magicInfo(tables, action)), String(action)).toEqual(c.expected.texts);
      expect(c.expected.sounds).toEqual([0]);
      expect(c.expected.help).toEqual([action]);
    }
  });

  it('마스터 칸(0x444376)이 진영 레코드에서 원작과 같다(이름의 &는 &&)', () => {
    for (const c of of('master')) {
      const a = c.args as { name: string; master: number; level: number; attackAction: number; stats: number[] };
      const [maxMp, attack, defense, magic, magicDefense, speed, movement] = a.stats;
      const side = { name: a.name, master: a.master, level: a.level, attackAction: a.attackAction, maxMp, attack, defense, magic, magicDefense, speed, movement } as SideRecord;
      expect(keyed(masterInfo(tables, side)), JSON.stringify(a)).toEqual(c.expected.texts);
    }
  });

  it('그림: 유닛 초상(페이지 0x2e6·0x2d8, 묶음 0 자세 0x10)과 마법 그림(묶음 7 자세 14·15, 빈 칸은 0번 색)이 원작과 같다', () => {
    for (const c of of('natial').filter((c) => c.expected.picture)) {
      const a = c.args as { type: number; side: number };
      expect(rows(unitPortrait(art, a.type + 0x1a, a.side, NATIAL_PAGE), 48), JSON.stringify(a)).toEqual(c.expected.picture);
    }
    for (const c of of('master').filter((c) => c.expected.picture)) {
      const a = c.args as { master: number; side: number };
      expect(rows(unitPortrait(art, a.master, a.side, MASTER_PAGE), 48), JSON.stringify(a)).toEqual(c.expected.picture);
    }
    for (const c of of('magic').filter((c) => c.expected.picture)) {
      const a = c.args as { list: number[]; index: number };
      expect(rows(magicPicture(art, a.list[a.index]), 96), String(a.list[a.index])).toEqual(c.expected.picture);
    }
    expect(of('blank')[0].expected.zero).toBe(true);
  });
});
