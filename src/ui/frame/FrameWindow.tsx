import { type ReactNode, useEffect, useState } from 'react';
import type { ExeImage } from '../../formats/exeImage.ts';
import { readIcons, smallIcon } from '../../formats/icons.ts';
import { MF_GRAYED, type MenuItem } from '../../formats/menus.ts';
import { htmlText } from '../../i18n/hangul.ts';
import type { MenuFlags, Metrics } from './frame.ts';
import type { Size } from './layout.ts';

/** 프레임 창(FALCOMVM2MAIN, 0x44dd9f): 가상 화면에 최대화. 캡션(아이콘·제목·단추), 메뉴바(리소스 0x66), MDI 클라이언트 */
export function FrameWindow({
  title,
  icon,
  menu,
  flags,
  onCommand,
  screen,
  metrics,
  children,
}: {
  readonly title: string;
  readonly icon: string;
  readonly menu: readonly MenuItem[];
  /** 0x407334가 정한 켬·체크(없는 id는 리소스대로) */
  readonly flags: Readonly<Record<number, MenuFlags>>;
  readonly onCommand: (id: number) => void;
  readonly screen: Size;
  readonly metrics: Metrics;
  /** MDI 클라이언트 크기를 받아 자식 창을 그린다 */
  readonly children: (client: Size) => ReactNode;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [hl, setHl] = useState<number | null>(null);
  useEffect(() => {
    if (open === null) return;
    // 잡는 쪽(캡처)에서 닫는다: MDI 캡션 끌기처럼 전파를 멈추는 곳을 눌러도 닫힌다. 메뉴 줄 안은 메뉴가 처리한다
    const close = (e: PointerEvent) => !(e.target as Element | null)?.closest?.('.w98-menubar') && setOpen(null);
    window.addEventListener('pointerdown', close, true);
    return () => window.removeEventListener('pointerdown', close, true);
  }, [open]);
  const client = { width: screen.width, height: screen.height - metrics.caption - metrics.menu };
  const enabled = (m: MenuItem) => (flags[m.id] ? flags[m.id].enabled : !(m.flags & MF_GRAYED));
  return (
    <div className="w98-window" style={{ left: 0, top: 0, width: screen.width, height: screen.height, boxShadow: 'none' }}>
      <div className="w98-caption">
        <img src={icon} alt="" />
        <span className="title">{htmlText(title)}</span>
        <span className="buttons">
          <button type="button" className="w98-button minimize" tabIndex={-1} aria-label="최소화" />
          <button type="button" className="w98-button restore" tabIndex={-1} aria-label="이전 크기로" />
          <span className="gap" />
          <button type="button" className="w98-button close" tabIndex={-1} aria-label="닫기" />
        </span>
      </div>
      <div className="w98-menubar" onPointerDown={(e) => e.stopPropagation()}>
        {menu.map((top, i) => (
          <div key={i} onPointerEnter={() => (setHover(i), open !== null && setOpen(i))} onPointerLeave={() => setHover(null)}>
            <div className={`item${open === i ? ' open' : hover === i ? ' hover' : ''}`} onPointerDown={() => (setOpen(open === i ? null : i), setHl(null))}>
              {top.text}
            </div>
            {open === i && (
              <div className="w98-menu">
                {top.items?.map((m) => {
                  const on = enabled(m);
                  return (
                    <div
                      key={m.id}
                      className={`entry${hl === m.id ? ' hl' : ''}${on ? '' : ' grayed'}${flags[m.id]?.checked ? ' checked' : ''}`}
                      onPointerEnter={() => setHl(m.id)}
                      onPointerUp={() => {
                        if (!on) return;
                        setOpen(null);
                        onCommand(m.id);
                      }}
                    >
                      {m.text}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="w98-mdi" style={{ width: client.width, height: client.height, flex: 'none' }}>
        {children(client)}
      </div>
    </div>
  );
}

/** 아이콘(리소스 0x7e)을 그림 주소로: 캡션은 16 × 16, 바탕화면 아이콘은 32 × 32 */
export function iconUrl(exe: ExeImage, size = 16): string {
  const icon = smallIcon(readIcons(exe, 0x7e), size);
  const canvas = document.createElement('canvas');
  canvas.width = icon.width;
  canvas.height = icon.height;
  canvas.getContext('2d')!.putImageData(new ImageData(icon.rgba, icon.width, icon.height), 0, 0);
  return canvas.toDataURL();
}
