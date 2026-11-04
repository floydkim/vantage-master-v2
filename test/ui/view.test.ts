import { expect, it } from 'vitest';
import { workGrid } from '../../src/engine/rules/terrain.ts';
import { unitOf } from '../../src/engine/state.ts';
import { placeSprite } from '../../src/ui/battle/sprites.ts';
import { cellBox, centerOn, revealTarget, scaleScroll, scrollStep } from '../../src/ui/battle/view.ts';
import { readGolden } from '../engine/block.ts';
import { decodeState } from '../../src/engine/state.ts';
import { inflateBlock } from '../engine/block.ts';
import { cases, mapOf, stateOf } from './screenCases.ts';

const vp = { left: 100, top: 300, width: 640, height: 400 };

it('scrollStep은 가로를 먼저 48px씩, 다 맞추면 세로를 48px씩(0x4165bb)', () => {
  const target = { left: 200, top: 100 };
  const steps = [vp];
  while (steps.length < 20) {
    const next = scrollStep(steps[steps.length - 1], target);
    if (next.left === steps[steps.length - 1].left && next.top === steps[steps.length - 1].top) break;
    steps.push(next);
  }
  expect(steps.map((s) => [s.left, s.top])).toEqual([[100, 300], [148, 300], [196, 300], [200, 252], [200, 204], [200, 156], [200, 108], [200, 100]]);
});

it('목표는 차례 유닛 표시 객체 칩((칩x + 1)·24, (칩y − 2)·12)을 가운데로, 전장 안으로 자른다', () => {
  const c = cases[52];
  const map = mapOf(c.args.map);
  const state = stateOf(c);
  const grid = workGrid(map, state);
  const u = unitOf(state, 0);
  const at = (x: number, y: number) => {
    const p = placeSprite(map, grid, x, y);
    return centerOn((p.chipX + 1) * 24, (p.chipY - 2) * 12, vp);
  };
  const p = placeSprite(map, grid, u.x, u.y);
  expect(at(u.x, u.y)).toEqual({
    left: Math.min(Math.max((p.chipX + 1) * 24 - 320, 0), 1560 - 640),
    top: Math.min(Math.max((p.chipY - 2) * 12 - 200, 0), 1008 - 400),
  });
  expect(at(0, 0)).toEqual({ left: 0, top: 0 });
  expect(at(31, 31).left).toBe(1560 - 640);
});

const cpuMoves = readGolden<{ map: number; block: string; to: [number, number]; cpu?: boolean; boxes?: number[][] }>('walk').filter((c) => c.cpu);

it('칸 둘레 상자(0x40646b)가 원작과 같다', () => {
  expect(cpuMoves.length).toBeGreaterThan(0);
  for (const c of cpuMoves) {
    const map = mapOf(c.map);
    const grid = workGrid(map, decodeState(inflateBlock(c.block)));
    const to = { x: c.to[0], y: c.to[1] };
    expect([0, 1, 2].map((r) => { const b = cellBox(map, grid, to, r); return [b.left, b.top, b.right, b.bottom]; })).toEqual(c.boxes);
  }
});

it('CPU 이동 화면 확인(0x406ad9·0x406b3a): 상자가 보이면 그대로, 아니면 반경 2 상자를 보이게 가운데로', () => {
  const c = cpuMoves[0];
  const map = mapOf(c.map);
  const grid = workGrid(map, decodeState(inflateBlock(c.block)));
  const to = { x: c.to[0], y: c.to[1] };
  const b = cellBox(map, grid, to, 2);
  const around = { left: b.left - 10, top: b.top - 10, width: b.right - b.left + 20, height: b.bottom - b.top + 20 };
  expect(revealTarget(map, grid, to, 0, around)).toBeNull();
  const far = { left: 0, top: 0, width: 200, height: 120 };
  const away = { ...far, left: Math.min(b.right + 300, 1560 - 200), top: Math.min(b.bottom + 300, 1008 - 120) };
  // 창이 상자보다 작으면 상자 가운데, 상자가 창 왼쪽·위에 있으면 상자 왼쪽·위 + 창 반
  const cx = 200 < b.right - b.left ? ((b.left + b.right) / 2) | 0 : b.left + 100;
  const cy = 120 < b.bottom - b.top ? ((b.top + b.bottom) / 2) | 0 : b.top + 60;
  const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), max);
  const center = revealTarget(map, grid, to, 0, away)!;
  expect(center).toEqual({ x: cx, y: cy });
  expect(centerOn(center.x, center.y, away)).toEqual({ left: clamp(cx - 100, 1560 - 200), top: clamp(cy - 60, 1008 - 120) });
});

it('확대를 바꾸면 스크롤 위치를 내용 크기 비례로(0x442aea: 위치 × 새 크기 / 옛 크기, 왼쪽 위 기준)', () => {
  expect(scaleScroll(826, 1, 2)).toBe(1652);
  expect(scaleScroll(2386, 2, 1)).toBe(1193);
  expect(scaleScroll(1, 2, 1)).toBe(0);
});

it('창이 전장보다 넓으면(x /2 큰 창) 목표는 0이고 화면 이동이 끝난다', () => {
  const vp = { left: 0, top: 0, width: 1996, height: 1580 }; // 클라이언트 998 × 790을 x /2로
  const target = centerOn(700, 500, vp);
  expect(target).toEqual({ left: 0, top: 0 });
  let at = { left: 0, top: 0, width: vp.width, height: vp.height };
  for (let i = 0; i < 100 && (at.left !== target.left || at.top !== target.top); i++) at = { ...at, ...scrollStep(at, target) };
  expect({ left: at.left, top: at.top }).toEqual(target);
});
