import { crc32 } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { EXTENSIONS } from '../../src/engine/battleStart.ts';
import { nextActor } from '../../src/engine/rules/turn.ts';
import { decodeState, encodeState, unitOf } from '../../src/engine/state.ts';
import { readMapLabel } from '../../src/formats/descriptions.ts';
import { datFileName, openVmDat } from '../../src/formats/vmFiles.ts';
import { aiData } from '../../src/ui/battle/data.ts';
import { loadBattleArt } from '../../src/ui/battle/screen.ts';
import { StatusWindow } from '../../src/ui/battle/statusWindow.ts';
import { readTimeTables, shownSide, startTimer, type Timer, tickTimer } from '../../src/ui/battle/timeLimit.ts';
import { inflateBlock, readGolden } from '../engine/block.ts';
import { readOriginal } from '../original.ts';
import { exe, mapOf, read } from './screenCases.ts';

interface Case {
  readonly kind: 'start' | 'tick' | 'strip' | 'shownSide';
  readonly args: {
    timeLimit?: number;
    master?: boolean;
    limit?: number;
    extensions?: number;
    start?: number;
    steps?: (number | null)[][];
    map?: number;
    block?: number;
    controllers?: [number, number];
    actorSide?: number;
  };
  readonly expected: {
    on?: number;
    limit?: number;
    remaining?: number;
    steps?: { remaining: number; limit: number; extensions: number; sounds: number[]; forced: number; ret: number }[];
    rows?: number[][];
    side?: number | null;
    sounds?: number[];
  };
}
const cases = readGolden<Case>('timeLimit');
const tables = readTimeTables(exe);
const games = readGolden<{ args: { map: number }; expected: { blocks: string[] } }>('games');

describe('시간 제한', () => {
  it('표(0x45e0f0·0x45e0fc·0x45e108·0x45e118)', () => {
    expect(tables).toEqual({ master: [30, 60, 120, 15], natial: [15, 30, 60, 1], extensions: [1, 3, 5, 0], extendSeconds: [30, 60, 120, 60] });
    expect(tables.extensions).toEqual(EXTENSIONS); // 엔진의 전투 시작 연장 횟수(0x4017a2)도 같은 표
  });

  it('입력 시작(0x4055cf): 마스터·네이티얼 × 시간 제한 0~3', () => {
    for (const c of cases.filter((k) => k.kind === 'start')) {
      const t = startTimer(tables, c.args.timeLimit!, c.args.master!, 5000);
      if (c.expected.on === 0) expect(t, JSON.stringify(c.args)).toBeNull();
      else expect(t, JSON.stringify(c.args)).toEqual({ start: 5000, limit: c.expected.limit, remaining: c.expected.remaining, warned: [false, false, false, false] });
      // 연장 아이콘(0x476af0): 생성기는 두 진영 모두 사람으로 되살려 차례 시작(0x40536c)이 차례 유닛 진영으로 둔다. 소리 5(입력 시작)는 BattleWindow가 낸다
      const state = decodeState(inflateBlock(games[0].expected.blocks[c.args.block!]));
      expect(shownSide([0, 0], null, unitOf(state, nextActor(state).actor).side), `${JSON.stringify(c.args)} 아이콘`).toBe(c.expected.side);
    }
  });

  it('틱(0x407926): 경고음·연장·만료·걷는 중·큰 건너뜀·시계 감김', () => {
    for (const c of cases.filter((k) => k.kind === 'tick')) {
      let timer: Timer = { start: c.args.start!, limit: c.args.limit!, remaining: c.args.limit! * 6, warned: [false, false, false, false] };
      let extensions = c.args.extensions!;
      c.args.steps!.forEach(([now, p], i) => {
        const r = tickTimer(tables, c.args.timeLimit!, timer, extensions, now!, p === 1);
        const want = c.expected.steps![i];
        const label = `${JSON.stringify({ ...c.args, steps: undefined })} 단계 ${i}`;
        // 만료이면 BattleWindow가 강제 Stand by(0x406cd2)를 부른다: 오라클의 부른 횟수와 같아야 한다
        expect({ remaining: r.timer.remaining, limit: r.timer.limit, extensions: r.extensions, sounds: r.sounds, expired: r.expired, forced: r.expired ? 1 : 0 }, label).toEqual({
          remaining: want.remaining,
          limit: want.limit,
          extensions: want.extensions,
          sounds: want.sounds,
          expired: want.ret === 1,
          forced: want.forced,
        });
        timer = r.timer;
        extensions = r.extensions;
      });
    }
  });

  it('연장 아이콘 진영(0x401d98 → 0x40536c)', () => {
    for (const c of cases.filter((k) => k.kind === 'shownSide')) {
      const controllers = c.args.controllers!;
      expect(shownSide(controllers, shownSide(controllers, null), c.args.actorSide), JSON.stringify(c.args)).toBe(c.expected.side);
    }
  });

  it('정보 창 시간 칸(0x40b50d·0x40ca6d): 켬 × R × 연장, 이어 그림', () => {
    const c = cases.find((k) => k.kind === 'strip')!;
    const game = games[0];
    const map = mapOf(game.args.map);
    const decoded = decodeState(inflateBlock(game.expected.blocks[c.args.block!]));
    const state = { ...decoded, timeLimit: c.args.timeLimit!, timeExtensions: [3, 3] as const };
    const env = { exe, read, art: loadBattleArt(exe, read, map), data: aiData(exe, read, map, openVmDat(10, readOriginal(datFileName(10)))), mapLabel: readMapLabel(exe, game.args.map) };
    const actor = nextActor(state).actor;
    const a = unitOf(state, actor);
    const view = { state, cursor: { x: a.x, y: a.y }, unit: actor, water: 0 };
    const window = new StatusWindow(env, { ...view, time: { on: false, remaining: 0, extensions: 3 } });
    const wrong: string[] = [];
    c.args.steps!.forEach(([on, remaining, extensions], i) => {
      window.update({ ...view, time: { on: on === 1, remaining: remaining!, extensions: extensions ?? 0 } });
      const rows = Array.from({ length: 40 }, (_, r) => crc32(window.image.subarray((300 + r) * 0x104, (300 + r) * 0x104 + 260)));
      const d = rows.flatMap((v, r) => (v === c.expected.rows![i][r] ? [] : [300 + r]));
      if (d.length) wrong.push(`단계 ${i} ${JSON.stringify([on, remaining, extensions])}: 줄 ${d.slice(0, 6)}`);
    });
    expect(wrong).toEqual([]);
  }, 30_000);

  it('상태 블록 +0x14·+0xe64 이름(되살리기·저장 왕복)', () => {
    const block = inflateBlock(games[0].expected.blocks[0]);
    const s = decodeState(block);
    expect(s.timeLimit).toBe(3);
    expect(s.timeExtensions).toEqual([0, 0]);
    expect(Buffer.from(encodeState(s))).toEqual(Buffer.from(block));
    const used = decodeState(encodeState({ ...s, timeLimit: 1, timeExtensions: [2, 3] }));
    expect([used.timeLimit, used.timeExtensions]).toEqual([1, [2, 3]]);
  });
});
