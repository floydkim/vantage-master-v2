import { crc32 } from 'node:zlib';
import { expect, it } from 'vitest';
import { HELP_H, HELP_W, HelpWindow } from '../../src/ui/battle/helpWindow.ts';
import { readGolden } from '../engine/block.ts';
import { exe, read } from './screenCases.ts';

interface HelpCase {
  readonly steps: readonly { readonly text: number | null; readonly rows: readonly number[] }[];
}
const [c] = readGolden<HelpCase>('help');
const rows = (image: Uint8Array) => Array.from({ length: HELP_H }, (_, r) => crc32(image.subarray(r * HELP_W, (r + 1) * HELP_W)));

it('도움말 창 그림이 문구마다 원작과 같다(바탕 DATA00 0x1a, 앞 문구 줄만 세로줄 무늬로 지움, 같은 문구는 그대로)', () => {
  const help = new HelpWindow(read);
  expect(rows(help.image)).toEqual(c.steps[0].rows);
  const changed = c.steps.slice(1).map((s, i) => {
    const before = help.image.slice();
    const drawn = help.set(exe.cString(s.text!));
    expect(rows(help.image), `문구 ${i}`).toEqual(s.rows);
    return drawn && before.some((v, k) => v !== help.image[k]);
  });
  expect(changed).toContain(false); // 같은 문구 반복
});
