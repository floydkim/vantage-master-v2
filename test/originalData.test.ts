import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { readOriginal } from './original.ts';

it('original/VMO_WIN의 vmv2.exe가 기준 판본(VMOnline)이다', () => {
  const hash = createHash('sha256').update(readOriginal('vmv2.exe')).digest('hex');
  expect(hash).toBe('daa647ff03cc1437fe5ade458f6a43a7138e8bfb820a86fb1b661ca75895819f');
});
