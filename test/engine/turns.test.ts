import { expect, it } from 'vitest';
import { apply } from '../../src/engine/apply.ts';
import type { Command } from '../../src/engine/command.ts';
import { readCombatTables } from '../../src/engine/rules/combat.ts';
import { actionTargets } from '../../src/engine/rules/action.ts';
import { canStop, movementRange, moverOf } from '../../src/engine/rules/movement.ts';
import { cellHeights, partByte, terrainGraph, workGrid } from '../../src/engine/rules/terrain.ts';
import { summonCells } from '../../src/engine/rules/summon.ts';
import { nextActor } from '../../src/engine/rules/turn.ts';
import { decodeState, encodeState, type GameState, type SideState, unitOf } from '../../src/engine/state.ts';
import { applyCommand, type EngineData, startTurn, type TurnResult } from '../../src/engine/turn.ts';
import { type SideChoice, startFreeBattle } from '../../src/engine/battleStart.ts';
import { readFreeModeNames, readMasterTable } from '../../src/formats/masterTable.ts';
import { readActionCosts, readActions, readActionScripts, readSpeedFactors } from '../../src/formats/actionTable.ts';
import { readHits } from '../../src/formats/effectScript.ts';
import { openExeImage } from '../../src/formats/exeImage.ts';
import { loadMap, type ReadResource } from '../../src/formats/mapData.ts';
import { readLightBonus, readNatialTable } from '../../src/formats/natialTable.ts';
import { readTerrainTables } from '../../src/formats/terrainTable.ts';
import { openVmDat } from '../../src/formats/vmFiles.ts';
import { readOriginal } from '../original.ts';
import { blockDifferences, inflateBlock, readGolden } from './block.ts';

// 원작이 받은 명령을 실행하는 경로(0x40672d …)로 판 하나를 승패가 나거나 40차례가 될 때까지 돌린 블록(차례마다 입력 대기 상태).
// 원작 유닛 표는 사라진 네이티얼 칸을 비워 두고 소환이 다시 쓰므로 TS도 첫 블록부터 이어서 실행한다. 재생성: pnpm oracle turns
interface RawCommand {
  readonly to: [number, number];
  readonly direction: number;
  readonly kind: number;
  readonly number: number;
  readonly target: [number, number];
}
interface Case {
  /** holes: 첫 블록을 뜰 때 원작 실행 중 유닛 표의 빈 칸 번호(압축 블록에는 드러나지 않는다) */
  readonly args: { readonly map: number; readonly block: string; readonly holes: readonly number[]; readonly commands: readonly RawCommand[] };
  readonly expected: {
    readonly blocks: readonly string[];
    /** 마스터 차례마다 그 진영이 소환할 수 있는 종류 하나와 원작이 고르는 칸(0x4127bb) */
    readonly summonCells: readonly { readonly turn: number; readonly type: number; readonly cells: readonly [number, number][] }[];
    /** 차례마다 행동 주체가 쓸 수 있는 행동 하나와 원작 UI가 고르게 하는 대상 칸(0x405d18·0x40416f·0x410e3d) */
    readonly targets: readonly { readonly turn: number; readonly action: number; readonly cells: readonly [number, number][] }[];
    readonly winner: number | null;
  };
}
const golden = readGolden<Case>('turns');
const exe = openExeImage(readOriginal('vmv2.exe'));
const dat10 = openVmDat(10, readOriginal('DATA10.DAT'));
const read: ReadResource = (id) => dat10.read(id & 0xffff);
const dat12 = openVmDat(12, readOriginal('DATA12.DAT'));
const scripts = Array.from({ length: 0x55 }, (_, n) => readHits(dat12.read(n)));
const base = {
  natials: readNatialTable(exe),
  lightBonus: readLightBonus(exe),
  oa: { actionCosts: readActionCosts(exe), speedFactors: readSpeedFactors(exe) },
  terrain: readTerrainTables(exe),
  combat: readCombatTables(exe),
  actions: readActions(exe),
  scriptHits: (n: number) => scripts[n],
  actionScripts: readActionScripts(exe),
};
const dataFor = (map: number): EngineData => ({ ...base, map: loadMap(exe, read, map) });
const toCommand = (a: RawCommand): Command => ({
  to: { x: a.to[0], y: a.to[1] },
  direction: a.direction,
  kind: a.kind,
  number: a.number,
  target: { x: a.target[0], y: a.target[1] },
});

/** 비교할 수 있는 블록: 모든 유닛의 표시 애니메이션 값(+0x03 % 3, +0x04)을 0으로(연출 동안 원작 대기 애니메이션 0x412f6d가 바꾼다),
 *  유닛 수 뒤 칸을 0으로(원작 압축 0x4071ea는 유닛 수만큼만 쓰고 남은 칸은 이전 압축 바이트로 둔다. 해독은 유닛 수만큼만 읽는다) */
function comparable(block: Uint8Array): Uint8Array {
  const out = new Uint8Array(block);
  const count = new DataView(out.buffer).getInt32(0x9e8, true);
  for (let i = 0; i < count; i++) {
    const at = 0x2e0 + i * 0x24;
    out[at + 3] -= out[at + 3] % 3;
    out[at + 4] = 0;
  }
  out.fill(0, 0x2e0 + count * 0x24, 0x9e8);
  return out;
}

it('판 전체가 원작과 같다(40판: 이동, 방향, 대기, 공격, 마스터·네이티얼 마법(데미지·회복·상태 이상·풀기·둘레·물높이·Bless), 소환(빈 칸 재사용), 되돌리기, 쓰러짐, 점령, 경험치, 승패)', () => {
  expect(golden).toHaveLength(40);
  const seen = { summon: 0, refill: 0, return: 0, won: 0, magic: new Set<number>() };
  for (const [g, c] of golden.entries()) {
    const data = dataFor(c.args.map);
    const decoded = decodeState(inflateBlock(c.args.block));
    const units = [...decoded.units];
    for (const i of c.args.holes) units.splice(i, 0, null);
    let state: GameState = { ...decoded, units };
    let winner: number | null = null;
    for (const [k, raw] of c.args.commands.entries()) {
      const where = `판 ${g} 차례 ${k}: ${JSON.stringify(raw)}`;
      const check = c.expected.summonCells.find((s) => s.turn === k);
      if (check) {
        const actor = nextActor(state).actor;
        const cells = summonCells(data.map, data.terrain, workGrid(data.map, state), data.natials, state, actor, check.type);
        expect(cells.map((p) => [p.x, p.y]), where).toEqual(check.cells);
      }
      const aim = c.expected.targets.find((t) => t.turn === k);
      if (aim) {
        const cells = actionTargets({ map: data.map, grid: workGrid(data.map, state), state }, nextActor(state).actor, data.actions[aim.action]);
        expect(cells.map((p) => [p.x, p.y]), `${where} 행동 ${aim.action}의 대상`).toEqual(aim.cells);
      }
      const holes = state.units.includes(null);
      const result = apply(data, state, toCommand(raw));
      if (!result.ok) throw new Error(`${where}: ${result.reason}`);
      state = result.state;
      if (raw.kind === 2) seen.summon++;
      if (raw.kind === 2 && holes && !state.units.includes(null)) seen.refill++;
      if (raw.kind === 3) seen.return++;
      if (raw.kind === 1 && raw.number >= 10) seen.magic.add(raw.number);
      expect(blockDifferences(comparable(encodeState(state)), comparable(inflateBlock(c.expected.blocks[k]))), where).toEqual([]);
      winner = 'winner' in result ? result.winner : null;
      expect(winner !== null, `${where}: 전투 끝`).toBe(k === c.args.commands.length - 1 && c.expected.winner !== null);
    }
    expect(winner, `판 ${g} 승자`).toBe(c.expected.winner);
    if (winner !== null) seen.won++;
  }
  expect(seen.summon).toBeGreaterThan(30);
  expect(seen.refill).toBeGreaterThan(5);
  expect(seen.return).toBeGreaterThan(10);
  expect(seen.won).toBeGreaterThan(20);
  expect([...seen.magic].sort((a, b) => a - b)).toEqual([10, 11, 12, 13, 14, 15, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33]);
});

// 원작 프리 배틀(값을 흔들지 않음) 한 판을 첫 차례 진행부터 승패까지 돌린 블록. TS는 블록이 아니라 startFreeBattle(같은 맵·마스터·레벨)에서
// 시작해 startTurn과 apply로 이어서 실행한다(② 완료 기준 1). 재생성: pnpm oracle games
interface Game {
  readonly args: { readonly map: number; readonly masters: [number, number]; readonly levels: [number, number]; readonly commands: readonly RawCommand[] };
  readonly expected: { readonly first: string; readonly blocks: readonly string[]; readonly winner: number };
}

it('프리 배틀 한 판을 시작부터 승패까지 원작과 같게 진행한다(6판, 소환·공격·마법·승패)', () => {
  const games = readGolden<Game>('games');
  expect(games).toHaveLength(6);
  const battle = { masters: readMasterTable(exe), oa: base.oa, names: readFreeModeNames(exe) };
  for (const [g, c] of games.entries()) {
    const data = dataFor(c.args.map);
    const sides = c.args.masters.map((master, n) => ({ master, level: c.args.levels[n] })) as [SideChoice, SideChoice];
    const start = startFreeBattle(battle, data.map, sides);
    const humans = { ...start, sideStates: start.sideStates.map((st) => ({ ...st, controller: 0 })) as [SideState, SideState] }; // 두 진영 모두 사람(오라클도 진영 1을 제어 0으로)
    let result: TurnResult = startTurn(data, humans);
    expect(blockDifferences(comparable(encodeState(result.state)), comparable(inflateBlock(c.expected.first))), `판 ${g} 첫 차례`).toEqual([]);
    for (const [k, raw] of c.args.commands.entries()) {
      const where = `판 ${g} 차례 ${k}: ${JSON.stringify(raw)}`;
      if ('winner' in result) throw new Error(`${where}: 전투가 이미 끝났습니다`);
      const r = apply(data, result.state, toCommand(raw));
      if (!r.ok) throw new Error(`${where}: ${r.reason}`);
      result = r;
      expect(blockDifferences(comparable(encodeState(result.state)), comparable(inflateBlock(c.expected.blocks[k]))), where).toEqual([]);
    }
    expect('winner' in result ? result.winner : null, `판 ${g} 승자`).toBe(c.expected.winner);
  }
});

const first = (): { data: EngineData; state: GameState; actor: number } => {
  const c = golden[0];
  const state = decodeState(inflateBlock(c.args.block));
  return { data: dataFor(c.args.map), state, actor: nextActor(state).actor };
};

it('규칙에 어긋나는 명령은 상태를 두고 { ok: false, reason }을 돌려준다', () => {
  const { data, state, actor } = first();
  const self = unitOf(state, actor);
  const here = { x: self.x, y: self.y };
  const far = { x: (self.x + 16) % 32, y: (self.y + 16) % 32 };
  const own = actor < 2 ? state.sides[self.side].attackAction : base.natials[self.type - 1].attackAction;
  const reason = (command: Command) => {
    const r = apply(data, state, command);
    return r.ok ? null : r.reason;
  };
  expect(reason({ to: here, direction: 0, kind: 1, number: own, target: far })).toContain('대상이 아닙니다');
  expect(reason({ to: far, direction: 0, kind: 0, number: 0, target: here })).toContain('이동 범위 밖');
  expect(reason({ to: here, direction: 0, kind: 1, number: own === 1 ? 2 : 1, target: here })).toContain('쓸 수 없는 행동');
  expect(reason({ to: { x: 37, y: self.y }, direction: 0, kind: 0, number: 0, target: here })).toContain('격자 밖');
  expect(reason({ to: here, direction: 0, kind: 1, number: own, target: { x: -1, y: 0 } })).toContain('격자 밖');
  expect(reason({ to: here, direction: 6, kind: 0, number: 0, target: here })).toContain('방향은 0~5');
  expect(reason({ to: here, direction: 0, kind: 4, number: 0, target: here })).toContain('명령 종류는 0~3');
  const dead = { ...state, units: state.units.map((u, i) => (i === 0 && u ? { ...u, hp: 0 } : u)) };
  expect(apply(data, dead, { to: here, direction: 0, kind: 0, number: 0, target: here })).toEqual({ ok: false, reason: '전투가 끝났습니다' });
});

it('소환·되돌리기 규칙 위반: 네이티얼의 소환, 목록에 없는 종류, 모자란 MP, 고를 수 없는 칸, 진영 유닛 25개, 네이티얼 차례의 되돌리기, 아군 네이티얼이 아닌 대상, 이동 뒤 되돌리기', () => {
  // 첫 블록 가운데 소환할 칸이 있는 마스터 차례와 네이티얼 차례를 하나씩 찾는다
  const turns = golden.map((c) => {
    const state = decodeState(inflateBlock(c.args.block));
    const data = dataFor(c.args.map);
    const actor = nextActor(state).actor;
    const type = state.sides[unitOf(state, actor).side].natials[0];
    const cells = actor < 2 ? summonCells(data.map, data.terrain, workGrid(data.map, state), data.natials, state, actor, type) : [];
    return { data, state, actor, type, cells };
  });
  const master = turns.find((t) => t.actor < 2 && t.cells.length > 0);
  const natial = turns.find((t) => t.actor >= 2);
  if (!master || !natial) throw new Error('픽스처에 소환할 수 있는 마스터 차례나 네이티얼 차례가 없습니다');
  const reason = (t: { data: EngineData; state: GameState }, command: Command) => {
    const r = apply(t.data, t.state, command);
    return r.ok ? null : r.reason;
  };
  const m = unitOf(master.state, master.actor);
  const at = { x: m.x, y: m.y };
  const side = master.state.sides[m.side];
  const withMp = (mp: number): GameState => ({ ...master.state, sideStates: master.state.sideStates.map((s) => ({ ...s, mp })) as [SideState, SideState] });
  const rich = { data: master.data, state: withMp(999) };
  const summon = (n: number, target = master.cells[0]) => ({ to: at, direction: 0, kind: 2, number: n, target });
  expect(apply(rich.data, rich.state, summon(master.type)).ok).toBe(true);
  const missing = Array.from({ length: 24 }, (_, i) => i + 1).find((n) => !side.natials.includes(n));
  if (missing) expect(reason(rich, summon(missing))).toContain('소환할 수 없습니다');
  expect(reason({ data: master.data, state: withMp(0) }, summon(master.type))).toContain('MP가 모자랍니다');
  expect(reason(rich, summon(master.type, at))).toContain('에는 소환할 수 없습니다');
  // 진영 유닛 수(마스터 포함)가 25면 소환 메뉴가 꺼진다(0x40496f)
  const full = { ...rich.state, sideStates: rich.state.sideStates.map((st, i) => (i === m.side ? { ...st, unitCount: 25 } : st)) as [SideState, SideState] };
  expect(reason({ data: master.data, state: full }, summon(master.type))).toContain('진영 유닛이 25개');
  // 되돌리기: 마스터 차례에 이동하기 전, 같은 진영 네이티얼만(유닛 메뉴 0x404c02)
  const keeper = turns.find((t) => t.actor < 2 && t.state.units.some((u, i) => i >= 2 && u && u.side === unitOf(t.state, t.actor).side));
  if (!keeper) throw new Error('픽스처에 아군 네이티얼이 있는 마스터 차례가 없습니다');
  const k = unitOf(keeper.state, keeper.actor);
  const here = { x: k.x, y: k.y };
  const ownNatial = keeper.state.units.find((u, i) => i >= 2 && u && u.side === k.side);
  const enemy = unitOf(keeper.state, 1 - keeper.actor);
  if (!ownNatial) throw new Error('아군 네이티얼이 없습니다');
  const back = (target: { x: number; y: number }, to = here) => ({ to, direction: 0, kind: 3, number: 0, target });
  expect(apply(keeper.data, keeper.state, back({ x: ownNatial.x, y: ownNatial.y })).ok).toBe(true);
  expect(reason(keeper, back({ x: enemy.x, y: enemy.y }))).toContain('되돌릴 아군 네이티얼이 없습니다');
  expect(reason(keeper, back(here))).toContain('되돌릴 아군 네이티얼이 없습니다');
  const grid = workGrid(keeper.data.map, keeper.state);
  const mover = moverOf(keeper.state, keeper.data.natials, keeper.actor);
  const range = movementRange(keeper.data.terrain, terrainGraph(keeper.data.terrain, keeper.data.map, grid, mover.moveType), cellHeights(keeper.data.map, grid), keeper.state, keeper.actor, mover);
  const step = Array.from({ length: 1024 }, (_, i) => ({ x: i % 32, y: i >> 5 })).find((c) => (c.x !== k.x || c.y !== k.y) && canStop(range, c.x, c.y));
  if (!step) throw new Error('마스터가 옮겨 갈 칸이 없습니다');
  expect(reason(keeper, back({ x: ownNatial.x, y: ownNatial.y }, step))).toContain('이동하기 전에만');
  const n = unitOf(natial.state, natial.actor);
  const other = { x: (n.x + 1) % 32, y: n.y };
  expect(reason(natial, { to: { x: n.x, y: n.y }, direction: 0, kind: 2, number: 1, target: other })).toBe('네이티얼은 소환할 수 없습니다');
  expect(reason(natial, { to: { x: n.x, y: n.y }, direction: 0, kind: 3, number: 0, target: { x: n.x, y: n.y } })).toContain('마스터 차례에만');
});

it('쓸 수 없는 행동 번호, 모자란 MP, 원작 UI가 고르게 하지 않는 대상(아군 공격, 빈 칸, 적 회복, 자기 칸이 아닌 범위 종류 4)은 규칙 위반', () => {
  const turns = golden.map((c) => {
    const state = decodeState(inflateBlock(c.args.block));
    return { data: dataFor(c.args.map), state, actor: nextActor(state).actor };
  });
  const master = turns.find((t) => t.actor < 2);
  const natial = turns.find((t) => t.actor >= 2 && base.natials[unitOf(t.state, t.actor).type - 1].magicAction !== 0);
  if (!master || !natial) throw new Error('픽스처에 마스터 차례나 마법이 있는 네이티얼 차례가 없습니다');
  type Turn = typeof master;
  const cast = (t: Turn, number: number, target?: { x: number; y: number }, state = t.state) => {
    const u = unitOf(t.state, t.actor);
    return apply(t.data, state, { to: { x: u.x, y: u.y }, direction: 0, kind: 1, number, target: target ?? { x: u.x, y: u.y } });
  };
  const reason = (r: ReturnType<typeof cast>) => (r.ok ? null : r.reason);
  const spells = master.state.sides[unitOf(master.state, master.actor).side].spells;
  for (const n of [16, 20, 33, 40, 63]) if (!spells.includes(n)) expect(reason(cast(master, n)), `마스터 행동 ${n}`).toContain('쓸 수 없는 행동');
  for (const n of [12, 34, 63]) expect(reason(cast(natial, n)), `네이티얼 행동 ${n}`).toContain('쓸 수 없는 행동');
  // 모자란 MP: 마스터 물높이 마법(범위 종류 5, 자기 칸)
  const poor = { ...master.state, sideStates: master.state.sideStates.map((s) => ({ ...s, mp: 0 })) as [SideState, SideState] };
  expect(reason(cast(master, 10, undefined, poor))).toContain('MP가 모자랍니다');
  // 효과 반경 0인 공격은 적 유닛만: 아군(자기 자신 포함)과 빈 칸은 대상이 아니다
  const m = unitOf(master.state, master.actor);
  const attack = master.state.sides[m.side].attackAction;
  expect(reason(cast(master, attack))).toContain('대상이 아닙니다');
  const empty = Array.from({ length: 1024 }, (_, i) => ({ x: i % 32, y: i >> 5 })).find((c) => !master.state.units.some((u) => u && u.x === c.x && u.y === c.y));
  expect(reason(cast(master, attack, empty))).toContain('대상이 아닙니다');
  // 회복·풀기는 아군만(Medic 14를 적 마스터에게), 범위 종류 4(Explosion 28 등)는 자기 칸만
  const enemy = unitOf(master.state, 1 - master.actor);
  expect(reason(cast(master, 14, { x: enemy.x, y: enemy.y }))).toContain('대상이 아닙니다');
  // 범위 종류 5(Uptide)·4(Explosion: 종류 16 Dullmdaler의 마법 28)는 자기 칸만(0x405d18)
  const rich = { ...master.state, sideStates: master.state.sideStates.map((st) => ({ ...st, mp: 999 })) as [SideState, SideState] };
  const next = { x: (m.x + 1) % 32, y: m.y };
  expect(reason(cast(master, 10, next, rich))).toContain('대상이 아닙니다');
  expect(cast(master, 10, undefined, rich).ok).toBe(true);
  // 받은 명령(CPU 생각·네트워크)은 범위 종류 5면 대상 칸 대신 주체 칸으로 실행한다(0x4067b1 → 0x406cd2): 대상 쪽으로 돌지 않는다
  const uptide = (target: { x: number; y: number }, source: 'ui' | 'received') =>
    apply(master.data, rich, { to: { x: m.x, y: m.y }, direction: 3, kind: 1, number: 10, target }, source);
  const received = uptide(next, 'received');
  const chosen = uptide({ x: m.x, y: m.y }, 'ui');
  if (!received.ok || !chosen.ok) throw new Error('물높이 마법을 실행하지 못했습니다');
  expect(encodeState(received.state)).toEqual(encodeState(chosen.state));
  const n = unitOf(natial.state, natial.actor);
  const blaster = { ...natial.state, units: natial.state.units.map((u, i) => (i === natial.actor && u ? { ...u, type: 16 } : u)), sideStates: rich.sideStates };
  expect(base.actions[base.natials[15].magicAction].rangeKind).toBe(4);
  expect(reason(cast(natial, 28, { x: (n.x + 1) % 32, y: n.y }, blaster))).toContain('대상이 아닙니다');
  expect(cast(natial, 28, undefined, blaster).ok).toBe(true);
});

it('선 칸이 그 이동 타입이 멈출 수 없는 지형이면 공격·마법·소환은 규칙 위반, 대기는 된다(명령 메뉴 0x40496f)', () => {
  // 마스터 차례 첫 블록에서 마스터(이동 타입 1)를 멈출 수 없는 빈 칸에 옮겨 둔다(물높이가 바뀌어 발밑이 깊어진 경우와 같음)
  const found = golden
    .map((c) => {
      const state = decodeState(inflateBlock(c.args.block));
      const data = dataFor(c.args.map);
      const actor = nextActor(state).actor;
      const grid = workGrid(data.map, state);
      const cell = Array.from({ length: 1024 }, (_, i) => ({ x: i % 32, y: i >> 5 })).find(
        (p) => !data.terrain.stoppable[1 * 17 + partByte(data.map, grid[p.y * 32 + p.x], 0x62)] && !state.units.some((u) => u && u.x === p.x && u.y === p.y),
      );
      return { data, state, actor, cell };
    })
    .find((t) => t.actor < 2 && t.cell);
  if (!found?.cell) throw new Error('픽스처에 멈출 수 없는 칸이 있는 마스터 차례가 없습니다');
  const { data, actor, cell } = found;
  const state = { ...found.state, units: found.state.units.map((u, i) => (i === actor && u ? { ...u, x: cell.x, y: cell.y } : u)) };
  const self = unitOf(state, actor);
  const enemy = unitOf(state, 1 - actor);
  const command = (kind: number, number: number, target: { x: number; y: number }) => apply(data, state, { to: cell, direction: 0, kind, number, target });
  expect(command(1, state.sides[self.side].attackAction, { x: enemy.x, y: enemy.y })).toMatchObject({ ok: false, reason: expect.stringContaining('멈출 수 없는 지형') });
  expect(command(1, 10, cell)).toMatchObject({ ok: false, reason: expect.stringContaining('멈출 수 없는 지형') });
  expect(command(2, state.sides[self.side].natials[0], { x: (cell.x + 1) % 32, y: cell.y })).toMatchObject({ ok: false, reason: expect.stringContaining('멈출 수 없는 지형') });
  expect(command(0, 0, cell).ok).toBe(true);
});

it('입력 대기가 아닌 상태는 예외를 던진다', () => {
  const { data, state, actor } = first();
  const self = unitOf(state, actor);
  const here = { x: self.x, y: self.y };
  expect(() => applyCommand(data, { ...state, turnStarted: 0 }, { to: here, direction: 0, kind: 0, number: 0, target: here })).toThrow('입력 대기');
});

it('되살리기(0x401899 → 0x40536c → 0x40546d): 입력 대기 블록(+0x2dc = 1)에서 차례를 시작하면 같은 유닛이 경과 0으로 뽑히고 지형 효과 없이 그 블록 그대로', () => {
  const wrong: string[] = [];
  let checked = 0;
  for (const [g, c] of golden.entries()) {
    const data = dataFor(c.args.map);
    c.expected.blocks.forEach((b, k) => {
      const block = inflateBlock(b);
      const s = decodeState(block);
      if (s.turnStarted !== 1 || s.units.some((u) => u && u.hp < 1)) return;
      checked++;
      const r = startTurn(data, s);
      if ('winner' in r) return void wrong.push(`판 ${g} 블록 ${k}: 전투 끝`);
      const diff = blockDifferences(comparable(encodeState(r.state)), comparable(block));
      if (diff.length) wrong.push(`판 ${g} 블록 ${k}: ${diff.slice(0, 3).join(', ')}`);
    });
  }
  expect(checked).toBeGreaterThan(600);
  expect(wrong).toEqual([]);
});
