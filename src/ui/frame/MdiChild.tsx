import { type PointerEvent, type ReactNode, useRef } from 'react';
import { htmlText } from '../../i18n/hangul.ts';
import type { Metrics } from './frame.ts';
import { clampPoint, type Rect } from './layout.ts';

/**
 * MDI 자식 창(FALCOMCHILD, 0x4424ee·0x442609). 원작이 WM_NCCREATE(0x81)에서 지운 스타일 비트대로:
 * fixed(0xfff8ffff) = 대화 틀, 닫기만. sizable(0xfffcffff) = 크기 틀, 닫기만, 크기 조절. bare(0xfff0ffff) = 시스템 메뉴까지 없음(결과 창)
 */
export type ChildKind = 'fixed' | 'sizable' | 'bare';

const MIN = { width: 112, height: 27 }; // Win98 최소 끌기 크기(SM_CXMINTRACK 근처)

export function MdiChild({
  title,
  icon,
  rect,
  kind,
  scroll = false,
  active,
  z,
  metrics,
  onActivate,
  onRect,
  onClose,
  clientRef,
  children,
}: {
  readonly title: string;
  readonly icon: string;
  /** 바깥 사각형(MDI 클라이언트 좌표) */
  readonly rect: Rect;
  readonly kind: ChildKind;
  /** 가로·세로 스크롤 막대(0x442609 스타일 0x300000) */
  readonly scroll?: boolean;
  readonly active: boolean;
  readonly z: number;
  readonly metrics: Metrics;
  readonly onActivate: () => void;
  readonly onRect: (r: Rect) => void;
  readonly onClose?: () => void;
  readonly clientRef?: (el: HTMLDivElement | null) => void;
  readonly children: ReactNode;
}) {
  const border = kind === 'sizable' ? metrics.frame : metrics.dlgFrame;
  const drag = useRef<{ x: number; y: number; r: Rect; edge: string } | null>(null);
  const start = (edge: string) => (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    onActivate();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, r: rect, edge };
  };
  const move = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    // Windows 이동·크기 조절 루프는 커서를 부모(MDI 클라이언트) 안에 가둔다: 잡은 점(캡션)이 늘 보인다
    const bounds = (e.currentTarget as HTMLElement).closest('.w98-mdi')?.getBoundingClientRect();
    const p = bounds ? clampPoint({ x: e.clientX, y: e.clientY }, bounds) : { x: e.clientX, y: e.clientY };
    const dx = p.x - d.x;
    const dy = p.y - d.y;
    const r = d.r;
    if (d.edge === 'move') return onRect({ left: r.left + dx, top: r.top + dy, right: r.right + dx, bottom: r.bottom + dy });
    let { left, top, right, bottom } = r;
    if (d.edge.includes('w')) left = Math.min(r.left + dx, r.right - MIN.width);
    if (d.edge.includes('e')) right = Math.max(r.right + dx, r.left + MIN.width);
    if (d.edge.includes('n')) top = Math.min(r.top + dy, r.bottom - MIN.height);
    if (d.edge.includes('s')) bottom = Math.max(r.bottom + dy, r.top + MIN.height);
    onRect({ left, top, right, bottom });
  };
  const end = () => (drag.current = null);
  const grips =
    kind === 'sizable'
      ? (['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se'] as const).map((edge) => {
          const g = 12; // 모서리 손잡이(캡션 높이 정도)
          const style: Record<string, number | string> = { cursor: `${edge}-resize` };
          if (edge.includes('n')) Object.assign(style, { top: 0, height: border });
          if (edge.includes('s')) Object.assign(style, { bottom: 0, height: border });
          if (edge.includes('w')) Object.assign(style, { left: 0, width: border });
          if (edge.includes('e')) Object.assign(style, { right: 0, width: border });
          if (edge === 'n' || edge === 's') Object.assign(style, { left: g, right: g });
          if (edge === 'e' || edge === 'w') Object.assign(style, { top: g, bottom: g });
          if (edge.length === 2) Object.assign(style, { width: g, height: g });
          return <div key={edge} className="w98-grip" style={style} onPointerDown={start(edge)} onPointerMove={move} onPointerUp={end} />;
        })
      : null;
  return (
    <div
      className="w98-window"
      style={{ left: rect.left, top: rect.top, width: rect.right - rect.left, height: rect.bottom - rect.top, padding: border, zIndex: z }}
      onPointerDownCapture={onActivate}
    >
      {grips}
      <div className={`w98-caption${active ? '' : ' inactive'}`} onPointerDown={start('move')} onPointerMove={move} onPointerUp={end}>
        {kind !== 'bare' && <img src={icon} alt="" />}
        <span className="title">{htmlText(title)}</span>
        {kind !== 'bare' && (
          <span className="buttons">
            <button type="button" className="w98-button close" tabIndex={-1} aria-label="닫기" onPointerDown={(e) => e.stopPropagation()} onClick={onClose} />
          </span>
        )}
      </div>
      <div className={`w98-client${scroll ? ' scroll' : ''}`} ref={clientRef}>
        {children}
      </div>
    </div>
  );
}
