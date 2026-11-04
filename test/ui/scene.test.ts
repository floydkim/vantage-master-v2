import { crc32 } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { decodeState, STATE_SIZE } from '../../src/engine/state.ts';
import { SceneEngine } from '../../src/ui/scene/engine.ts';
import { readGolden } from '../engine/block.ts';
import { exe, read } from './screenCases.ts';

// 원작 장면 창을 틱마다 돌린 기록. 재생성: pnpm oracle scene
type Snapshot = [image: number, colors: number, threads: number, objects: number, index: number];
interface Run {
  readonly base: string;
  readonly ticks: (Snapshot | null)[];
  readonly end: number;
  readonly next: number;
  readonly index: number;
  readonly bgm: [number, number][];
}
interface Case {
  readonly kind: 'script' | 'late' | 'ending' | 'report';
  readonly args: { kind?: number; master?: number; name?: string; index?: number; late?: [number, number]; stats?: number[] };
  readonly expected: Run;
}
const cases = readGolden<Case>('scene');
const NEXT: Record<number, 'world' | 'title' | null> = { 0: null, 0x4516f4: 'world', 0x425fa0: 'title' };

/** 생성기처럼 연다: ED n(> 0)은 마스터 ED를 연 뒤 0x483528 = n − 1에서 0x41d7e8로 넘어간다 */
function open(c: Case, music: (n: number) => void): SceneEngine {
  const e = new SceneEngine({ exe, read }, c.args.kind!, { name: c.args.name!, master: c.args.master! }, Buffer.from(c.expected.base, 'hex'), music);
  if ((c.args.index ?? 0) > 0) {
    e.index = c.args.index! - 1;
    e.finish();
  }
  return e;
}

/** 틱마다 look이 처음 어긋난 틱, 아니면 끝 */
function replay(c: Case, look: (e: SceneEngine) => unknown, have: (s: Snapshot) => unknown) {
  const bgm: [number, number][] = [];
  let t = 0;
  const e = open(c, (n) => bgm.push([t, n]));
  if (c.args.index) bgm.length = 0; // 생성기도 넘어가기 전 BGM을 지운다
  let counter = 0x34bc0;
  const late = c.args.late;
  for (t = 0; t < c.expected.ticks.length; t++) {
    if (t > 0) {
      counter = Math.max(counter - 3 - (late && t % late[0] === 0 ? late[1] : 0), 0);
      e.tick(counter);
    }
    const want = c.expected.ticks[t];
    if (want === null) return { closed: e.closed, at: t, next: e.next, index: e.index, bgm };
    const ours = look(e);
    if (JSON.stringify(ours) !== JSON.stringify(have(want))) return { mismatch: t, ours, want: have(want) };
  }
  return { closed: e.closed, at: t - 1, next: e.next, index: e.index, bgm };
}

// sceneMore: 위가 지나지 않는 크기·사각형 트윈(0x12~0x15)을 쓰는 ED 7. 재생성: ONLY=more pnpm oracle scene
// sceneChain: 마스터 ED에서 ED 1 끝까지 이어 돌림(ED 사이 글 시계). 재생성: ONLY=chain pnpm oracle scene
const runs = [...cases.filter((c) => c.kind !== 'report'), ...readGolden<Case>('sceneMore'), ...readGolden<Case>('sceneChain')];
const label = (c: Case) => `${c.kind} ${JSON.stringify({ ...c.args, stats: undefined })}`;

describe('장면 엔진(0x41d843·0x41da0d)', () => {
  it('스크립트마다 틱별 스레드·객체 수·ED 번호·색 표 CRC, 끝 틱·다음 장면·BGM이 원작과 같다(늦은 틱 포함)', () => {
    for (const c of runs) {
      // 보고서(ED 0x1b)로 넘어간 틱의 색 표는 보고서 시험이 본다
      const r = replay(
        c,
        (e) => [e.index === 0x1b ? 0 : crc32(e.colors.subarray(40, 246 * 4)), e.threadCount, e.objectCount, e.index],
        (s) => [s[4] === 0x1b ? 0 : s[1], s[2], s[3], s[4]],
      );
      expect(r, label(c)).toEqual({ closed: c.expected.ticks.at(-1) === null, at: c.expected.end, next: NEXT[c.expected.next], index: c.expected.index, bgm: c.expected.bgm });
    }
  }, 120_000);

  it('그림: 틱마다 DIB(768 × 512) CRC가 원작과 같다(처음 어긋난 틱 보고)', () => {
    for (const c of runs) {
      const r = replay(
        c,
        (e) => (e.index === 0x1b ? 0 : crc32(e.image)),
        (s) => (s[4] === 0x1b ? 0 : s[0]),
      );
      expect(r, label(c)).toMatchObject({ at: c.expected.end });
    }
  }, 120_000);
});

// 보고서(0x41c2f2): 진영 0 레코드·통계를 두고 ED 0x1a → 0x41d7e8로 연다. 재생성: ONLY=report pnpm oracle scene
interface Page {
  readonly event: ['hover' | 'click', number, number];
  readonly sounds: number[];
  readonly page?: number;
  readonly hover?: number;
  readonly closed?: boolean;
  readonly snapshot?: Snapshot;
  readonly ticks?: Snapshot[];
}
const reports = readGolden<{ args: { stats: number[] }; expected: { base: string; side: string; start: Snapshot[]; pages: Page[] } }>('sceneReport');

describe('엔딩 잇기와 보고서(0x41d7e8·0x41c2f2)', () => {
  it('엔딩: 마지막 ED(0x1a)가 끝나면 그 틱에 보고서가 열린다(그림·색 표)', () => {
    const c = runs.find((k) => k.kind === 'ending' && k.args.index === 0x1a)!;
    const last = c.expected.ticks.at(-1)!;
    const r = replay(
      c,
      (e) => [crc32(e.image), crc32(e.colors.subarray(40, 246 * 4)), e.index],
      (s) => [s[0], s[1], s[4]],
    );
    expect(last[4]).toBe(0x1b);
    expect(r).toMatchObject({ at: c.expected.end, index: 0x1b });
  }, 120_000);

  it('보고서 세 쪽(통계·네이티얼·마법)·단추 마우스 위·누르기(소리 1)·페이드와 깜빡임, 통계 0, 끝나면 타이틀', () => {
    for (const c of reports) {
      const block = new Uint8Array(STATE_SIZE);
      block.set(Buffer.from(c.expected.side, 'hex'), 0x18);
      const side = decodeState(block).sides[0];
      const e = new SceneEngine({ exe, read }, 6, { name: side.name, master: side.master, natials: side.natials, spells: side.spells, stats: c.args.stats }, Buffer.from(c.expected.base, 'hex'));
      e.index = 0x1a;
      e.finish();
      let counter = 0x34bc0;
      const snap = () => [crc32(e.image), crc32(e.colors.subarray(40, 246 * 4))];
      const tick = () => {
        counter -= 3;
        e.tick(counter);
        return snap();
      };
      const label = `통계 ${c.args.stats[0]}`;
      expect(c.expected.start.map(() => tick()), `${label} 처음`).toEqual(c.expected.start.map((s) => [s[0], s[1]]));
      for (const p of c.expected.pages) {
        const [kind, x, y] = p.event;
        const at = `${label} ${JSON.stringify(p.event)}`;
        const sounds = kind === 'hover' ? (e.move(x, y), []) : e.click(x, y);
        expect(sounds, at).toEqual(p.sounds);
        if (p.closed) {
          expect([e.closed, e.next], at).toEqual([true, 'title']);
          break;
        }
        expect([e.page, e.hover, ...snap()], at).toEqual([p.page, p.hover, p.snapshot![0], p.snapshot![1]]);
        expect(p.ticks!.map(() => tick()), `${at} 틱`).toEqual(p.ticks!.map((s) => [s[0], s[1]]));
      }
    }
  }, 120_000);
});

// 원작 표의 크기: 객체 0x5140 / 0x104 = 80(넘치면 지난 객체 0x483544를 덮고 0x41fa90의 차례 배열 80칸을 넘침), 스레드 0x600 / 0x18 = 64, 팔레트 칸 0x180 / 0xc = 32
class Headless extends SceneEngine {
  protected draw(): void {}
}

describe('장면 스크립트 전체(DATA08 0~5, 마스터 ED 27편, 이어지는 ED 26편)', () => {
  it('끝까지 돌려도 객체 80·스레드 64·팔레트 칸 32를 넘지 않는다', () => {
    const runsOf: [string, number, number, number][] = [
      ...[0, 1, 2, 3, 4, 5].map((k) => [`종류 ${k}`, k, 9, 0] as [string, number, number, number]),
      ...Array.from({ length: 27 }, (_, m) => [`마스터 ED ${m}`, 6, m, 0] as [string, number, number, number]),
      ...Array.from({ length: 26 }, (_, n) => [`ED ${n + 1}`, 6, 9, n + 1] as [string, number, number, number]),
    ];
    const over: string[] = [];
    for (const [label, kind, master, index] of runsOf) {
      const e = new Headless({ exe, read }, kind, { name: 'Floyd', master }, new Uint8Array(0xec * 4));
      if (index > 0) {
        e.index = index - 1;
        e.finish();
      }
      const start = e.index;
      let max = [e.objectCount, e.threadCount, e.slotCount];
      for (let counter = 0x34bc0 - 3, t = 0; !e.closed && e.index === start && t < 20000; counter -= 3, t++) {
        e.tick(counter);
        max = [Math.max(max[0], e.objectCount), Math.max(max[1], e.threadCount), Math.max(max[2], e.slotCount)];
      }
      if (e.index === start && !e.closed) over.push(`${label}: 2만 틱 안에 끝나지 않음`);
      if (max[0] > 80 || max[1] > 64 || max[2] > 32) over.push(`${label}: 객체 ${max[0]}, 스레드 ${max[1]}, 칸 ${max[2]}`);
    }
    expect(over).toEqual([]);
  }, 300_000);
});

it('진영 0 이름의 제어 문자(손댄 세이브)는 장면 글(%M)에서 빈칸으로 — 던지지 않는다(원작은 글리프 표 앞을 읽어 그림)', () => {
  const c = cases.find((k) => k.kind === 'script' && k.args.kind === 0)!;
  const e = new SceneEngine({ exe, read }, 0, { name: 'A\x01', master: c.args.master! }, Buffer.from(c.expected.base, 'hex'));
  let counter = 0x34bc0;
  for (let t = 1; t < c.expected.ticks.length; t++) e.tick((counter = Math.max(counter - 3, 0)));
  expect(e.closed).toBe(true);
});

it('보고서 마우스 이동은 단추 위가 바뀔 때만 true(그때만 다시 그림), 보고서가 아니면 늘 false', () => {
  const c = reports[0];
  const block = new Uint8Array(STATE_SIZE);
  block.set(Buffer.from(c.expected.side, 'hex'), 0x18);
  const side = decodeState(block).sides[0];
  const e = new SceneEngine({ exe, read }, 6, { name: side.name, master: side.master, natials: side.natials, spells: side.spells, stats: c.args.stats }, Buffer.from(c.expected.base, 'hex'));
  expect(e.move(0x290, 0x1d8)).toBe(false); // 아직 ED(보고서가 아님)
  e.index = 0x1a;
  e.finish();
  let counter = 0x34bc0;
  for (let k = 0; k < c.expected.start.length; k++) e.tick((counter -= 3));
  expect(e.move(0x290, 0x1d8)).toBe(true); // 다음 단추 위로
  expect(e.move(0x291, 0x1d9)).toBe(false); // 같은 단추 위
  expect(e.move(10, 10)).toBe(true); // 단추 밖으로
});
