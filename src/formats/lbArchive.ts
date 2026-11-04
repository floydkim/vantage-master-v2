// 팔콤 "LB DAT" / "LB DIR" 아카이브.
// DAT: "LB DAT\x1a\0" + u32 슬롯 수 + u32 0 + u32 오프셋[슬롯 수].
//      마지막 실제 항목 다음 오프셋은 파일 크기(끝 표시)이고, 그 뒤 슬롯은 0이다.
// DIR: "LB DIR\x1a\0" + u32 슬롯 수 + u32 0 + 36바이트 항목[슬롯 수].
//      항목 = 이름 8바이트(공백 채움) + 확장자 4바이트("._FN") + u32×6. 순서는 DAT과 같다.
// vmv2.exe 0x004222ef: 오프셋 표에서 [시작, 다음 시작)을 읽는다.

const DAT_SIGNATURE = 'LB DAT\x1a\0';
const DIR_SIGNATURE = 'LB DIR\x1a\0';
const HEADER_SIZE = 16;
const DIR_ENTRY_SIZE = 36;

export interface LbDat {
  readonly entryCount: number;
  entry(index: number): Uint8Array;
}

function checkSignature(bytes: Uint8Array, signature: string): void {
  for (let i = 0; i < signature.length; i++) {
    if (bytes[i] !== signature.charCodeAt(i)) throw new Error(`${signature.slice(0, 6)} 시그니처가 아닙니다`);
  }
}

export function parseLbDat(bytes: Uint8Array): LbDat {
  checkSignature(bytes, DAT_SIGNATURE);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const slots = view.getUint32(8, true);
  const offsets: number[] = [];
  for (let i = 0; i < slots; i++) {
    const offset = view.getUint32(HEADER_SIZE + i * 4, true);
    offsets.push(offset);
    if (offset === bytes.length) break;
  }
  if (offsets.at(-1) !== bytes.length) throw new Error('LB DAT 끝 표시(파일 크기 오프셋)가 없습니다');
  const entryCount = offsets.length - 1;
  return {
    entryCount,
    entry(index) {
      if (!Number.isInteger(index) || index < 0 || index >= entryCount) {
        throw new RangeError(`항목 번호 범위 밖: ${index}`);
      }
      return bytes.subarray(offsets[index], offsets[index + 1]);
    },
  };
}

export function parseLbDir(bytes: Uint8Array): (string | null)[] {
  checkSignature(bytes, DIR_SIGNATURE);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const slots = view.getUint32(8, true);
  if (bytes.length < HEADER_SIZE + slots * DIR_ENTRY_SIZE) throw new Error('LB DIR이 잘렸습니다');
  const ascii = new TextDecoder('ascii');
  const names: (string | null)[] = [];
  for (let i = 0; i < slots; i++) {
    const at = HEADER_SIZE + i * DIR_ENTRY_SIZE;
    const name = ascii.decode(bytes.subarray(at, at + 8)).trimEnd();
    const ext = ascii.decode(bytes.subarray(at + 8, at + 12));
    names.push(name.startsWith('/') ? null : name + ext);
  }
  return names;
}
