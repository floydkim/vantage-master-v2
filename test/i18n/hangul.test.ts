import { afterEach, expect, it, vi } from 'vitest';
import { byteText, embolden, hangulGlyphs, hangulOn, htmlText, setHangul, setWideGlyphs, wideChar } from '../../src/i18n/hangul.ts';
import { editText } from '../../src/ui/frame/DialogBox.tsx';
import { drawText, readGlyphs } from '../../src/ui/battle/font.ts';
import { read } from '../ui/screenCases.ts';

const glyphs = readGlyphs(read);
afterEach(() => {
  setHangul(null); // 글리프·한국어 모드 모두 끔
  vi.unstubAllGlobals();
});

it('2바이트 글자는 글리프 제공자가 있으면 16 × 16 글리프, 없으면 빈칸(지금 그대로)', () => {
  const W = 40;
  const draw = () => {
    const out = new Uint8Array(W * 16);
    drawText(out, 0, W, '\xb0\xa1A', 7, glyphs);
    return out;
  };
  const blank = draw();
  expect(Array.from({ length: 16 }, (_, r) => blank.subarray(r * W, r * W + 16).some((v) => v !== 0))).not.toContain(true);
  const asked: number[] = [];
  setHangul((code) => (asked.push(code), Uint8Array.from({ length: 32 }, (_, k) => (k % 2 ? 0x01 : 0x80)))); // 맨 왼쪽·맨 오른쪽 열
  const out = draw();
  expect(asked).toEqual([0xb0a1]);
  for (let r = 0; r < 16; r++) {
    expect(Array.from(out.subarray(r * W, r * W + 16))).toEqual([7, ...Array(14).fill(0), 7]);
    expect(out.subarray(r * W + 16, r * W + W)).toEqual(blank.subarray(r * W + 16, r * W + W));
  }
});

it('굵게(0x4241ae, 한국어판 0x422f40): 켜진 칸의 왼쪽 칸을 켜되 한 칸 틈은 남긴다', () => {
  expect(embolden(0b1)).toBe(0b11);
  expect(embolden(0b11)).toBe(0b111);
  expect(embolden(0b101)).toBe(0b1101);
  expect(embolden(0x8000)).toBe(0x8000);
  expect(embolden(0)).toBe(0);
});

it('HTML 글: 한국어면 CP949 바이트 문자열을 유니코드로, 원문이거나 이미 유니코드(리소스 글)면 그대로', () => {
  const s = '\xb0\xa1\xb3\xaa A';
  expect(htmlText(s)).toBe(s);
  setHangul(() => new Uint8Array(32));
  expect(htmlText(s)).toBe('가나 A');
  expect(htmlText('가나 입력')).toBe('가나 입력');
  expect(htmlText('Battle window')).toBe('Battle window');
});

it('편집 칸에 친 글: 한국어면 CP949 바이트 문자열로(못 바꾸는 글자는 뺌), 원문이면 지금처럼 0x20~0xff만', () => {
  expect(editText('가A★é')).toBe('Aé');
  setHangul(() => new Uint8Array(32));
  expect(byteText('가나 A')).toBe('\xb0\xa1\xb3\xaa A');
  expect(editText('가A😀')).toBe('\xb0\xa1A');
  expect(htmlText(editText('마스터'))).toBe('마스터');
});

it('2바이트 글자 풀기: 한 글자가 아니거나 U+FFFD면 null(빈칸)', () => {
  const sjis = new TextDecoder('shift_jis');
  const cp949 = new TextDecoder('euc-kr');
  expect([0x82a0, 0xa1a1, 0xa1a4].map((c) => wideChar(sjis, c))).toEqual(['あ', null, null]);
  expect([0xb0a1, 0xa1a1].map((c) => wideChar(cp949, c))).toEqual(['가', '\u3000']);
});

it('원문(setWideGlyphs)은 글리프만: HTML 풀기·편집 칸·한국어판 자리는 끈 때와 같다', () => {
  const s = '\xb0\xa1A';
  setWideGlyphs(() => Uint8Array.from({ length: 32 }, () => 0xff));
  const out = new Uint8Array(40 * 16);
  drawText(out, 0, 40, '\x82\xa0', 7, glyphs);
  expect(out.subarray(0, 16).every((v) => v === 7)).toBe(true);
  expect([htmlText(s), byteText('가'), hangulOn()]).toEqual([s, '가', false]);
});

it('Neo둥근모 파일을 못 받아도(기준 경로·CSP·오프라인) 한국어 글리프는 다음 글꼴로 만든다 — 게임이 열린다', async () => {
  const fonts: unknown[] = [];
  vi.stubGlobal('FontFace', class {
    load = () => Promise.reject(new Error('404'));
  });
  const context = { font: '', measureText: () => ({ fontBoundingBoxAscent: 14, fontBoundingBoxDescent: 2 }) };
  vi.stubGlobal('document', { fonts: { add: (f: unknown) => fonts.push(f) }, createElement: () => ({ getContext: () => context }) });
  const g = await hangulGlyphs();
  expect(g).toBeTypeOf('function');
  expect(fonts).toEqual([]);
  expect(context.font).toContain('NeoDunggeunmo');
});
