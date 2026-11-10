import { crc32 } from 'node:zlib';
import { expect, it } from 'vitest';
import { readGlyphs } from '../../src/ui/battle/font.ts';
import { NOTICE_H, noticeAt, noticeImage } from '../../src/ui/battle/notice.ts';
import { loadBattleArt } from '../../src/ui/battle/screen.ts';
import { readGolden } from '../engine/block.ts';
import { exe, mapOf, read } from './screenCases.ts';

interface NoticeCase {
  /** 원작 글은 exe 주소, 그 밖은 16진 바이트 */
  readonly args: { readonly address?: string; readonly text?: string };
  readonly expected: { readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly counter: number; readonly rows: readonly number[] };
}
const cases = readGolden<NoticeCase>('notice');

it('알림판 그림(0x42e38f: 칩 테두리, 글자 그림자, 0x80 이상은 2바이트 16px)과 자리(프레임 가운데)가 원작과 같다', () => {
  const art = loadBattleArt(exe, read, mapOf(3));
  const glyphs = readGlyphs(read);
  for (const c of cases) {
    const text = c.args.address ? exe.cString(Number(c.args.address)) : Buffer.from(c.args.text!, 'hex').toString('latin1');
    const { width, pixels } = noticeImage(text, art.sheet.chips, glyphs);
    expect([width, NOTICE_H], text).toEqual([c.expected.w, c.expected.h]);
    expect(noticeAt(width, { left: 0, top: 0, right: 1024, bottom: 768 }), text).toEqual({ x: c.expected.x, y: c.expected.y });
    const rows = Array.from({ length: NOTICE_H }, (_, r) => crc32(pixels.subarray(r * width, (r + 1) * width)));
    expect(rows, text).toEqual(c.expected.rows);
  }
});
