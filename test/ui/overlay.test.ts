import { expect, it } from 'vitest';
import { nextActor } from '../../src/engine/rules/turn.ts';
import { workGrid } from '../../src/engine/rules/terrain.ts';
import { decodeState, type GameState, unitOf } from '../../src/engine/state.ts';
import { SKY_START } from '../../src/ui/battle/field.ts';
import { markerSprites, markUnit, NO_OVERLAY } from '../../src/ui/battle/overlay.ts';
import { overlayOf, type Session, startInput } from '../../src/ui/battle/session.ts';
import { type BattleArt, battleColors, drawBattle, loadBattleArt } from '../../src/ui/battle/screen.ts';
import { decodeSprite, unitSprite } from '../../src/ui/battle/sprites.ts';
import { Stage } from '../../src/ui/battle/stage.ts';
import { inflateBlock, readGolden } from '../engine/block.ts';
import { engineData } from './engineData.ts';
import { crcRows, differentRows, exe, mapOf, read } from './screenCases.ts';

interface UiScene {
  readonly args: { readonly phase: number; readonly cursor: readonly [number, number, number]; readonly action?: number; readonly center?: readonly [number, number] | null };
  readonly expected: { readonly field: readonly number[]; readonly pool: readonly string[]; readonly dim: string; readonly dib: string };
}
interface UiCase {
  readonly label: string;
  readonly map: number;
  readonly block: string;
  readonly scenes: readonly UiScene[];
}
const cases = readGolden<UiCase>('uiScreen');

// 픽스처 장면의 세션: 원작이 단계 진입 함수를 바로 부른 상태와 같게 둔다(단계 사이 전이는 session.test)
function sessionFor(state: GameState, actor: number, s: UiScene['args']): Session {
  const [x, y] = s.cursor;
  const start = startInput({ state, actor });
  const u = unitOf(state, actor);
  const self = { x: u.x, y: u.y }; // 단계 3(명령 메뉴)을 거치면 커서 칸이 차례 유닛 칸(0x40496f → 0x403c8e)
  const action = s.action ?? null;
  switch (s.phase) {
    case 1:
      return { ...start, cursor: { x, y } };
    case 2:
      return { ...start, phase: 2, selected: actor, cursor: { x, y } };
    case 4:
    case 5:
      return { ...start, phase: s.phase, action, cursor: self };
    case 6:
      return { ...start, phase: 6, action, center: { x: s.center![0], y: s.center![1] }, cursor: self };
    default:
      throw new Error(`장면 단계 ${s.phase}`);
  }
}

const scenes = cases.flatMap((c) => {
  const state = decodeState(inflateBlock(c.block));
  const data = engineData(mapOf(c.map));
  const actor = nextActor(state).actor;
  return c.scenes.map((s, i) => ({ c, state, data, actor, s, label: `${c.label} 장면 ${i}(단계 ${s.args.phase})`, overlay: overlayOf(data, sessionFor(state, actor, s.args), s.args.cursor[2]) }));
});

it('픽스처가 단계 1·2·4·5·6 장면과 상태 이상 유닛 위 커서를 담는다', () => {
  expect(new Set(scenes.map((x) => x.s.args.phase))).toEqual(new Set([1, 2, 4, 5, 6]));
  expect(scenes.some((x) => x.s.args.phase === 4 && x.data.actions[x.s.args.action!].areaRadius > 0)).toBe(true);
  const onStatus = scenes.filter(({ state, s }) => state.units.some((u) => u && u.status & 7 && u.x === s.args.cursor[0] && u.y === s.args.cursor[1]));
  expect(onStatus.length).toBeGreaterThan(0);
});

it('어둡게 할 칸과 유닛이 원작과 같다', () => {
  for (const { state, s, overlay, label } of scenes) {
    const bits = Buffer.from(s.expected.dim, 'hex');
    const want = Array.from({ length: 1024 }, (_, i) => (bits[i >> 3] >> (i & 7)) & 1);
    expect(Array.from(overlay.dimCells ?? new Uint8Array(1024)), label).toEqual(want);
    const dimmed = state.units.flatMap((u, i) => (u && decodeSprite(Buffer.from(s.expected.pool[i], 'hex')).tint & 1 ? [i] : []));
    expect([...overlay.dimUnits].sort((a, b) => a - b), label).toEqual(dimmed);
  }
});

it('표시 객체가 원작 풀과 같다(유닛 → 커서 → 차례 표식 → 범위 표식)', () => {
  for (const { c, state, s, overlay, label } of scenes) {
    const map = mapOf(c.map);
    const grid = workGrid(map, state);
    const ours = [...state.units.flatMap((u, slot) => (u ? [markUnit(unitSprite(map, grid, u, slot), slot, overlay)] : [])), ...markerSprites(map, grid, state, overlay)];
    const want = s.expected.pool.map((hex) => decodeSprite(Buffer.from(hex, 'hex'))).filter((p) => (p.flags & 0x80) === 0);
    expect(ours, label).toEqual(want);
  }
});

it('UI 표시가 있는 전장 화면이 원작과 같다', () => {
  const arts = new Map<number, BattleArt>();
  const wrong: string[] = [];
  for (const { c, state, s, overlay, label } of scenes) {
    let art = arts.get(c.map);
    if (!art) arts.set(c.map, (art = loadBattleArt(exe, read, mapOf(c.map))));
    const rows = differentRows(crcRows(drawBattle(art, state, { water: 0, sky: SKY_START }, overlay)), s.expected.field);
    if (rows.length) wrong.push(`${label}: 칩 줄 ${rows.slice(0, 5)}`);
  }
  expect(wrong).toEqual([]);
}, 60_000);

it('색 표가 원작과 같다(범위를 보인 뒤에는 어두운 칸, 0x43d3a6 → 0x4027e3)', () => {
  const arts = new Map<number, BattleArt>();
  for (const { c, state, s, label } of scenes) {
    let art = arts.get(c.map);
    if (!art) arts.set(c.map, (art = loadBattleArt(exe, read, mapOf(c.map))));
    expect(Buffer.from(battleColors(art, state, s.args.phase !== 1 ? 'dark' : 'black').subarray(40, 246 * 4)).toString('hex'), label).toBe(s.expected.dib);
  }
}, 60_000);

// 생성기처럼 한 판에서 장면을 차례로: 단계 1(커서 프레임 0·2) → 단계 2 → (단계 3 → 단계 4·5·6)…. 원작 풀은 지운 칸까지 같아야 한다
it('연출 틀(Stage)이 단계마다 원작 풀과 같고, 그 풀로 그린 화면도 같다', () => {
  const wrong: string[] = [];
  for (const c of cases) {
    const map = mapOf(c.map);
    const data = engineData(map);
    const art = loadBattleArt(exe, read, map);
    const state = decodeState(inflateBlock(c.block));
    const actor = nextActor(state).actor;
    const a = unitOf(state, actor);
    const home = { x: a.x, y: a.y };
    const stage = new Stage(art, state);
    stage.startTurn(home);
    const cursorSprite = stage.pool[state.units.filter((u) => u).length];
    c.scenes.forEach((sc, i) => {
      const session = sessionFor(state, actor, sc.args);
      if (sc.args.phase > 2) stage.show(state, NO_OVERLAY, home, false); // 0x40484b(3) 사이
      const overlay = overlayOf(data, session, sc.args.cursor[2]);
      stage.show(state, overlay, session.cursor, session.cursorOn);
      stage.cursorFrame = sc.args.cursor[2]; // 생성기가 커서 프레임과 자세를 바로 쓴다
      cursorSprite.pose = 13 + sc.args.cursor[2];
      const label = `${c.label} 장면 ${i}(단계 ${sc.args.phase})`;
      const want = sc.expected.pool.map((hex) => decodeSprite(Buffer.from(hex, 'hex')));
      if (JSON.stringify(stage.pool.map((p) => ({ ...p }))) !== JSON.stringify(want)) wrong.push(`${label}: 풀`);
      const rows = differentRows(crcRows(drawBattle(art, state, { water: 0, sky: SKY_START }, { ...overlay, cursor: stage.cursorView() }, stage.pool)), sc.expected.field);
      if (rows.length) wrong.push(`${label}: 칩 줄 ${rows.slice(0, 5)}`);
    });
  }
  expect(wrong).toEqual([]);
}, 120_000);
