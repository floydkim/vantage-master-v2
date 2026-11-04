import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { decodeMsVideo1, readAvi } from '../../src/formats/avi.ts';

const AVI = new URL('../../original/VMO_WIN/FALCOM.AVI', import.meta.url);

it.skipIf(!existsSync(AVI))('오프닝 FALCOM.AVI: 320 × 240·50ms·158프레임, Microsoft Video 1(16비트)을 풀면 ffmpeg와 프레임마다 같다(RGB555 LE MD5, tools/gen-opening-frames.sh)', () => {
  const avi = readAvi(new Uint8Array(readFileSync(AVI)));
  expect([avi.width, avi.height, avi.frameMs, avi.frames.length]).toEqual([320, 240, 50, 158]);
  const want = (JSON.parse(readFileSync(new URL('../golden/openingFrames.json', import.meta.url), 'utf8')) as { frames: string[] }).frames;
  const frame = new Uint16Array(avi.width * avi.height);
  const got = avi.frames.map((chunk) => {
    decodeMsVideo1(chunk, frame, avi.width, avi.height);
    return createHash('md5').update(new Uint8Array(frame.buffer)).digest('hex');
  });
  expect(got).toEqual(want);
});
