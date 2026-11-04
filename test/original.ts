import { existsSync, readFileSync } from 'node:fs';

const ROOT = new URL('../original/VMO_WIN/', import.meta.url);

/** original/VMO_WIN 아래 원본 파일을 읽는다. 없으면 받는 방법을 알려주며 실패한다. */
export function readOriginal(name: string): Uint8Array<ArrayBuffer> {
  const url = new URL(name, ROOT);
  if (!existsSync(url)) {
    throw new Error(`원본 데이터가 없습니다: ${url.pathname}\n먼저 \`pnpm fetch-original\`을 실행하세요.`);
  }
  return new Uint8Array(readFileSync(url));
}
