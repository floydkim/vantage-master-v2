import { type ReactNode, useContext, useEffect, useRef } from 'react';
import type { Dialog } from '../../formats/dialogs.ts';
import { byteText, htmlText } from '../../i18n/hangul.ts';
import { ScreenLayer } from './Desktop.tsx';
import { dialogKey, dialogLayout, isUpdown, stepValue } from './dialogLayout.ts';
import type { Metrics } from './frame.ts';
import type { Point } from './layout.ts';

/** 대화 상자 안 컨트롤 값(SetDlgItemText·LB_ADDSTRING·BM_SETCHECK 같은 것) */
export interface DialogValues {
  readonly texts?: Readonly<Record<number, string>>;
  readonly lists?: Readonly<Record<number, { readonly items: readonly string[]; readonly selected: number | null }>>;
  readonly checked?: Readonly<Record<number, boolean>>;
  readonly disabled?: ReadonlySet<number>;
  /** 업다운 범위(UDM_SETRANGE): 업다운 id → [아래, 위] */
  readonly ranges?: Readonly<Record<number, readonly [number, number]>>;
}

const BUTTON = 0x80;
const WS_SYSMENU = 0x80000; // 캡션 닫기 단추(템플릿 0x73·0x7c에는 없음)
const EDIT = 0x81;
const STATIC = 0x82;
const LIST = 0x83;
const BS_DEFPUSHBUTTON = 1;
const BS_CHECKBOX = 2;
const BS_AUTOCHECKBOX = 3;
const BS_RADIOBUTTON = 4;
const BS_GROUPBOX = 7;
const BS_AUTORADIOBUTTON = 9;
const SS_CENTER = 1;
const SS_RIGHT = 2;
const WS_VSCROLL = 0x200000;
const WS_TABSTOP = 0x10000;
const ES_READONLY = 0x800;
const ES_MULTILINE = 0x4;
/** 편집 칸 글자: 1바이트 글꼴(0x424707)로 그릴 수 있는 0x20~0xff만. 제어 문자는 원작이 글리프 표 앞을 읽어 그리므로 받지 않는다 */
export const editText = (s: string) => byteText(s).replace(/[^\x20-\xff]/g, '');

/**
 * 원작 대화 상자 템플릿(MS Sans Serif 10pt)을 Win98 모양으로 그린다. 명령은 WM_COMMAND처럼 넘긴다:
 * 단추·라디오·체크는 'click', 목록 선택 바뀜 'select'(LBN_SELCHANGE), 두 번 누름 'double'(LBN_DBLCLK), 편집 칸 글자 바뀜 'update'(EN_UPDATE:
 * 입력 칸에 치거나 업다운이 짝 글자를 바꿀 때, 짝 id와 새 글자). 닫기 단추는 Cancel(2)
 */
export function DialogBox({
  dialog,
  at,
  metrics,
  values = {},
  enabled = true,
  children,
  onCommand,
}: {
  readonly dialog: Dialog;
  /** 바깥 왼쪽 위(가상 화면 좌표) */
  readonly at: Point;
  readonly metrics: Metrics;
  readonly values?: DialogValues;
  /** 자식 대화 상자를 붙이면 부모는 꺼진다(EnableWindow FALSE, 0x41b878) */
  readonly enabled?: boolean;
  /** 클라이언트 위에 그릴 것(그림 미리보기) */
  readonly children?: ReactNode;
  readonly onCommand: (id: number, code: 'click' | 'select' | 'double' | 'update', index?: number, text?: string) => void;
}) {
  const layout = dialogLayout(dialog, metrics, useContext(ScreenLayer).size);
  const off = (id: number) => values.disabled?.has(id) ?? false;
  const root = useRef<HTMLDivElement>(null);
  // 대화 관리자는 첫 WS_TABSTOP 컨트롤에 포커스를 준다. 입력 칸이면 글자 전체를 고른다(이름 입력 0x86)
  const first = layout.controls.find((c) => c.style & WS_TABSTOP);
  const firstInput = first && first.className === EDIT && !(first.style & ES_READONLY) ? first.id : null;
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!enabled) return;
    if (input.current) input.current.select();
    else root.current?.focus(); // 자식이 닫혀 다시 켜지면 포커스도
  }, [enabled]);
  const text = (c: { readonly id: number; readonly text: string | null }) => htmlText(values.texts?.[c.id] ?? c.text ?? '');
  return (
    <div
      ref={root}
      className="w98-window w98-dialog"
      role="dialog"
      aria-modal="true"
      aria-label={htmlText(dialog.title)}
      tabIndex={-1}
      style={{ left: at.x, top: at.y, width: layout.outer.width, height: layout.outer.height, padding: metrics.dlgFrame, outline: 'none' }}
      onKeyDown={(e) => {
        const id = dialogKey(dialog, e.key);
        if (!enabled || id === null || off(id)) return;
        e.preventDefault();
        onCommand(id, 'click');
      }}
    >
      <div className={`w98-caption${enabled ? '' : ' inactive'}`}>
        <span className="title">{htmlText(dialog.title)}</span>
        {(dialog.style & WS_SYSMENU) !== 0 && (
          <span className="buttons">
            <button type="button" className="w98-button close" tabIndex={-1} aria-label="닫기" disabled={!enabled} onClick={() => onCommand(2, 'click')} />
          </span>
        )}
      </div>
      <div className="w98-dialog-client" style={{ width: layout.client.width, height: layout.client.height, pointerEvents: enabled ? undefined : 'none' }}>
        {layout.controls.map((c, i) => {
          const { left, top, right, bottom } = c.rect;
          const style = { left, top, width: right - left, height: bottom - top };
          const kind = c.style & 0xf;
          const label = text(c).replace(/&(.)/g, '$1');
          if (c.className === BUTTON && kind === BS_GROUPBOX) {
            return (
              <div key={i} className="w98-group" style={style}>
                {label && <span>{label}</span>}
              </div>
            );
          }
          if (c.className === BUTTON && [BS_CHECKBOX, BS_AUTOCHECKBOX, BS_RADIOBUTTON, BS_AUTORADIOBUTTON].includes(kind)) {
            const radio = kind === BS_RADIOBUTTON || kind === BS_AUTORADIOBUTTON;
            return (
              <label key={i} className={`w98-check${off(c.id) ? ' grayed' : ''}`} style={style} onClick={() => !off(c.id) && onCommand(c.id, 'click')}>
                <span className={`${radio ? 'radio' : 'box'}${values.checked?.[c.id] ? ' on' : ''}`} />
                {label}
              </label>
            );
          }
          if (c.className === BUTTON) {
            return (
              <button key={i} type="button" className={`w98-push${kind === BS_DEFPUSHBUTTON ? ' default' : ''}`} style={style} disabled={off(c.id)} onClick={() => onCommand(c.id, 'click')}>
                {label}
              </button>
            );
          }
          if (c.className === LIST) {
            const list = values.lists?.[c.id];
            return (
              <div key={i} className={`w98-list${c.style & WS_VSCROLL ? ' scroll' : ''}`} style={style}>
                {list?.items.map((item, k) => (
                  <div
                    key={k}
                    className={list.selected === k ? 'selected' : undefined}
                    onClick={() => list.selected !== k && onCommand(c.id, 'select', k)}
                    onDoubleClick={() => onCommand(c.id, 'double', k)}
                  >
                    {htmlText(item)}
                  </div>
                ))}
              </div>
            );
          }
          if (c.className === EDIT && c.style & ES_READONLY) {
            return (
              <div key={i} className={`w98-edit readonly${c.style & ES_MULTILINE ? '' : ' single'}`} style={style}>
                {text(c)}
              </div>
            );
          }
          if (c.className === EDIT) {
            return (
              <input
                key={i}
                ref={c.id === firstInput ? input : undefined}
                className="w98-edit"
                style={style}
                value={text(c)}
                spellCheck={false}
                onChange={(e) => onCommand(c.id, 'update', undefined, editText(e.target.value))}
              />
            );
          }
          if (isUpdown(c) && c.buddy !== undefined) {
            // 짝 글자를 정수로 읽어 한 칸 옮기고(UDS_SETBUDDYINT) 바뀌었으면 짝 글자를 바꾼다 → 짝의 EN_UPDATE
            const [min, max] = values.ranges?.[c.id] ?? [0, 100];
            const buddy = layout.controls.find((b) => b.id === c.buddy)!;
            const step = (delta: number) => {
              const now = Number.parseInt(text(buddy), 10) || 0;
              const next = stepValue(now, min, max, delta);
              if (next !== now) onCommand(c.buddy!, 'update', undefined, String(next));
            };
            return (
              <div key={i} className="w98-updown" style={style}>
                <button type="button" tabIndex={-1} aria-label="위" onClick={() => step(1)} />
                <button type="button" tabIndex={-1} aria-label="아래" onClick={() => step(-1)} />
              </div>
            );
          }
          if (c.className === STATIC) {
            const align = kind === SS_CENTER ? 'center' : kind === SS_RIGHT ? 'right' : 'left';
            return (
              <div key={i} className="w98-static" style={{ ...style, textAlign: align }}>
                {label}
              </div>
            );
          }
          return null;
        })}
        {children}
      </div>
    </div>
  );
}
