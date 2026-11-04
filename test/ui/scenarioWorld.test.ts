import { crc32 } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { readScenarioData, type ScenarioMode, scenarioEnemy } from '../../src/engine/scenario.ts';
import { decodeState, STATE_SIZE } from '../../src/engine/state.ts';
import { readMasterTable } from '../../src/formats/masterTable.ts';
import { dibColors, worldPalette } from '../../src/ui/battle/palette.ts';
import { clickSounds, loadWorldArt, MAP_INFO_W, mapInfoClick, mapInfoHit, mapInfoImage, masterInfoClick, masterInfoHit, WORLD_W, worldImage } from '../../src/ui/world/worldArt.ts';
import { readGolden } from '../engine/block.ts';
import { exe, mapOf, read } from './screenCases.ts';

// 원작 시나리오 월드(0x45102d 뒤)의 그림·맵 고르기. 재생성: pnpm oracle scenario_world
interface Case {
  readonly kind: 'world' | 'select' | 'end' | 'click';
  readonly args: { mode: ScenarioMode; flags: number[]; selected?: number; hover?: number; frame?: number; map?: number };
  readonly expected: {
    bands?: number[];
    colors?: string;
    enemy?: string;
    editable?: number;
    sounds?: number[];
    clicks?: { name: string; x: number; y: number; sounds: number[]; started: number; edit: boolean; changed: boolean; hover: number }[];
  };
}
const cases = readGolden<Case>('scenarioWorld');
const art = loadWorldArt(exe, read);
const data = { masters: readMasterTable(exe), ...readScenarioData(exe) };
const bands = (img: Uint8Array, width: number, rows: number) => Array.from({ length: img.length / width / rows }, (_, b) => crc32(img.subarray(b * rows * width, (b + 1) * rows * width)));
const differ = (ours: number[], want: number[]) => want.flatMap((v, i) => (ours[i] === v ? [] : [i]));
const sideOf = (hex: string) => {
  const block = new Uint8Array(STATE_SIZE);
  block.set(Buffer.from(hex, 'hex'), 0x18);
  return decodeState(block).sides[0];
};

describe('시나리오 월드', () => {
  it('월드 창(0x452175): 모드 이름표(Easy·Normal·Expert), 맵 플래그 0 숨김·1 열림·2 깸', () => {
    const wrong: string[] = [];
    for (const c of cases.filter((k) => k.kind === 'world')) {
      const img = worldImage(art, c.args.flags, c.args.selected!, c.args.hover!, c.args.frame!, c.args.mode);
      const d = differ(bands(img, WORLD_W, 32), c.expected.bands!);
      if (d.length) wrong.push(`${JSON.stringify({ ...c.args, flags: undefined })}: 띠 ${d.slice(0, 6)}`);
    }
    expect(wrong).toEqual([]);
  });

  it('맵 정보(0x429a8e·0x429eec): 깬 맵은 덮개와 미리보기 색 2/3, 보상 아이템(0x42da6c, 맵 0~25) 그림·이름 두 줄', () => {
    const wrong: string[] = [];
    for (const c of cases.filter((k) => k.kind === 'select')) {
      const m = c.args.map!;
      const map = mapOf(m);
      const cleared = c.args.flags[m] === 2;
      const reward = m < data.rewards.length ? data.rewards[m] : -1;
      const img = mapInfoImage(art, map, read((10 << 16) | (0xad + m * 2)), { hover: -1, frame: 0, timeLimit: 3, cleared, reward });
      const d = differ(bands(img, MAP_INFO_W, 20), c.expected.bands!);
      if (d.length) wrong.push(`맵 ${m} 모드 ${c.args.mode}: 띠 ${d.slice(0, 6)}`);
      const colors = Buffer.from(dibColors(worldPalette(read, read(map.header.paletteId), cleared)).subarray(40, 246 * 4)).toString('hex');
      if (colors !== c.expected.colors) wrong.push(`맵 ${m} 모드 ${c.args.mode}: 색 표`);
    }
    expect(wrong).toEqual([]);
  });

  it('맵 고르기(0x4514a2): 적 진영은 맵의 MAS(0x42d2e9, Easy 레벨), 소리 1, 마스터 정보는 편집하지 못함(0x42ad13)', () => {
    for (const c of cases.filter((k) => k.kind === 'select')) {
      const map = mapOf(c.args.map!);
      expect(scenarioEnemy(data, read(map.header.enemyMasterId), c.args.mode), `맵 ${c.args.map}`).toEqual(sideOf(c.expected.enemy!));
      expect([c.expected.sounds, c.expected.editable]).toEqual([[1], 0]);
    }
  });

  it('누르기: 깬 맵의 READY는 아무 일 없음(0x42aa8f +0x10), 시간 제한은 됨, 마스터 정보는 편집 못 하면 아이콘을 무시(0x42bd5e +8)', () => {
    for (const c of cases.filter((k) => k.kind === 'click')) {
      const cleared = c.args.flags[c.args.map!] === 2;
      for (const k of c.expected.clicks!) {
        const label = `맵 ${c.args.map} ${k.name}`;
        if (k.name.startsWith('mapInfo')) {
          const hit = mapInfoHit(k.x, k.y);
          const action = mapInfoClick(hit, cleared);
          expect([hit, action === 'start'], label).toEqual([k.hover, k.started === 1]);
          // READY의 소리 1·1은 원작 0x45042d 안이라(대역) 시작이 아닐 때만 소리를 견준다
          if (action !== 'start') expect(action ? clickSounds('mapInfo', hit) : [], label).toEqual(k.sounds);
        } else {
          const hit = masterInfoHit(k.x, k.y, false);
          const action = masterInfoClick(hit, false);
          expect([hit, action, action ? clickSounds('masterInfo', hit) : []], label).toEqual([k.hover, null, k.sounds]);
          expect([k.edit, k.changed], label).toEqual([false, false]);
        }
      }
    }
  });
});
