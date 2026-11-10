import { expect, it } from 'vitest';
import { readDialog } from '../../src/formats/dialogs.ts';
import { uiKey } from '../../src/i18n/ko.ts';
import { editText } from '../../src/ui/frame/DialogBox.tsx';
import { exe } from './screenCases.ts';

const texts = (id: number) => readDialog(exe, id).controls.map((c) => c.text);

it('원작 대화 상자 글자', () => {
  expect(readDialog(exe, 0x73).title).toBe('Report');
  expect(texts(0x73)).toEqual(['OK', 'Not enough MP']);
  expect(readDialog(exe, 0x74).title).toBe('Confirm');
  expect(texts(0x74).map((t, i) => (i === 2 ? uiKey(t ?? '') : t))).toEqual(['OK', 'Cancel', 'e8858c390ca4ec63']); // 셋째는 네이티얼을 지울지 묻는 글(원작 문장은 해시로)
  const magic = readDialog(exe, 0x70);
  expect([magic.title, magic.w, magic.h]).toEqual(['Magic', 134, 189]);
  expect(magic.controls[0]).toEqual({ id: 0x57a, style: 0x50a30101, className: 0x83, text: null, x: 5, y: 5, w: 60, h: 53 });
  expect([magic.style >>> 0, magic.font]).toEqual([0x90c800c0, { size: 10, face: 'MS Sans Serif' }]);
  const summon = readDialog(exe, 0x6f);
  expect([summon.title, summon.controls.length, summon.controls[0].id]).toEqual(['Summon List', 48, 0x57b]);
  expect(texts(0x6f)).toContain('MP Need');
});

it('없는 대화 상자는 RangeError', () => {
  expect(() => readDialog(exe, 0x7fff)).toThrow(RangeError);
});

it('편집 칸 글자: 1바이트 글꼴로 그릴 수 있는 0x20~0xff만 남긴다(붙여 넣은 탭·줄바꿈·한글 등)', () => {
  expect(editText('Floyd\t')).toBe('Floyd');
  expect(editText('A\r\nB\u0001C')).toBe('ABC');
  expect(editText('Mail%Mx é~')).toBe('Mail%Mx é~');
  expect(editText('플로이드Z')).toBe('Z');
});
