// 원작 세이브 파일(SAVE\SV%03d.DAT). 상태 블록(3,692바이트)에 체크섬을 넣고 바이트를 뒤섞은 것이다.
// 체크섬: 오프셋 4의 u32를 0으로 둔 채 전체 바이트를 더한 값(u32 LE, 오프셋 4).
// 뒤섞기: 키 k = 0x48부터 바이트마다 (b + k) → 상하 4비트 교환 → ^ k, 다음 키는 k + 0x5b.

export const SAVE_SIZE = 0xe6c;
const CHECKSUM_OFFSET = 4;
const FIRST_KEY = 0x48;
const KEY_STEP = 0x5b;

const swapNibbles = (b: number): number => ((b >> 4) | (b << 4)) & 0xff;

function byteSum(bytes: Uint8Array): number {
  let sum = 0;
  for (const b of bytes) sum = (sum + b) >>> 0;
  return sum;
}

function checkSize(bytes: Uint8Array): void {
  if (bytes.length !== SAVE_SIZE) throw new Error(`세이브 크기가 ${SAVE_SIZE}바이트가 아닙니다: ${bytes.length}`);
}

// vmv2.exe 0x0044147f
export function encodeSaveFile(block: Uint8Array): Uint8Array<ArrayBuffer> {
  checkSize(block);
  const out = new Uint8Array(block); // 항상 새 버퍼로 복사한다(Buffer.slice는 같은 메모리를 가리킨다)
  const view = new DataView(out.buffer);
  view.setUint32(CHECKSUM_OFFSET, 0, true);
  view.setUint32(CHECKSUM_OFFSET, byteSum(out), true);
  let k = FIRST_KEY;
  for (let i = 0; i < out.length; i++) {
    out[i] = swapNibbles((out[i] + k) & 0xff) ^ k;
    k = (k + KEY_STEP) & 0xff;
  }
  return out;
}

/** 세이브 파일을 상태 블록으로 되돌린다. 원작처럼 체크섬 칸은 0으로 비운다. */
// vmv2.exe 0x00441546
export function decodeSaveFile(file: Uint8Array): Uint8Array<ArrayBuffer> {
  checkSize(file);
  const out = new Uint8Array(file);
  let k = FIRST_KEY;
  for (let i = 0; i < out.length; i++) {
    out[i] = (swapNibbles(out[i] ^ k) - k) & 0xff;
    k = (k + KEY_STEP) & 0xff;
  }
  const view = new DataView(out.buffer);
  const stored = view.getUint32(CHECKSUM_OFFSET, true);
  view.setUint32(CHECKSUM_OFFSET, 0, true);
  if (byteSum(out) !== stored) throw new Error('세이브 체크섬이 맞지 않습니다');
  return out;
}
