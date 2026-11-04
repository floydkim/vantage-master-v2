import { crc32 } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { readScenarioData, type ScenarioMode } from '../../src/engine/scenario.ts';
import { decodeState, STATE_SIZE } from '../../src/engine/state.ts';
import { openExeImage } from '../../src/formats/exeImage.ts';
import { readMasterTable } from '../../src/formats/masterTable.ts';
import { MasterMaking, readMakeMasterData, titleBase } from '../../src/ui/master/makeMaster.ts';
import { loadTitleArt } from '../../src/ui/title/titleArt.ts';
import { readGolden } from '../engine/block.ts';
import { readOriginal } from '../original.ts';
import { read } from './screenCases.ts';

// 원작 창을 틱마다 돌린 기록. 재생성: pnpm oracle make_master
type Event = { tick: number; kind: 'move' | 'click'; x: number; y: number; sounds?: number[] } | { tick: number; kind: 'name'; text: string };
interface Snapshot {
  readonly fields: number[];
  readonly image: number;
  readonly colors: number;
  readonly rand: number;
}
interface Session {
  readonly mode: ScenarioMode;
  /** 누르기 전 창 팔레트 0x4800e0(타이틀이 남긴 색, PALETTEENTRY 236) */
  readonly base: string;
  readonly name: string;
  readonly events: Event[];
  readonly ticks: (Snapshot | null)[];
  readonly prompts: string[];
  readonly bgm: number[];
  readonly world: number;
  readonly side: string;
}
const sessions = readGolden<{ expected: Session }>('makeMaster').map((c) => c.expected);
const exe = openExeImage(readOriginal('vmv2.exe'));
const data = readMakeMasterData(exe, read, { masters: readMasterTable(exe), ...readScenarioData(exe) });

// 픽스처 fields 순서(gen_make_master.py FIELDS)
const fields = (m: MasterMaking) => [
  m.step,
  m.message,
  m.question,
  m.phase,
  m.phaseFrame,
  m.card,
  m.cardFade,
  m.cardText,
  m.hover,
  m.item,
  m.score,
  m.frame,
  m.input,
  m.board,
  m.result,
  m.description,
  m.acquired,
  m.stars.length,
];

/** 세션을 틱마다 되풀이해 look(창, 기록)이 처음 어긋난 틱을 돌려준다 */
function replay(s: Session, look: (m: MasterMaking, want: Snapshot) => unknown, have: (want: Snapshot) => unknown) {
  const m = new MasterMaking(data, s.mode, s.ticks[0]!.rand, Buffer.from(s.base, 'hex'));
  const prompts: string[] = [];
  const sounds: number[][] = [];
  for (let t = 0; t < s.ticks.length; t++) {
    if (t > 0) m.tick();
    if (m.prompt !== null && prompts.length === 0) prompts.push(m.prompt);
    for (const e of s.events.filter((e) => e.tick === t)) {
      if (e.kind === 'name') expect(m.name(e.text), `틱 ${t} 이름`).toBe(true);
      else if (e.kind === 'move') m.move(e.x, e.y);
      else sounds.push(m.click(e.x, e.y));
    }
    const want = s.ticks[t];
    if (want === null) return { closed: m.closed, at: t, m, prompts, sounds };
    const ours = look(m, want);
    if (JSON.stringify(ours) !== JSON.stringify(have(want))) return { mismatch: t, ours, want: have(want) };
  }
  return { closed: m.closed, at: s.ticks.length, m, prompts, sounds };
}

function sideOf(hex: string) {
  const block = new Uint8Array(STATE_SIZE);
  block.set(Buffer.from(hex, 'hex'), 0x18);
  return decodeState(block).sides[0];
}

describe('Master making 창(0x426d90)', () => {
  it('상태 기계: 세션마다 틱별 창 칸·난수가 원작과 같다', () => {
    for (const s of sessions) {
      const r = replay(
        s,
        (m) => [...fields(m), m.seed],
        (w) => [...w.fields, w.rand],
      );
      expect(r, `모드 ${s.mode}`).toMatchObject({ closed: true, at: s.ticks.length - 1 });
    }
  });

  it('그림: 틱마다 DIB(608 × 448)·색 표 10~245 CRC가 원작과 같다', () => {
    for (const s of sessions) {
      const r = replay(
        s,
        (m) => [crc32(m.image), crc32(m.colors.subarray(40, 246 * 4))],
        (w) => [w.image, w.colors],
      );
      expect(r, `모드 ${s.mode}`).toMatchObject({ closed: true, at: s.ticks.length - 1 });
    }
  });

  it('점수와 마스터, 이름 상자 처음 글자, 특수 이름(0x428542), 효과음·BGM', () => {
    for (const s of sessions) {
      const r = replay(
        s,
        () => 0,
        () => 0,
      );
      if (!('m' in r) || !r.m) throw new Error(`모드 ${s.mode}: 끝나지 않음`);
      expect(r.m.player, `모드 ${s.mode}`).toEqual(sideOf(s.side));
      expect(r.prompts).toEqual(s.prompts);
      expect(r.sounds).toEqual(s.events.filter((e) => e.kind === 'click').map((e) => (e as { sounds: number[] }).sounds));
      expect(r.m.bgm).toEqual(s.bgm);
      expect(s.world).toBe(1);
    }
  });

  it('창 팔레트 base: 타이틀 팔레트(0x439d23)에서 만든 색이 누르기 전 원작 0x4800e0과 같다(RGB)', () => {
    const ours = titleBase(loadTitleArt(exe, read).colors);
    const rgb = (b: Uint8Array) => Array.from(b).filter((_, i) => i % 4 !== 3);
    for (const s of sessions) expect(rgb(ours), `모드 ${s.mode}`).toEqual(rgb(Buffer.from(s.base, 'hex')));
  });

  it('repaint(UI 전용): 지금 상태로 다시 그려 선택지 강조만 바로 보인다 — 별·난수·칸은 그대로, 다음 프레임은 다시 그리지 않은 것과 같다', () => {
    // 세션 0을 첫 질문이 보이는 틱까지 되풀이한 뒤 마우스를 선택지 밖에 두고 한 프레임(두 틱) 그린다
    const upTo = () => {
      const s = sessions[0];
      const m = new MasterMaking(data, s.mode, s.ticks[0]!.rand, Buffer.from(s.base, 'hex'));
      for (let t = 0; t < s.ticks.length; t++) {
        if (t > 0) m.tick();
        if (m.input === 1) {
          m.move(10, 10);
          m.tick();
          m.tick();
          return m;
        }
        for (const e of s.events.filter((e) => e.tick === t)) {
          if (e.kind === 'move') m.move(e.x, e.y);
          else if (e.kind === 'click') m.click(e.x, e.y);
        }
      }
      throw new Error('질문 화면에 닿지 않음');
    };
    const a = upTo();
    const b = upTo();
    const image = a.image.slice();
    const bg = (m: MasterMaking) => (m as unknown as { background: Uint8Array }).background;
    const background = bg(a).slice();
    a.move(300, 305);
    b.move(300, 305);
    expect(a.hover).toBe(0);
    expect(a.image).toEqual(image); // 원작처럼 마우스 이동은 그리지 않는다
    a.repaint();
    const changed = [...a.image.keys()].filter((i) => a.image[i] !== image[i]);
    expect(changed.length).toBeGreaterThan(0);
    expect(changed.every((i) => Math.trunc(i / 608) >= 300 && Math.trunc(i / 608) < 318)).toBe(true); // 첫 선택지 줄만
    expect([bg(a), fields(a), a.stars]).toEqual([background, fields(b), b.stars]);
    a.tick();
    a.tick();
    b.tick();
    b.tick();
    expect([crc32(a.image), fields(a)]).toEqual([crc32(b.image), fields(b)]);
  });
});

describe('Master making 입력 검사', () => {
  /** 세션을 틱마다 되풀이하다 stop(m)이 참인 틱에서 멈춘 기계 */
  const until = (s: Session, stop: (m: MasterMaking) => boolean) => {
    const m = new MasterMaking(data, s.mode, s.ticks[0]!.rand, Buffer.from(s.base, 'hex'));
    for (let t = 0; t < s.ticks.length; t++) {
      if (t > 0) m.tick();
      if (stop(m)) return m;
      for (const e of s.events.filter((e) => e.tick === t)) {
        if (e.kind === 'name') m.name(e.text);
        else if (e.kind === 'move') m.move(e.x, e.y);
        else m.click(e.x, e.y);
      }
    }
    throw new Error('멈출 틱이 없습니다');
  };

  it('질문 중(입력 1) 답 칸 밖(x 220~395, y 300 + 20k ~ 315 + 20k 밖)을 누르면 효과음도 진행도 없다(0x42930f·0x42937e)', () => {
    const m = until(sessions[0], (m) => m.input === 1);
    const before = fields(m);
    for (const [x, y] of [[100, 305], [219, 305], [396, 305], [300, 299], [300, 316 + 20 * 5]]) expect(m.click(x, y), `${x},${y}`).toEqual([]);
    expect(fields(m)).toEqual(before.map((v, i) => (i === 8 ? -1 : v))); // 마우스 위(hover)만 칸 밖으로
  });

  it('이름(0x42959e): 0바이트·17바이트는 거절(상자에 남음), 16바이트는 받는다', () => {
    const m = until(sessions[0], (m) => m.prompt !== null);
    expect([m.name(''), m.name('a'.repeat(17))]).toEqual([false, false]);
    expect(m.prompt).not.toBeNull();
    expect(m.name('a'.repeat(16))).toBe(true);
    expect(m.prompt).toBeNull();
  });
});
