// 대화 상자 배치: 템플릿의 대화 단위를 픽셀로(MapDialogRect), 바깥 크기(DS_MODALFRAME·WS_CAPTION), 부모 가운데 놓기(vmv2.exe 0x0041b918)
import type { Dialog, DialogControl } from '../../formats/dialogs.ts';
import type { Metrics } from './frame.ts';
import type { Point, Rect, Size } from './layout.ts';

/**
 * 대화 기준 단위. Windows는 대화 상자 글꼴의 평균 폭((52글자 폭 / 26 + 1) / 2)과 높이로 정한다. 원작 MS Sans Serif 10pt는 7 × 16이지만
 * 리메이크는 대화 상자 글을 갈무리11 12px(52글자 396px → 8)로 그리므로 가로 8, 세로는 16 그대로다(글이 칸을 넘지 않게, win98.css)
 */
export const DIALOG_BASE = { cx: 8, cy: 16 } as const;

// MulDiv(v, base, 4 또는 8): 반올림
const map = (v: number, base: number, div: number) => Math.sign(v) * Math.floor((Math.abs(v) * base) / div + 0.5);

export interface PlacedControl extends DialogControl {
  readonly rect: Rect;
  /** 업다운의 짝 컨트롤 id(UDS_AUTOBUDDY: 템플릿에서 바로 앞) */
  readonly buddy?: number;
}

/** 업다운 한 칸(UDS_WRAP 없음): 지금 값을 범위로 자른 뒤 ±1, 다시 자른다(범위 밖 값에서의 comctl32 동작은 미확인) */
export const stepValue = (value: number, min: number, max: number, delta: number): number => Math.min(max, Math.max(min, Math.min(max, Math.max(min, value)) + delta));

const WS_GROUP = 0x20000;
const RADIO_KINDS = [4, 9]; // BS_RADIOBUTTON, BS_AUTORADIOBUTTON

/** 자동 라디오 묶음(대화 관리자): id가 든 WS_GROUP 구간의 라디오 단추들(템플릿 순서) */
export function radioGroup(d: Dialog, id: number): number[] {
  const i = d.controls.findIndex((c) => c.id === id);
  let start = i;
  while (start > 0 && !(d.controls[start].style & WS_GROUP)) start--;
  let end = start + 1;
  while (end < d.controls.length && !(d.controls[end].style & WS_GROUP)) end++;
  return d.controls.slice(start, end).flatMap((c) => (c.className === 0x80 && RADIO_KINDS.includes(c.style & 0xf) ? [c.id] : []));
}

export const UPDOWN = 'msctls_updown32';
const UDS_ALIGNRIGHT = 4;
const UDS_AUTOBUDDY = 0x10;
export const isUpdown = (c: DialogControl): boolean => typeof c.className === 'string' && c.className.toLowerCase() === UPDOWN;

// comctl32 업다운이 만들어질 때(UDS_AUTOBUDDY·UDS_ALIGNRIGHT): 짝 오른쪽 끝 안에 자기 폭으로 붙고 짝 폭을 그만큼 줄인다. 높이는 짝과 같다
// (Win98 실제 픽셀 — 테두리 겹침 — 은 미확인, notes_master_edit §16)
function attachUpdowns(controls: PlacedControl[]): PlacedControl[] {
  const out = controls.slice();
  out.forEach((c, i) => {
    if (!isUpdown(c) || !(c.style & UDS_AUTOBUDDY) || i === 0) return;
    const b = out[i - 1];
    const width = c.rect.right - c.rect.left;
    if (c.style & UDS_ALIGNRIGHT) {
      out[i] = { ...c, buddy: b.id, rect: { left: b.rect.right - width, top: b.rect.top, right: b.rect.right, bottom: b.rect.bottom } };
      out[i - 1] = { ...b, rect: { ...b.rect, right: b.rect.right - width } };
    } else out[i] = { ...c, buddy: b.id };
  });
  return out;
}

/** screen: 바깥 폭이 화면보다 넓으면(0x76 슬롯은 기준 8에서 658px) 가로 단위를 화면에 맞게 줄인다. 원작 기준 7로 되돌리면 목록 줄 끝이 잘린다 */
export function dialogLayout(d: Dialog, m: Metrics, screen?: Size): { readonly client: Size; readonly outer: Size; readonly controls: readonly PlacedControl[] } {
  const cx = screen?.width && map(d.w, DIALOG_BASE.cx, 4) + m.dlgFrame * 2 > screen.width ? ((screen.width - m.dlgFrame * 2) * 4) / d.w : DIALOG_BASE.cx;
  const x = (v: number) => map(v, cx, 4);
  const y = (v: number) => map(v, DIALOG_BASE.cy, 8);
  const client = { width: x(d.w), height: y(d.h) };
  return {
    client,
    outer: { width: client.width + m.dlgFrame * 2, height: client.height + m.caption + m.dlgFrame * 2 },
    controls: attachUpdowns(d.controls.map((c) => ({ ...c, rect: { left: x(c.x), top: y(c.y), right: x(c.x) + x(c.w), bottom: y(c.y) + y(c.h) } }))),
  };
}

/** vmv2.exe 0x0041b918: 부모 창 사각형(없으면 화면)의 가운데, 화면 밖으로 나가면 안으로 */
export function centerDialog(parent: Rect | null, size: Size, screen: Size): Point {
  const p = parent ?? { left: 0, top: 0, right: screen.width, bottom: screen.height };
  let x = Math.trunc((p.left + p.right - size.width) / 2);
  let y = Math.trunc((p.top + p.bottom - size.height) / 2);
  if (x < 0) x = 0;
  else if (x + size.width > screen.width) x = screen.width - size.width;
  if (y < 0) y = 0;
  else if (y + size.height > screen.height) y = screen.height - size.height;
  return { x, y };
}

const clampInto = (v: number, size: number, screen: number) => Math.max(0, Math.min(v, screen - size));

/** DS_CENTER 없는 템플릿 (0, 0) 대화 상자: 클라이언트 왼쪽 위 = 부모 클라이언트 원점(ClientToScreen), 화면 밖이면 안으로. 바깥 왼쪽 위를 돌려준다 */
export function placeDialog(parentClient: Point, size: Size, m: Metrics, screen: Size): Point {
  return { x: clampInto(parentClient.x - m.dlgFrame, size.width, screen.width), y: clampInto(parentClient.y - m.dlgFrame - m.caption, size.height, screen.height) };
}

/** 그림 사각형(대화 단위)을 픽셀로(MapDialogRect) 바꾼 뒤 그림 크기의 정수 배율로 가운데에 (vmv2.exe 0x0041bbfc). 배율이 0이면 그대로 */
export function fitPicture(r: Rect, size: Size): Rect {
  const left = map(r.left, DIALOG_BASE.cx, 4);
  const top = map(r.top, DIALOG_BASE.cy, 8);
  const w = map(r.right, DIALOG_BASE.cx, 4) - left;
  const h = map(r.bottom, DIALOG_BASE.cy, 8) - top;
  const k = Math.min(Math.trunc(w / size.width), Math.trunc(h / size.height));
  if (k === 0) return { left, top, right: left + w, bottom: top + h };
  const x = left + Math.trunc((w - size.width * k) / 2);
  const y = top + Math.trunc((h - size.height * k) / 2);
  return { left: x, top: y, right: x + size.width * k, bottom: y + size.height * k };
}

/** 대화 관리자 키:Enter는 기본 단추(BS_DEFPUSHBUTTON, 없으면 IDOK 1), Esc는 IDCANCEL(2). 그 밖은 null */
export function dialogKey(d: Dialog, key: string): number | null {
  if (key === 'Escape') return 2;
  if (key !== 'Enter') return null;
  return d.controls.find((c) => c.className === 0x80 && (c.style & 0xf) === 1)?.id ?? 1;
}
