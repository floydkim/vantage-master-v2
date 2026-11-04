// Win98 MessageBox(아이콘 없음)를 대화 상자 템플릿으로 근사한다: 글자(줄마다 대화 단위 폭 = 글자 수 × 4 = 평균 글자 폭(DIALOG_BASE 가로), 줄 높이 8),
// 그 아래 가운데에 단추 50 × 14(사이 6). 원작은 user32가 글자 폭을 재어 배치하므로 크기는 몇 픽셀 다를 수 있다
import type { Dialog } from '../../formats/dialogs.ts';

const MARGIN = 10;
const BUTTON = { w: 50, h: 14, gap: 6 };
const STYLE = 0x80c80080; // WS_POPUP | WS_CAPTION | WS_SYSMENU | DS_MODALFRAME

export const IDYES = 6;
export const IDNO = 7;
export const IDOK = 1;

export function messageBox(title: string, text: string, buttons: readonly { readonly id: number; readonly text: string }[]): Dialog {
  const lines = text.split('\n');
  const textW = Math.max(...lines.map((l) => l.length)) * 4;
  const textH = lines.length * 8;
  const buttonsW = buttons.length * BUTTON.w + (buttons.length - 1) * BUTTON.gap;
  const w = Math.max(textW, buttonsW) + MARGIN * 2;
  const top = MARGIN + textH + MARGIN;
  const left = Math.trunc((w - buttonsW) / 2);
  return {
    title,
    style: STYLE,
    font: null,
    x: 0,
    y: 0,
    w,
    h: top + BUTTON.h + 7,
    controls: [
      { id: 0xffff, style: 0x50020000, className: 0x82, text, x: MARGIN, y: MARGIN, w: textW, h: textH },
      ...buttons.map((b, i) => ({ id: b.id, style: 0x50010000 | (i === 0 ? 1 : 0), className: 0x80, text: b.text, x: left + i * (BUTTON.w + BUTTON.gap), y: top, w: BUTTON.w, h: BUTTON.h })),
    ],
  };
}
