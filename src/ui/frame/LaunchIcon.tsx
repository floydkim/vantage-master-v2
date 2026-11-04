import { type CSSProperties, type PointerEvent, useEffect, useRef, useState } from 'react';
import type { Point, Size } from './layout.ts';

/**
 * 클릭 하나를 어떻게: 마우스 클릭(detail ≥ 1)은 고르기만(실행은 더블클릭), 터치·펜 탭은 잠시 뒤 실행(더블탭의 둘째 탭이 막 연 오프닝을 넘기지 않게),
 * 키보드(Enter·Space, detail 0)·화면 읽기 프로그램의 가상 클릭(pointerdown 없음)은 바로. 끈 뒤(dragged)의 마우스·터치 클릭은 무시(키보드·가상 클릭은 그대로)
 */
export const clickAction = (pointer: string | null, detail: number, dragged = false): 'ignore' | 'select' | 'later' | 'open' =>
  dragged && pointer !== null && detail > 0 ? 'ignore' : pointer === 'mouse' && detail > 0 ? 'select' : pointer === 'touch' || pointer === 'pen' ? 'later' : 'open';
const DOUBLE_TAP_MS = 300;

/** 끌기 시작: 마우스는 Win98 끌기 사각형(SM_CXDRAG·SM_CYDRAG 4, 누른 점 가운데)을 벗어나면, 터치·펜은 탭이 흔들리는 만큼(8px, 안드로이드 탭 허용 8dp) 넘게 */
export const dragStarted = (dx: number, dy: number, pointerType: string): boolean => {
  const slop = pointerType === 'mouse' ? 2 : 8;
  return Math.abs(dx) > slop || Math.abs(dy) > slop;
};

/** 놓을 자리: 아이콘 전체가 바탕화면 안에 들게 */
export const keepInside = (p: Point, icon: Size, screen: Size): Point => ({
  x: Math.max(0, Math.min(p.x, screen.width - icon.width)),
  y: Math.max(0, Math.min(p.y, screen.height - icon.height)),
});

const HOME: Point = { x: 8, y: 8 }; // 바탕화면 왼쪽 위 첫 아이콘 자리

/**
 * 바탕화면의 실행 아이콘(Win98: 마우스 한 번 클릭은 고르기, 더블클릭·Enter·Space로 실행). 브라우저는 사용자가 페이지를 누르기 전엔 소리를 막으므로
 * 게임을 이 아이콘으로 시작해 오프닝 첫 BGM부터 나게 한다. 터치·펜은 탭 한 번에 실행(clickAction). 끌어서 바탕화면 위로 옮길 수 있다(저장하지 않음).
 * 골라짐은 상태(처음 켬, 바탕화면 다른 곳을 누르면 끔), 초점은 아무 데도 없을 때만 — active(마법사가 닫힘)가 될 때마다 — 준다
 */
export function LaunchIcon({ icon, label, screen, active, onOpen }: { readonly icon: string; readonly label: string; readonly screen: Size; readonly active: boolean; readonly onOpen: () => void }) {
  const button = useRef<HTMLButtonElement>(null);
  const pointer = useRef<string | null>(null); // 이 클릭을 낸 누름의 pointerType(없으면 키보드·가상 클릭)
  const later = useRef<ReturnType<typeof setTimeout> | null>(null);
  const press = useRef<{ readonly id: number; readonly x: number; readonly y: number; readonly from: Point } | null>(null);
  const dragged = useRef(false); // 끌었으면 이어지는 마우스·터치 클릭은 실행·고르기로 치지 않는다(clickAction)
  const [pos, setPos] = useState(HOME);
  const [ghost, setGhost] = useState<Point | null>(null);
  const [selected, setSelected] = useState(true);
  useEffect(() => () => clearTimeout(later.current ?? undefined), []);
  // 화면 크기를 줄이면 바탕화면 안으로(Win98도 해상도를 바꾸면 아이콘을 안으로 들인다)
  useEffect(() => {
    const b = button.current;
    if (b) setPos((p) => keepInside(p, { width: b.offsetWidth, height: b.offsetHeight }, screen));
  }, [screen.width, screen.height]);
  useEffect(() => {
    if (active && (document.activeElement === null || document.activeElement === document.body)) button.current?.focus({ preventScroll: true });
  }, [active]);
  useEffect(() => {
    // 바탕화면 빈 곳(.w98-screen 자체)을 누를 때만 끈다: 화면 막대·마법사·프레임 창을 눌러도 그대로(Win98)
    const away = (e: globalThis.PointerEvent) => (e.target as Element | null)?.classList?.contains('w98-screen') && setSelected(false);
    document.addEventListener('pointerdown', away, { capture: true });
    return () => document.removeEventListener('pointerdown', away, { capture: true });
  }, []);
  // 끌기 끝(놓지 않음): 취소·캡처를 잃음(창 밖에서 놓기 등)이면 그림자만 거둔다
  const stop = (e: PointerEvent) => {
    if (press.current?.id !== e.pointerId) return;
    press.current = null;
    setGhost(null);
  };
  const dropAt = (e: PointerEvent) => {
    const p = press.current;
    if (!p || p.id !== e.pointerId) return null;
    return { x: p.from.x + e.clientX - p.x, y: p.from.y + e.clientY - p.y };
  };
  const content = (
    <>
      <span className="pic">
        <img src={icon} alt="" width={32} height={32} draggable={false} />
      </span>
      <span className="label">{label}</span>
    </>
  );
  return (
    <>
      <button
        ref={button}
        type="button"
        className={`w98-desktop-icon${selected ? ' selected' : ''}`}
        aria-label={`${label} 실행`}
        style={{ '--icon': `url(${icon})`, left: pos.x, top: pos.y } as CSSProperties}
        onPointerDown={(e) => {
          if (!e.isPrimary) return; // 둘째 손가락은 끌기에 끼지 않는다
          pointer.current = e.pointerType;
          setSelected(true);
          button.current?.focus({ preventScroll: true }); // 큰 고정 화면에서 눌러도 페이지가 스크롤돼 끌기가 어긋나지 않게
          if (e.button !== 0) return;
          press.current = { id: e.pointerId, x: e.clientX, y: e.clientY, from: pos };
          dragged.current = false;
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onMouseDown={(e) => e.preventDefault()} // 사파리·파이어폭스(mac)는 단추를 눌러도 초점을 주지 않고 body로 돌린다: 위 focus()를 그대로 두게
        onPointerMove={(e) => {
          const at = dropAt(e);
          if (!at || (!dragged.current && !dragStarted(at.x - press.current!.from.x, at.y - press.current!.from.y, e.pointerType))) return;
          dragged.current = true;
          setGhost(at);
        }}
        onPointerUp={(e) => {
          const at = dropAt(e);
          if (!at) return;
          press.current = null;
          setGhost(null);
          if (dragged.current) setPos(keepInside(at, { width: e.currentTarget.offsetWidth, height: e.currentTarget.offsetHeight }, screen));
        }}
        onPointerCancel={stop}
        onLostPointerCapture={stop}
        onClick={(e) => {
          const action = clickAction(pointer.current, e.detail, dragged.current);
          pointer.current = null;
          dragged.current = false; // 끈 뒤 클릭이 오지 않았어도 다음 클릭에서 늘 푼다
          if (action === 'open') onOpen();
          else if (action === 'later') later.current ??= setTimeout(onOpen, DOUBLE_TAP_MS);
        }}
        onDoubleClick={onOpen}
      >
        {content}
      </button>
      {ghost && (
        <div className="w98-desktop-icon selected ghost" aria-hidden="true" style={{ '--icon': `url(${icon})`, left: ghost.x, top: ghost.y } as CSSProperties}>
          {content}
        </div>
      )}
    </>
  );
}
