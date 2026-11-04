import { isDeepStrictEqual } from 'node:util';
import { expect, it } from 'vitest';
import { apply } from '../../src/engine/apply.ts';
import { startFreeBattle } from '../../src/engine/battleStart.ts';
import { type Cell, type Command, RETURN } from '../../src/engine/command.ts';
import { actionTargets } from '../../src/engine/rules/action.ts';
import { walkPath } from '../../src/engine/rules/move.ts';
import { movementRange, moverOf } from '../../src/engine/rules/movement.ts';
import { summonCells } from '../../src/engine/rules/summon.ts';
import { cellHeights, terrainGraph, workGrid } from '../../src/engine/rules/terrain.ts';
import { nextActor } from '../../src/engine/rules/turn.ts';
import { decodeState, type GameState, MASTERS, unitOf } from '../../src/engine/state.ts';
import { startTurn } from '../../src/engine/turn.ts';
import { readFreeModeNames, readMasterTable } from '../../src/formats/masterTable.ts';
import { directionAt } from '../../src/ui/battle/hex.ts';
import { dimMove } from '../../src/ui/battle/overlay.ts';
import { SKY_START } from '../../src/ui/battle/field.ts';
import {
  actionsOf, chooseMenu, chooseUnitMenu, confirmDestruction, drawnState, menuEnabled, overlayOf, pointer, press, pressRight, type Session, startInput, statusOf, type Step, unitMenuEnabled,
} from '../../src/ui/battle/session.ts';
import { buildSheet } from '../../src/ui/battle/sheet.ts';
import { inflateBlock, readGolden } from '../engine/block.ts';
import { engineData } from './engineData.ts';
import { cellPixels, pixelOf as pixelAt } from './pixels.ts';
import { exe, mapOf, read } from './screenCases.ts';

interface Game {
  readonly args: { readonly map: number };
  readonly expected: { readonly blocks: readonly string[] };
}
const games = readGolden<Game>('games');

const pixelOf = (state: GameState, map: ReturnType<typeof mapOf>, c: Cell): [number, number] => pixelAt(map, state, c);

const freeStart = (mapIndex: number) => {
  const map = mapOf(mapIndex);
  const data = engineData(map);
  const turn = startTurn(data, startFreeBattle({ masters: readMasterTable(exe), oa: data.oa, names: readFreeModeNames(exe) }, map));
  if ('winner' in turn) throw new Error('첫 차례에 전투가 끝났습니다');
  return { map, data, turn };
};

const blockTurn = (g: number, k: number) => {
  const map = mapOf(games[g].args.map);
  const data = engineData(map);
  const state = decodeState(inflateBlock(games[g].expected.blocks[k]));
  return { map, data, turn: { state, actor: nextActor(state).actor } };
};

const at = (s: Session) => unitOf(s.moved, s.actor);

it('차례 유닛을 눌러 움직이고 대기한다', () => {
  const { map, data, turn } = freeStart(3);
  let s = startInput(turn);
  const actor = unitOf(turn.state, turn.actor);
  s = press(data, s, ...pixelOf(turn.state, map, actor)).session;
  expect(s.phase).toBe(2);
  const keep = dimMove(data, turn.state, turn.actor).dimCells!;
  const goal = [...keep.keys()].map((i) => ({ x: i % 32, y: i >> 5 })).find((c) => keep[c.y * 32 + c.x] === 0 && (c.x !== actor.x || c.y !== actor.y))!;
  s = press(data, s, ...pixelOf(turn.state, map, goal)).session;
  expect(s.phase).toBe(3);
  const grid = workGrid(map, turn.state);
  const mover = moverOf(turn.state, data.natials, turn.actor);
  const range = movementRange(data.terrain, terrainGraph(data.terrain, map, grid, mover.moveType), cellHeights(map, grid), turn.state, turn.actor, mover);
  const path = walkPath(data.terrain, range, actor.x, actor.y, goal.x, goal.y);
  expect([at(s).x, at(s).y, at(s).direction]).toEqual([goal.x, goal.y, path[path.length - 1].direction]);
  const step = chooseMenu(data, s, 1);
  expect(step.command).toEqual({ to: goal, direction: at(s).direction, kind: 0, number: 0, target: goal });
  expect(apply(data, turn.state, step.command!, 'ui').ok).toBe(true);
});

it('오른쪽 클릭으로 앞 단계로 돌아간다', () => {
  const { map, data, turn } = freeStart(3);
  const actor = unitOf(turn.state, turn.actor);
  const where = pixelOf(turn.state, map, actor);
  let s = press(data, startInput(turn), ...where).session;
  expect(pressRight(data, s, ...where).session.phase).toBe(1);
  const keep = dimMove(data, turn.state, turn.actor).dimCells!;
  const goal = [...keep.keys()].map((i) => ({ x: i % 32, y: i >> 5 })).find((c) => keep[c.y * 32 + c.x] === 0 && (c.x !== actor.x || c.y !== actor.y))!;
  s = press(data, s, ...pixelOf(turn.state, map, goal)).session;
  const back = pressRight(data, s, 0, 0).session;
  expect([back.phase, at(back).x, at(back).y]).toEqual([2, actor.x, actor.y]);
  expect(chooseMenu(data, s, 0).session.phase).toBe(2);
  const attack = chooseMenu(data, s, 2).session;
  expect(attack).toBe(s); // 첫 차례에는 공격할 대상이 없어 공격이 꺼져 있다
});

// 효과 반경이 있는 마법을 가진 네이티얼 차례: 범위 종류 4(자기 칸 둘레) → 단계 6, 그 밖 → 단계 4 → 칸 → 단계 6
it('마법 대상·효과 범위 단계에서 오른쪽 클릭', () => {
  const seen = new Set<number>();
  for (const [g, game] of games.entries()) {
    for (let k = 0; k < game.expected.blocks.length; k++) {
      const { map, data, turn } = blockTurn(g, k);
      if (turn.actor < MASTERS) continue;
      const [spell] = actionsOf(data, turn.state, turn.actor).spells;
      if (spell === undefined || data.actions[spell].areaRadius === 0) continue;
      const kind = data.actions[spell].rangeKind === 4 ? 4 : 0;
      if (seen.has(kind)) continue;
      const actor = unitOf(turn.state, turn.actor);
      let s = press(data, startInput(turn), ...pixelOf(turn.state, map, actor)).session;
      s = press(data, s, ...pixelOf(turn.state, map, actor)).session;
      if (!menuEnabled(data, s)[2]) continue;
      seen.add(kind);
      const chosen = chooseMenu(data, s, 3).session;
      if (kind === 4) {
        expect(chosen.phase).toBe(6);
        expect(pressRight(data, chosen, 0, 0).session.phase).toBe(3);
        continue;
      }
      expect(chosen.phase).toBe(4);
      expect(pressRight(data, chosen, 0, 0).session.phase).toBe(3);
      const g0 = { map, grid: workGrid(map, s.moved), state: s.moved };
      const [c] = actionTargets(g0, s.actor, data.actions[spell]);
      const area = press(data, chosen, ...pixelOf(s.moved, map, c)).session;
      expect(area.phase).toBe(6);
      expect(pressRight(data, area, 0, 0).session.phase).toBe(4);
    }
  }
  expect([...seen].sort()).toEqual([0, 4]);
});

it('차례 유닛이 아닌 유닛을 왼쪽으로 눌러도 단계 1 그대로', () => {
  const { map, data, turn } = freeStart(3);
  const other = turn.state.units.findIndex((u, i) => u && i !== turn.actor);
  const s = press(data, startInput(turn), ...pixelOf(turn.state, map, unitOf(turn.state, other))).session;
  expect(s.phase).toBe(1);
});

// 이동할 수 있는 칸 몇 개 × 켜진 메뉴 항목으로 원작 UI가 낼 수 있는 명령을 모두 만든다
function allCommands(map: ReturnType<typeof mapOf>, data: ReturnType<typeof engineData>, turn: { state: GameState; actor: number }): Command[] {
  const out: Command[] = [];
  const take = (st: Step) => st.command && out.push(st.command);
  const actor = unitOf(turn.state, turn.actor);
  const keep = dimMove(data, turn.state, turn.actor).dimCells!;
  const cells = [...keep.keys()].filter((i) => keep[i] === 0).map((i) => ({ x: i % 32, y: i >> 5 }));
  const picked = [actor, ...cells.filter((_, i) => i % Math.max(1, Math.floor(cells.length / 5)) === 0)];
  for (const goal of picked) {
    const s1 = press(data, startInput(turn), ...pixelOf(turn.state, map, actor)).session;
    const s = press(data, s1, ...pixelOf(turn.state, map, goal)).session;
    if (s.phase !== 3) continue;
    const enabled = menuEnabled(data, s);
    take(chooseMenu(data, s, 1));
    const { attack, spells } = actionsOf(data, s.moved, s.actor);
    const acts = [...(enabled[1] ? [[2, attack]] : []), ...(enabled[2] ? spells.map((a) => [3, a]) : [])];
    for (const [item, action] of acts) {
      const st = chooseMenu(data, s, item, action);
      take(st);
      const g = { map, grid: workGrid(map, s.moved), state: s.moved };
      if (st.session.phase === 4) {
        for (const c of actionTargets(g, s.actor, data.actions[action])) {
          const hit = press(data, st.session, ...pixelOf(s.moved, map, c));
          take(hit);
          if (hit.session.phase === 6) take(press(data, hit.session, 0, 0));
        }
      } else if (st.session.phase === 6) take(press(data, st.session, 0, 0));
    }
    if (enabled[3]) {
      for (const type of s.moved.sides[at(s).side].natials) {
        const st = chooseMenu(data, s, 4, type);
        if (st.session.phase !== 5) continue;
        for (const c of summonCells(map, data.terrain, workGrid(map, s.moved), data.natials, s.moved, s.actor, type)) take(press(data, st.session, ...pixelOf(s.moved, map, c)));
      }
    }
  }
  return out;
}

it('메뉴로 만든 명령은 엔진이 모두 받는다', () => {
  let total = 0;
  for (const [g, k] of [[0, 3], [0, 10], [1, 8], [2, 18], [3, 30], [4, 6], [5, 12]]) {
    const { map, data, turn } = blockTurn(g, k);
    for (const c of allCommands(map, data, turn)) {
      const r = apply(data, turn.state, c, 'ui');
      expect(r.ok ? 'ok' : r.reason, `게임 ${g} 블록 ${k} ${JSON.stringify(c)}`).toBe('ok');
      total++;
    }
  }
  expect(total).toBeGreaterThan(50);
}, 60_000);

it('MP가 모자라면 마법·소환은 알림만', () => {
  const { map, data, turn } = freeStart(3);
  const side = unitOf(turn.state, turn.actor).side;
  const poor = { ...turn.state, sideStates: turn.state.sideStates.map((ss, i) => (i === side ? { ...ss, mp: 0 } : ss)) as unknown as GameState['sideStates'] };
  const actor = unitOf(poor, turn.actor);
  let s = press(data, startInput({ state: poor, actor: turn.actor }), ...pixelOf(poor, map, actor)).session;
  s = press(data, s, ...pixelOf(poor, map, actor)).session;
  expect(s.phase).toBe(3);
  const spell = poor.sides[side].spells.find((a) => data.actions[a].mpCost > 0)!;
  expect(chooseMenu(data, s, 3, spell)).toEqual({ session: s, alert: 'mp', sounds: [1] }); // 0x405d18은 효과음 1부터
  expect(chooseMenu(data, s, 4, poor.sides[side].natials[0])).toEqual({ session: s, alert: 'mp', sounds: [1] });
});

it('입력 효과음(0x443d19 번호): 고르기 4, 방향 0, 확정 1, 취소 2. 무효인 누름은 없음(0x403fb0·0x4045ee·0x405c74·0x405ce3·0x405e1d)', () => {
  const { map, data, turn } = freeStart(3);
  const actor = unitOf(turn.state, turn.actor);
  const where = pixelOf(turn.state, map, actor);
  const s1 = startInput(turn);
  expect(press(data, s1, 0, 0).sounds).toBeUndefined();
  const p1 = press(data, s1, ...where);
  expect(p1.sounds).toEqual([4]);
  expect(pressRight(data, p1.session, ...where).sounds).toEqual([2]);
  const keep = dimMove(data, turn.state, turn.actor).dimCells!;
  const goal = [...keep.keys()].map((i) => ({ x: i % 32, y: i >> 5 })).find((c) => keep[c.y * 32 + c.x] === 0 && (c.x !== actor.x || c.y !== actor.y))!;
  const p2 = press(data, p1.session, ...pixelOf(turn.state, map, goal));
  expect(p2.sounds).toEqual([4]);
  expect(press(data, p2.session, 0, 0).sounds).toEqual([0]);
  expect(pressRight(data, p2.session, 0, 0).sounds).toEqual([2]);
  expect(chooseMenu(data, p2.session, 0).sounds).toEqual([2]);
  expect(chooseMenu(data, p2.session, 1).sounds).toEqual([1]);
  expect(chooseMenu(data, p2.session, 2).sounds).toBeUndefined(); // 꺼진 항목
  const unit = pressRight(data, s1, ...where);
  expect(unit.sounds).toEqual([4]);
  expect(pressRight(data, unit.session, 0, 0).sounds).toEqual([2, 2]);
  expect(pressRight(data, s1, 0, 0).sounds).toBeUndefined();
});

it('마스터 차례에 아군 네이티얼을 되돌린다(단계 7 → 확인)', () => {
  for (const [g, game] of games.entries()) {
    for (let k = 0; k < game.expected.blocks.length; k++) {
      const { map, data, turn } = blockTurn(g, k);
      if (turn.actor >= MASTERS) continue;
      const side = unitOf(turn.state, turn.actor).side;
      const own = turn.state.units.findIndex((u, i) => u && i >= MASTERS && u.side === side);
      if (own < 0) continue;
      const s = pressRight(data, startInput(turn), ...pixelOf(turn.state, map, unitOf(turn.state, own))).session;
      expect(s.phase).toBe(7);
      expect(unitMenuEnabled(data, s)[9]).toBe(true);
      expect(chooseUnitMenu(data, s, 9)).toMatchObject({ confirm: 'destruction', sounds: [1] });
      expect(confirmDestruction(data, s).sounds).toEqual([1]);
      const c = confirmDestruction(data, s).command!;
      expect(c.kind).toBe(RETURN);
      expect(apply(data, turn.state, c, 'ui').ok).toBe(true);
      return;
    }
  }
  throw new Error('마스터 차례에 아군 네이티얼이 있는 블록이 없습니다');
});

it('입력 시작 때 커서는 차례 유닛 칸에 켜져 있다(0x40536c → 0x403c8e)', () => {
  const { turn } = freeStart(3);
  const u = unitOf(turn.state, turn.actor);
  const s = startInput(turn);
  expect([s.cursor, s.cursorOn]).toEqual([{ x: u.x, y: u.y }, true]);
});

// 움직이지 않고 단계 3으로
const standing = (map: ReturnType<typeof mapOf>, data: ReturnType<typeof engineData>, turn: { state: GameState; actor: number }) => {
  const where = pixelOf(turn.state, map, unitOf(turn.state, turn.actor));
  return press(data, press(data, startInput(turn), ...where).session, ...where).session;
};

it('단계 4·5에서 칸마다 명령이 나오는 것과 엔진이 받는 것이 같다', () => {
  let checked = 0;
  for (const [g, k] of [[0, 3], [0, 10], [1, 26], [2, 6], [2, 18], [3, 30], [4, 5], [4, 6], [5, 12]]) {
    const { map, data, turn } = blockTurn(g, k);
    const s = standing(map, data, turn);
    if (s.phase !== 3) continue;
    const u = unitOf(s.moved, s.actor);
    const pixels = cellPixels(map, s.moved);
    const { attack, spells } = actionsOf(data, s.moved, s.actor);
    const phases: [Session, number, number][] = [];
    for (const [item, action] of [[2, attack], ...spells.map((a) => [3, a])]) {
      const st = chooseMenu(data, s, item, action).session;
      if (st.phase === 4) phases.push([st, 1, action]);
    }
    if (turn.actor < MASTERS) {
      for (const type of s.moved.sides[u.side].natials) {
        const st = chooseMenu(data, s, 4, type).session;
        if (st.phase === 5) phases.push([st, 2, type]);
      }
    }
    for (const [st, kind, number] of phases) {
      for (const [i, [px, py]] of pixels) {
        const target = { x: i % 32, y: i >> 5 };
        const step = press(data, st, px, py);
        const offered = step.command !== undefined || step.session.phase === 6;
        const accepted = apply(data, turn.state, { to: { x: u.x, y: u.y }, direction: u.direction, kind, number, target }, 'ui').ok;
        expect(offered, `게임 ${g} 블록 ${k} 종류 ${kind} ${number} 칸 (${target.x}, ${target.y})`).toBe(accepted);
        checked++;
      }
    }
  }
  expect(checked).toBeGreaterThan(5000);
}, 60_000);

it('움직였다 취소하고 다른 칸을 고르면 그 칸으로 명령한다', () => {
  const { map, data, turn } = freeStart(3);
  const actor = unitOf(turn.state, turn.actor);
  const keep = dimMove(data, turn.state, turn.actor).dimCells!;
  const goals = [...keep.keys()].filter((i) => keep[i] === 0 && i !== actor.y * 32 + actor.x).map((i) => ({ x: i % 32, y: i >> 5 }));
  let s = press(data, startInput(turn), ...pixelOf(turn.state, map, actor)).session;
  s = press(data, s, ...pixelOf(turn.state, map, goals[0])).session;
  s = pressRight(data, s, 0, 0).session;
  s = press(data, s, ...pixelOf(turn.state, map, goals[1])).session;
  const c = chooseMenu(data, s, 1).command!;
  expect(c.to).toEqual(goals[1]);
  expect(apply(data, turn.state, c, 'ui').ok).toBe(true);
});

it('움직인 뒤 단계 4·5·6에서 오른쪽 클릭해도 잠정 위치가 남는다', () => {
  const moveThen = (source: ReturnType<typeof freeStart>, pick: (s: Session) => Session | null) => {
    const { map, data, turn } = source;
    const actor = unitOf(turn.state, turn.actor);
    const keep = dimMove(data, turn.state, turn.actor).dimCells!;
    for (const i of keep.keys()) {
      if (keep[i] !== 0 || i === actor.y * 32 + actor.x) continue;
      const goal = { x: i % 32, y: i >> 5 };
      let s = press(data, startInput(turn), ...pixelOf(turn.state, map, actor)).session;
      s = press(data, s, ...pixelOf(turn.state, map, goal)).session;
      const chosen = pick(s);
      if (!chosen) continue;
      return { map, data, goal, chosen };
    }
    throw new Error('움직여 고를 수 있는 칸이 없습니다');
  };
  const kept = (s: Session, goal: Cell) => [at(s).x, at(s).y] as const;
  // 범위 종류 4 효과 반경(단계 6 → 3)
  {
    const { data, goal, chosen } = moveThen(blockTurn(2, 6), (s) => {
      const c = chooseMenu(blockTurn(2, 6).data, s, 3).session;
      return c.phase === 6 ? c : null;
    });
    const back = pressRight(data, chosen, 0, 0).session;
    expect([back.phase, ...kept(back, goal)]).toEqual([3, goal.x, goal.y]);
  }
  // 범위 종류 3 효과 반경(단계 4 → 6 → 4 → 3)
  {
    const { map, data, goal, chosen } = moveThen(blockTurn(4, 5), (s) => {
      const c = chooseMenu(blockTurn(4, 5).data, s, 3).session;
      return c.phase === 4 ? c : null;
    });
    const [spell] = actionsOf(data, chosen.moved, chosen.actor).spells;
    const [center] = actionTargets({ map, grid: workGrid(map, chosen.moved), state: chosen.moved }, chosen.actor, data.actions[spell]);
    const area = press(data, chosen, ...pixelOf(chosen.moved, map, center)).session;
    expect(area.phase).toBe(6);
    const four = pressRight(data, area, 0, 0).session;
    expect([four.phase, ...kept(four, goal)]).toEqual([4, goal.x, goal.y]);
    const three = pressRight(data, four, 0, 0).session;
    expect([three.phase, ...kept(three, goal)]).toEqual([3, goal.x, goal.y]);
  }
  // 소환(단계 5 → 3)
  {
    const start = freeStart(3);
    const { data, goal, chosen } = moveThen(start, (s) => {
      const type = s.moved.sides[at(s).side].natials[0];
      const c = chooseMenu(start.data, s, 4, type).session;
      return c.phase === 5 ? c : null;
    });
    const back = pressRight(data, chosen, 0, 0).session;
    expect([back.phase, ...kept(back, goal)]).toEqual([3, goal.x, goal.y]);
  }
});

it('단계 3에서 누른 채 끌면 방향이 바뀌고, 누르기 전 끌기는 무시한다(0x403d7b)', () => {
  const { map, data, turn } = freeStart(3);
  const s = standing(map, data, turn);
  const u = unitOf(s.moved, s.actor);
  const grid = workGrid(map, s.moved);
  const [px, py] = [((u.y & 1) + 1 + u.x * 2) * 24 - 60, (u.y * 2 + 24) * 12];
  const want = directionAt(map, grid, px, py, u.x, u.y);
  expect(at(pointer(data, s, px, py, true)).direction).toBe(u.direction);
  const pressed = { ...s, pressed: true };
  expect(at(pointer(data, pressed, px, py, true)).direction).toBe(want);
  expect(at(pointer(data, pressed, px, py, false)).direction).toBe(u.direction);
});

it('상태 줄 문구', () => {
  const { map, data, turn } = freeStart(3);
  const text = (s: Session) => {
    const at = statusOf(data, s);
    return at === null ? null : exe.cString(at).split('\n')[0];
  };
  const s1 = startInput(turn);
  const s2 = press(data, s1, ...pixelOf(turn.state, map, unitOf(turn.state, turn.actor))).session;
  const s3 = press(data, s2, ...pixelOf(turn.state, map, unitOf(turn.state, turn.actor))).session;
  expect([text(s1), text(s2), text(s3)]).toEqual([null, 'Indicating movable range.', 'Choose your action.']);
});

it('세션 함수는 원작 UI가 줄 수 없는 입력을 거부한다', () => {
  const { map, data, turn } = freeStart(3);
  const s = standing(map, data, turn);
  const { attack } = actionsOf(data, s.moved, s.actor);
  expect(() => chooseMenu(data, s, 3, attack)).toThrow(RangeError); // 공격 번호를 마법으로
  expect(() => chooseMenu(data, s, 3)).toThrow(RangeError); // 마스터가 마법을 고르지 않음
  expect(() => confirmDestruction(data, s)).toThrow(RangeError); // 단계 7이 아님
});

it('유닛 메뉴 범위 보기(단계 8~0x14): 항목 → 단계(효과음 1), 보이는 칸 누르기·오른쪽 누르기 전이, 0x11에서 걷고 취소하면 0x11로', () => {
  const { map, data, turn } = freeStart(3);
  const actor = unitOf(turn.state, turn.actor);
  const home = pixelOf(turn.state, map, actor);
  const menu = pressRight(data, startInput(turn), ...home).session;
  expect(menu.phase).toBe(7);
  const items = [0, 1, 2, 3, 5, 6, 7, 8];
  const on = unitMenuEnabled(data, menu);
  const views = items.map((i) => chooseUnitMenu(data, menu, i));
  expect(views.map((v) => v.session.phase)).toEqual([8, 9, 0xa, 0xb, 0xf, 0xc, 0xd, 0xe].map((p, k) => (on[items[k]] ? p : 7)));
  expect(views.every((v, k) => isDeepStrictEqual(v.sounds, on[items[k]] ? [1] : undefined))).toBe(true);
  expect(on[5] && on[6]).toBe(true);
  expect(chooseUnitMenu(data, menu, 4)).toEqual({ session: menu }); // Detail Info는 ③b-4a
  const shown = (s: Session) => {
    const dim = overlayOf(data, s, 0).dimCells!;
    return [...dim.keys()].filter((k) => !dim[k]).map((k) => ({ x: k & 31, y: k >> 5 }));
  };
  // 단계 8: 아무 칸이나 누르면 유닛 메뉴로(효과음 4), 오른쪽도 유닛 메뉴로(2)
  expect(press(data, views[0].session, ...home)).toMatchObject({ session: { phase: 7 }, sounds: [4] });
  expect(pressRight(data, views[0].session, 0, 0)).toMatchObject({ session: { phase: 7 }, sounds: [2] });
  // 이동+공격(0xc) → 보이는 칸 → 0x11 → 보이는 칸에서 걷기 → 취소하면 0x11
  const moveAttack = views[5].session;
  const dimMap = overlayOf(data, moveAttack, 0).dimCells!;
  const dark = [...dimMap.keys()].filter((k) => dimMap[k]).map((k) => ({ x: k & 31, y: k >> 5 })).find((c) => {
    try {
      return pixelOf(turn.state, map, c) !== null;
    } catch {
      return false;
    }
  })!;
  expect(press(data, moveAttack, ...pixelOf(turn.state, map, dark))).toEqual({ session: { ...moveAttack, pressed: true } });
  const aim = shown(moveAttack).find((c) => c.x !== actor.x || c.y !== actor.y)!;
  const p11 = press(data, moveAttack, ...pixelOf(turn.state, map, aim));
  expect(p11).toMatchObject({ session: { phase: 0x11, aim }, sounds: [4] });
  expect(pressRight(data, p11.session, 0, 0)).toMatchObject({ session: { phase: 0xc }, sounds: [2] });
  const stand = shown(p11.session).find((c) => c.x !== actor.x || c.y !== actor.y);
  expect(stand).toBeDefined();
  if (stand) {
    const walk = press(data, p11.session, ...pixelOf(turn.state, map, stand));
    expect(walk).toMatchObject({ session: { phase: 3, moveFrom: 0x11 }, sounds: [4] });
    expect([at(walk.session).x, at(walk.session).y]).toEqual([stand.x, stand.y]);
    const back = chooseMenu(data, walk.session, 0);
    expect(back).toMatchObject({ session: { phase: 0x11, aim }, sounds: [2] });
    expect(back.session.moved).toBe(turn.state);
  }
  // 다른 유닛을 보고 있으면 걷지 않는다
  const enemy = turn.state.units.findIndex((u, i) => u && i !== turn.actor && u.side !== actor.side);
  const other = chooseUnitMenu(data, pressRight(data, startInput(turn), ...pixelOf(turn.state, map, unitOf(turn.state, enemy))).session, 6).session;
  expect(other).toMatchObject({ phase: 0xc, selected: enemy });
  const o11 = press(data, other, ...pixelOf(turn.state, map, shown(other)[0])).session;
  expect(o11.phase).toBe(0x11);
  const cells = shown(o11);
  expect(cells.length).toBeGreaterThan(0);
  expect(press(data, o11, ...pixelOf(turn.state, map, cells[0])).session.phase).toBe(0x11);
});

it('단계 8에서 칸을 누르면 고른 유닛을 그 칸에 가상으로 세우고(0x405a6e) 범위 보기가 그 자리에서 센다. 단계 7 오른쪽 누름이 되돌린다(0x405bb2)', () => {
  const { map, data, turn } = freeStart(3);
  const actor = unitOf(turn.state, turn.actor);
  const menu = pressRight(data, startInput(turn), ...pixelOf(turn.state, map, actor)).session;
  const moving = chooseUnitMenu(data, menu, 0).session;
  const dim = overlayOf(data, moving, 0).dimCells!;
  const far = [...dim.keys()].filter((k) => !dim[k]).map((k) => ({ x: k & 31, y: k >> 5 })).sort((a, b) => Math.abs(b.x - actor.x) + Math.abs(b.y - actor.y) - (Math.abs(a.x - actor.x) + Math.abs(a.y - actor.y)))[0];
  const placed = press(data, moving, ...pixelOf(turn.state, map, far));
  expect(placed).toMatchObject({ session: { phase: 7, placed: far }, sounds: [4] });
  expect(overlayOf(data, placed.session, 0)).toMatchObject({ turnMarker: null, placed: { unit: turn.actor, from: { x: actor.x, y: actor.y }, at: far } });
  expect(drawnState(placed.session).units[turn.actor]).toMatchObject(far);
  expect(press(data, moving, ...pixelOf(turn.state, map, actor)).session.placed).toBeNull(); // 원래 칸이면 배치 없음
  // 범위 보기는 옮긴 자리에서: 단계 9(공격 범위)가 배치 없을 때와 다르다
  const view = (s: Session) => chooseUnitMenu(data, s, 1).session;
  const there = view(placed.session);
  expect(there.placed).toEqual(far);
  expect(overlayOf(data, there, 0).dimCells).not.toEqual(overlayOf(data, view(menu), 0).dimCells);
  expect(overlayOf(data, there, 0).turnMarker).toBeNull(); // 차례 유닛을 보면 차례 표식 없음(0x404c02 → 0x40583f)
  // 배치 중에는 0x11에서 걷지 않는다(0x476b08)
  const p11 = (s: Session) => {
    const c = chooseUnitMenu(data, s, 6).session;
    const cells = (q: Session) => {
      const d = overlayOf(data, q, 0).dimCells!;
      return [...d.keys()].filter((k) => !d[k]).map((k) => ({ x: k & 31, y: k >> 5 }));
    };
    const aimed = press(data, c, ...pixelOf(turn.state, map, cells(c)[0])).session;
    return { aimed, stand: cells(aimed) };
  };
  const { aimed, stand } = p11(placed.session);
  expect(aimed.phase).toBe(0x11);
  if (stand.length) expect(press(data, aimed, ...pixelOf(turn.state, map, stand[0])).session.phase).toBe(0x11);
  const closed = pressRight(data, placed.session, 0, 0);
  expect(closed).toMatchObject({ session: { phase: 1, placed: null, selected: null }, sounds: [2, 2] });
});

it('범위 보기 갈래(0x404d69~0x405083): 0xb·0xe는 사거리 마법이 있을 때만 0x10·0x13으로, 0x12·0x14에서는 차례 유닛이 걷되 사람 진영일 때만, 0x10~0x14 오른쪽 누름', () => {
  const shown = (data: ReturnType<typeof engineData>, s: Session) => {
    const dim = overlayOf(data, s, 0).dimCells!;
    return [...dim.keys()].filter((k) => !dim[k]).map((k) => ({ x: k & 31, y: k >> 5 }));
  };
  const controlled = (t: { state: GameState; actor: number }, controller: number) => {
    const side = unitOf(t.state, t.actor).side;
    const [s0, s1] = t.state.sideStates;
    return { ...t, state: { ...t.state, sideStates: [side === 0 ? { ...s0, controller } : s0, side === 1 ? { ...s1, controller } : s1] as const } };
  };
  const views = (g: number, k: number, controller = 0) => {
    const { map, data, turn } = blockTurn(g, k);
    const t = controlled(turn, controller);
    const self = unitOf(t.state, t.actor);
    const px = (c: Cell) => pixelOf(t.state, map, c);
    const menu = pressRight(data, startInput(t), ...px(self)).session;
    expect(menu).toMatchObject({ phase: 7, selected: t.actor });
    const other = (s: Session) => shown(data, s).find((c) => c.x !== self.x || c.y !== self.y)!;
    return { data, px, menu, other, on: unitMenuEnabled(data, menu), view: (item: number) => chooseUnitMenu(data, menu, item).session };
  };
  // 사거리 마법(행동 20: 사거리 3, 효과 반경 1)이 있는 네이티얼
  const a = views(4, 5);
  expect([a.on[3], a.on[7], a.on[8]]).toEqual([true, true, true]);
  const b = a.view(3);
  expect(b.phase).toBe(0xb);
  const p10 = press(a.data, b, ...a.px(a.other(b)));
  expect(p10).toMatchObject({ session: { phase: 0x10 }, sounds: [4] });
  expect(pressRight(a.data, p10.session, 0, 0)).toMatchObject({ session: { phase: 0xb }, sounds: [2] });
  const e = a.view(8);
  const p13 = press(a.data, e, ...a.px(a.other(e)));
  expect(p13).toMatchObject({ session: { phase: 0x13 }, sounds: [4] });
  expect(pressRight(a.data, p13.session, 0, 0)).toMatchObject({ session: { phase: 0xe }, sounds: [2] });
  const p14 = press(a.data, p13.session, ...a.px(a.other(p13.session)));
  expect(p14).toMatchObject({ session: { phase: 0x14 }, sounds: [4] });
  expect(pressRight(a.data, p14.session, 0, 0)).toMatchObject({ session: { phase: 0x13 }, sounds: [2] });
  expect(press(a.data, p14.session, ...a.px(a.other(p14.session)))).toMatchObject({ session: { phase: 3, moveFrom: 0x14 }, sounds: [4] });
  const d = a.view(7);
  const p12 = press(a.data, d, ...a.px(a.other(d)));
  expect(p12).toMatchObject({ session: { phase: 0x12 }, sounds: [4] });
  expect(pressRight(a.data, p12.session, 0, 0)).toMatchObject({ session: { phase: 0xd }, sounds: [2] });
  const stand = a.other(p12.session);
  expect(press(a.data, p12.session, ...a.px(stand))).toMatchObject({ session: { phase: 3, moveFrom: 0x12 }, sounds: [4] });
  // 같은 유닛이라도 진영이 사람(제어 0)이 아니면 걷지 않는다
  const cpu = views(4, 5, 1);
  const c12 = press(cpu.data, cpu.view(7), ...cpu.px(cpu.other(cpu.view(7)))).session;
  expect(c12.phase).toBe(0x12);
  expect(press(cpu.data, c12, ...cpu.px(cpu.other(c12)))).toEqual({ session: { ...c12, pressed: true } });
  // 사거리 마법 없이 효과 반경만 있는 네이티얼(행동 28: 사거리 0, 효과 반경 1)
  const n = views(1, 26);
  expect([n.on[3], n.on[7], n.on[8]]).toEqual([true, false, true]);
  const nb = n.view(3);
  expect(press(n.data, nb, ...n.px(n.other(nb)))).toEqual({ session: { ...nb, pressed: true } });
  const ne = n.view(8);
  const n14 = press(n.data, ne, ...n.px(n.other(ne)));
  expect(n14).toMatchObject({ session: { phase: 0x14 }, sounds: [4] });
  expect(pressRight(n.data, n14.session, 0, 0)).toMatchObject({ session: { phase: 0xe }, sounds: [2] });
});
