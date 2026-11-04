import { expect, it } from 'vitest';
import { clickAction, dragStarted, keepInside } from '../../src/ui/frame/LaunchIcon.tsx';

it('실행 아이콘 클릭: 마우스 한 번 클릭은 고르기만(실행은 더블클릭), 터치·펜 탭은 잠시 뒤 실행(더블탭의 둘째 탭이 오프닝을 넘기지 않게), 키보드·화면 읽기 프로그램의 가상 클릭은 바로', () => {
  expect([clickAction('mouse', 1), clickAction('mouse', 2)]).toEqual(['select', 'select']);
  expect([clickAction('touch', 1), clickAction('pen', 1)]).toEqual(['later', 'later']);
  expect(clickAction(null, 0)).toBe('open'); // Enter·Space
  expect(clickAction(null, 1)).toBe('open'); // NVDA·JAWS(Firefox)·TalkBack: detail ≥ 1, pointerdown 없음
});

it('끌기 시작: 마우스는 Win98 끌기 사각형(4 × 4, 누른 점 가운데)을 벗어나면 — 가로나 세로로 2px 넘게, 터치·펜은 탭이 흔들리는 만큼(8px) 넘게', () => {
  expect([dragStarted(2, 2, 'mouse'), dragStarted(-2, 0, 'mouse'), dragStarted(3, 0, 'mouse'), dragStarted(0, -3, 'mouse'), dragStarted(3, 3, 'mouse')]).toEqual([false, false, true, true, true]);
  expect([dragStarted(6, 5, 'touch'), dragStarted(8, -8, 'pen'), dragStarted(9, 0, 'touch'), dragStarted(0, -9, 'pen')]).toEqual([false, false, true, true]);
});

it('놓을 자리: 아이콘 전체가 바탕화면 안에 들게(안은 그대로)', () => {
  const icon = { width: 75, height: 60 };
  const screen = { width: 640, height: 480 };
  expect(keepInside({ x: 100, y: 50 }, icon, screen)).toEqual({ x: 100, y: 50 });
  expect(keepInside({ x: -20, y: -5 }, icon, screen)).toEqual({ x: 0, y: 0 });
  expect(keepInside({ x: 700, y: 470 }, icon, screen)).toEqual({ x: 565, y: 420 });
});

it('끈 뒤의 클릭: 마우스·터치 클릭(detail ≥ 1)은 무시, 키보드·가상 클릭(detail 0, 누름 없음)은 끈 뒤라도 실행', () => {
  expect([clickAction('mouse', 1, true), clickAction('touch', 1, true)]).toEqual(['ignore', 'ignore']);
  expect([clickAction(null, 0, true), clickAction(null, 1, true)]).toEqual(['open', 'open']);
  expect(clickAction('mouse', 1, false)).toBe('select');
});
