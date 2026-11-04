import { expect, it } from 'vitest';
import { type FrameContext, frameTitle, menuState, SCENE } from '../../src/ui/frame/frame.ts';
import { exe } from './screenCases.ts';

const base: FrameContext = { scene: SCENE.title, network: false, scenario: null, human: true, zoom: 1, view: true, status: true, help: true, chat: false };
const on = (c: FrameContext) => Object.entries(menuState(c)).flatMap(([id, f]) => (f.enabled ? [Number(id)] : [])).sort();
const checked = (c: FrameContext) => Object.entries(menuState(c)).flatMap(([id, f]) => (f.checked ? [Number(id)] : [])).sort();

it('메뉴 켬은 장면마다 0x407334와 같다(네트워크 항목은 늘 회색)', () => {
  expect(on(base)).toEqual([]);
  expect(on({ ...base, scene: SCENE.world })).toEqual([0x9c7b, 0x9c7d, 0x9c7f, 0x9c81].sort());
  expect(on({ ...base, scene: SCENE.battle })).toEqual([0x9c43, 0x9c44, 0x9c45, 0x9c5b, 0x9c5c, 0x9c7d, 0x9c7f, 0x9c80, 0x9c81, 0x9c82].sort());
  expect(on({ ...base, scene: SCENE.battle, human: false })).not.toContain(0x9c82); // 사람이 없으면 Give up 회색
  expect(on({ ...base, scene: SCENE.result })).toEqual([0x9c7d, 0x9c80, 0x9c81].sort());
});

it('체크는 켠 항목에서만: 지금 확대, 창이 있는 View·Status·HelpGuide', () => {
  expect(checked({ ...base, scene: SCENE.battle, zoom: 2, view: false })).toEqual([0x9c45, 0x9c5c, 0x9c7d].sort());
  expect(checked({ ...base, scene: SCENE.world })).toEqual([0x9c7d]);
  expect(checked(base)).toEqual([]);
});

it('제목은 장면 2~5에서 대전 방식을 붙인다', () => {
  expect(frameTitle(exe, base)).toBe('Vantage Master V2');
  expect(frameTitle(exe, { ...base, scene: SCENE.battle })).toMatch(/^Vantage Master V2 +Free Battle$/);
  expect(frameTitle(exe, { ...base, scene: SCENE.world, scenario: 1 })).toMatch(/Scenario Mode \(Normal\)$/);
});

it('브라우저에 맞춘 가상 화면: 뷰포트에서 화면 자리(왼쪽 위)와 오른쪽·아래 여백을 뺀 크기, 640 × 480보다 작아지지 않음', async () => {
  const { fitScreen } = await import('../../src/ui/frame/Desktop.tsx');
  expect(fitScreen({ width: 1440, height: 900 }, { x: 8, y: 38 }, 8)).toEqual({ width: 1424, height: 854 });
  expect(fitScreen({ width: 1439.6, height: 900 }, { x: 8, y: 38.4 }, 8)).toEqual({ width: 1423, height: 853 });
  expect(fitScreen({ width: 600, height: 400 }, { x: 8, y: 38 }, 8)).toEqual({ width: 640, height: 480 });
});
