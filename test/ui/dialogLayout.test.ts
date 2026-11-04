import { expect, it } from 'vitest';
import { readDialog } from '../../src/formats/dialogs.ts';
import { centerDialog, DIALOG_BASE, dialogKey, dialogLayout, fitPicture, placeDialog, stepValue } from '../../src/ui/frame/dialogLayout.ts';
import { WIN98 } from '../../src/ui/frame/frame.ts';
import { exe } from './screenCases.ts';

it('대화 단위 → 픽셀(MapDialogRect)과 바깥 크기(대화 틀 3·캡션 19). 가로 기준은 대화 상자 글꼴 갈무리11 12px의 평균 폭 8(52글자 396px → (396 / 26 + 1) / 2, GdiGetCharDimensions 식), 세로는 원작 MS Sans Serif 10pt의 16', () => {
  expect(DIALOG_BASE).toEqual({ cx: 8, cy: 16 });
  const report = dialogLayout(readDialog(exe, 0x73), WIN98); // "Not enough MP" 83 × 47
  expect(report.client).toEqual({ width: 166, height: 94 });
  expect(report.outer).toEqual({ width: 172, height: 119 });
  const ok = report.controls.find((c) => c.id === 1)!;
  expect(ok.rect).toEqual({ left: 30, top: 50, right: 130, bottom: 78 }); // (15, 25) 50 × 14
  const magic = dialogLayout(readDialog(exe, 0x70), WIN98);
  const list = readDialog(exe, 0x70).controls.find((c) => c.id === 1402)!;
  expect(magic.controls.find((c) => c.id === 1402)!.rect).toEqual({ left: list.x * 2, top: 10, right: list.x * 2 + list.w * 2, bottom: 116 });
});

it('화면보다 넓은 대화 상자(0x76 슬롯, 기준 8에서 658px)만 화면에 맞게 가로 단위를 줄이고, 나머지는 화면 크기와 상관없이 그대로', () => {
  const small = { width: 640, height: 480 };
  const slots = readDialog(exe, 0x76);
  expect(dialogLayout(slots, WIN98).outer.width).toBe(658);
  expect(dialogLayout(slots, WIN98, { width: 1024, height: 768 }).outer.width).toBe(658);
  const fitted = dialogLayout(slots, WIN98, small);
  expect(fitted.outer.width).toBe(640);
  expect(fitted.outer.height).toBe(dialogLayout(slots, WIN98).outer.height);
  for (const c of fitted.controls) expect(c.rect.right, String(c.id)).toBeLessThanOrEqual(fitted.client.width);
  for (const id of [0x6f, 0x7d, 0x81]) expect(dialogLayout(readDialog(exe, id), WIN98, small), id.toString(16)).toEqual(dialogLayout(readDialog(exe, id), WIN98));
  expect(dialogLayout(slots, WIN98, { width: 0, height: 0 })).toEqual(dialogLayout(slots, WIN98)); // ScreenLayer 기본값 = 화면 없음
});

it('부모 가운데에 놓고 화면 밖이면 안으로(0x41b918)', () => {
  const size = { width: 151, height: 119 };
  const screen = { width: 640, height: 480 };
  expect(centerDialog({ left: 100, top: 100, right: 300, bottom: 200 }, size, screen)).toEqual({ x: 124, y: 90 });
  expect(centerDialog({ left: -200, top: -100, right: 0, bottom: 0 }, size, screen)).toEqual({ x: 0, y: 0 });
  expect(centerDialog({ left: 600, top: 440, right: 700, bottom: 520 }, size, screen)).toEqual({ x: 489, y: 361 });
  expect(centerDialog(null, size, screen)).toEqual({ x: 244, y: 180 }); // 부모 없음: 화면 가운데
});

it('Enter는 기본 단추(BS_DEFPUSHBUTTON, 없으면 IDOK), Esc는 IDCANCEL(단추가 없어도, 대화 관리자)', () => {
  expect(dialogKey(readDialog(exe, 0x70), 'Enter')).toBe(1);
  expect(dialogKey(readDialog(exe, 0x6f), 'Enter')).toBe(1); // 기본 단추 없음 → IDOK
  expect(dialogKey(readDialog(exe, 0x73), 'Escape')).toBe(2);
  expect(dialogKey(readDialog(exe, 0x73), 'a')).toBeNull();
});

it('템플릿 (0, 0) 대화 상자는 클라이언트 왼쪽 위가 부모 클라이언트 원점에, 화면 밖이면 안으로(DS_CENTER 없음)', () => {
  const size = { width: 151, height: 119 };
  const screen = { width: 640, height: 480 };
  expect(placeDialog({ x: 100, y: 200 }, size, WIN98, screen)).toEqual({ x: 97, y: 178 }); // 대화 틀 3, 캡션 19
  expect(placeDialog({ x: 1, y: 5 }, size, WIN98, screen)).toEqual({ x: 0, y: 0 });
  expect(placeDialog({ x: 600, y: 470 }, size, WIN98, screen)).toEqual({ x: 489, y: 361 });
});

it('그림 사각형: 대화 단위 → 픽셀 뒤 정수 배율로 가운데(0x41bbfc)', () => {
  const portrait = { width: 48, height: 67 };
  expect(fitPicture({ left: 8, top: 5, right: 0x40, bottom: 0x5f }, portrait)).toEqual({ left: 24, top: 33, right: 120, bottom: 167 }); // 0x445355·0x4445c8
  expect(fitPicture({ left: 0x52, top: 5, right: 0x8a, bottom: 0x5f }, portrait)).toEqual({ left: 172, top: 33, right: 268, bottom: 167 }); // 0x445924
  expect(fitPicture({ left: 0x41, top: 0, right: 0x86, bottom: 0x73 }, { width: 96, height: 192 })).toEqual({ left: 151, top: 19, right: 247, bottom: 211 }); // 0x425a2b
});

it('업다운(msctls_updown32): UDS_AUTOBUDDY 짝은 바로 앞 컨트롤, UDS_ALIGNRIGHT면 짝 오른쪽 끝 안에 템플릿 폭으로 붙고 짝 폭이 준다', () => {
  const edit = dialogLayout(readDialog(exe, 0x7d), WIN98); // Master Edit
  const at = (id: number) => edit.controls.find((c) => c.id === id)!;
  expect(at(0x5de).buddy).toBe(0x5dc);
  expect(at(0x5de).rect).toEqual({ left: 226, top: 60, right: 242, bottom: 88 }); // 레벨: 짝 (202, 60)~(242, 88), 업다운 8 DU = 16px
  expect(at(0x5dc).rect).toEqual({ left: 202, top: 60, right: 226, bottom: 88 });
  const pairs = [[0x5df, 0x5dd], [0x5e0, 0x643], [0x5e1, 0x644], [0x5e2, 0x645], [0x5e3, 0x646], [0x5e4, 0x647], [0x5e5, 0x648]];
  for (const [updown, buddy] of pairs) {
    expect(at(updown).buddy, updown.toString(16)).toBe(buddy);
    expect(at(updown).rect.right).toBe(at(buddy).rect.right + 16);
    expect(at(updown).rect.left).toBe(at(buddy).rect.right);
  }
});

it('업다운 한 칸은 감싸지 않고 자른다(UDS_WRAP 없음). 범위 밖 값은 먼저 범위로', () => {
  expect(stepValue(5, 0, 20, 1)).toBe(6);
  expect(stepValue(20, 0, 20, 1)).toBe(20);
  expect(stepValue(0, 0, 20, -1)).toBe(0);
  expect(stepValue(21, 0, 20, -1)).toBe(19);
  expect(stepValue(21, 0, 20, 1)).toBe(20);
  expect(stepValue(1, 1, 40, -1)).toBe(1);
});
