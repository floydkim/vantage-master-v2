import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SAVE_SIZE, decodeSaveFile, encodeSaveFile } from '../../src/formats/saveFile.ts';

// 원작 함수(vmv2.exe 0x44147f 인코딩, 0x441546 디코딩)를 오라클로 실행해 만든 정답. 재생성: pnpm oracle save_file
interface Golden {
  readonly cases: readonly { readonly plain: string; readonly encoded: string; readonly decoded: string }[];
}
const golden: Golden = JSON.parse(readFileSync(new URL('../golden/saveFile.json', import.meta.url), 'utf8'));
const bytes = (b64: string) => new Uint8Array(Buffer.from(b64, 'base64'));

describe.each(golden.cases.map((c, i) => [i, c] as const))('원작 픽스처 %i', (_, c) => {
  it('인코딩이 원작과 같다(블록의 체크섬 칸 값은 무시)', () => {
    expect(encodeSaveFile(bytes(c.plain))).toEqual(bytes(c.encoded));
  });
  it('디코딩이 원작과 같다(체크섬 칸은 0)', () => {
    expect(decodeSaveFile(bytes(c.encoded))).toEqual(bytes(c.decoded));
  });
});

it('한 바이트라도 바뀌면 체크섬 오류', () => {
  const file = bytes(golden.cases[2].encoded);
  file[100] ^= 1;
  expect(() => decodeSaveFile(file)).toThrow('체크섬');
});

it('크기가 다르면 오류', () => {
  expect(() => decodeSaveFile(new Uint8Array(SAVE_SIZE - 1))).toThrow('3692바이트');
  expect(() => encodeSaveFile(new Uint8Array(SAVE_SIZE + 1))).toThrow('3692바이트');
});

it('byteOffset이 있는 Node Buffer도 원작과 같게 처리하고 입력을 바꾸지 않는다', () => {
  const c = golden.cases[2];
  const file = Buffer.concat([Buffer.alloc(1), Buffer.from(c.encoded, 'base64')]).subarray(1);
  const fileBefore = Buffer.from(file);
  expect(decodeSaveFile(file)).toEqual(bytes(c.decoded));
  expect(file.equals(fileBefore)).toBe(true);
  const block = Buffer.concat([Buffer.alloc(3), Buffer.from(c.plain, 'base64')]).subarray(3);
  const blockBefore = Buffer.from(block);
  expect(encodeSaveFile(block)).toEqual(bytes(c.encoded));
  expect(block.equals(blockBefore)).toBe(true);
});
