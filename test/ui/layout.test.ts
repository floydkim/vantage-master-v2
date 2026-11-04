import { expect, it } from 'vitest';
import { WIN98 } from '../../src/ui/frame/frame.ts';
import { battleArrange, battleLayout, clampPoint, worldLayout } from '../../src/ui/frame/layout.ts';
import { readGolden } from '../engine/block.ts';

interface LayoutCase {
  readonly args: { readonly client: readonly [number, number]; readonly help: number; readonly chat: number };
  /** 블록 +0x268~+0x2d3(i32 27개): 월드 배치 뒤와 전투 배치 뒤 */
  readonly expected: { readonly world: readonly number[]; readonly battle: readonly number[] };
}
const cases = readGolden<LayoutCase>('layout');

it('월드 배치(0x4510ca·0x451361)와 전투 배치(0x40e392·0x40e3be)가 원작과 같다(Win98 시스템 값, 화면 크기 여덟 가지 × 도움말·채팅 켬)', () => {
  expect(cases.length).toBe(24);
  for (const c of cases) {
    const [width, height] = c.args.client;
    const panes = { help: c.args.help !== 0, chat: c.args.chat !== 0 };
    const w = worldLayout({ width, height }, WIN98, panes);
    const label = JSON.stringify(c.args);
    const e = c.expected.world;
    expect([w.world.left, w.world.top, w.world.right, w.world.bottom], label).toEqual(e.slice(0, 4));
    expect([w.mapInfo.x, w.mapInfo.y, w.masterInfo.x, w.masterInfo.y], label).toEqual(e.slice(4, 8));
    expect([w.help.x, w.help.y], label).toEqual(e.slice(9, 11));
    expect([w.chat.left, w.chat.top, w.chat.right, w.chat.bottom], label).toEqual(e.slice(12, 16));
    const b = battleLayout({ width, height }, WIN98, panes, w.help, w.chat);
    const f = c.expected.battle;
    expect([b.battle.left, b.battle.top, b.battle.right, b.battle.bottom], label).toEqual(f.slice(17, 21));
    expect([b.status.x, b.status.y, b.view.x, b.view.y], label).toEqual([...f.slice(22, 24), ...f.slice(25, 27)]);
  }
});

it('전투 창 배치 다시(0x40e4cd → 0x40e3be)는 도움말 창이 꺼져 있으면 전장 창이 클라이언트 아래까지(픽스처 help 0 경우)', () => {
  for (const c of cases.filter((k) => k.args.chat === 0)) {
    const [width, height] = c.args.client;
    const r = battleArrange({ width, height }, WIN98, c.args.help !== 0);
    expect([r.battle.left, r.battle.top, r.battle.right, r.battle.bottom], JSON.stringify(c.args)).toEqual(c.expected.battle.slice(17, 21));
  }
});

it('끌기 점은 MDI 클라이언트 안으로(Windows 이동 루프가 커서를 부모 클라이언트에 가둔다)', () => {
  const r = { left: 10, top: 20, right: 110, bottom: 220 };
  expect(clampPoint({ x: 5, y: 300 }, r)).toEqual({ x: 10, y: 219 });
  expect(clampPoint({ x: 50, y: 50 }, r)).toEqual({ x: 50, y: 50 });
  expect(clampPoint({ x: 200, y: 0 }, r)).toEqual({ x: 109, y: 20 });
});
