import { useEffect, useMemo, useRef } from 'react';
import { htmlText } from '../../i18n/hangul.ts';
import type { Size } from '../frame/layout.ts';
import { NOTICE_H, noticeAt, noticeImage } from './notice.ts';
import { toRgba } from './screen.ts';

/** vmv2.exe 0x0042e186: 카운터 1800 × 16ms. 처음 60틱(0.96초)은 클릭을 받지 않고, 다 줄면 저절로 닫힌다 */
export const NOTICE_READY_MS = 60 * 16;
export const NOTICE_CLOSE_MS = 1800 * 16;

/**
 * 알림판(VANTAGEPOPUP 0x42e090): 프레임(가상 화면에 최대화) 가운데에 뜨고, 그동안 프레임은 꺼진다(EnableWindow FALSE). 0.96초 뒤 왼쪽·오른쪽 누름이나
 * 28.8초가 지나면 닫힌다. 효과음은 없다. 원작은 알림판에 마우스를 가두므로(SetCapture) 화면 어디를 눌러도 닫히게 둔다
 */
export function NoticeBoard({
  text,
  chips,
  glyphs,
  colors,
  screen,
  onClose,
}: {
  readonly text: string;
  readonly chips: Uint8Array;
  readonly glyphs: Uint8Array;
  readonly colors: Uint8Array;
  readonly screen: Size;
  readonly onClose: () => void;
}) {
  const born = useRef(performance.now());
  const done = useRef(false);
  const close = () => {
    if (done.current) return;
    done.current = true;
    onClose();
  };
  const { width, pixels } = useMemo(() => noticeImage(text, chips, glyphs), [text, chips, glyphs]);
  const at = noticeAt(width, { left: 0, top: 0, right: screen.width, bottom: screen.height });
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    canvas.current?.getContext('2d')?.putImageData(new ImageData(toRgba(pixels, colors), width, NOTICE_H), 0, 0);
  }, [pixels, colors, width]);
  useEffect(() => {
    const id = setTimeout(close, NOTICE_CLOSE_MS);
    return () => clearTimeout(id);
  }, []);
  const press = () => performance.now() - born.current >= NOTICE_READY_MS && close();
  return (
    <>
      <div className="battle-backdrop notice-backdrop" onMouseDown={press} onContextMenu={(e) => e.preventDefault()} />
      <canvas ref={canvas} className="notice-board" role="alert" aria-label={htmlText(text)} width={width} height={NOTICE_H} style={{ left: at.x, top: at.y }} onMouseDown={press} onContextMenu={(e) => e.preventDefault()} />
    </>
  );
}
