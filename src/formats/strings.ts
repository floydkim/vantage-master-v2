// 바이너리에서 사람이 읽을 수 있는 문자열을 찾는다. ASCII와 Shift-JIS(cp932) 2바이트·반각 가나를 인정한다.

const sjis = new TextDecoder('shift_jis');

export interface FoundString {
  readonly offset: number;
  readonly text: string;
}

export function extractStrings(bytes: Uint8Array, minChars = 4): FoundString[] {
  const found: FoundString[] = [];
  let start = -1;
  let chars = 0;
  const flush = (end: number): void => {
    if (start >= 0 && chars >= minChars) found.push({ offset: start, text: sjis.decode(bytes.subarray(start, end)) });
    start = -1;
    chars = 0;
  };
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    const t = bytes[i + 1];
    const isLead = (b >= 0x81 && b <= 0x9f) || (b >= 0xe0 && b <= 0xef);
    const isPair = isLead && t !== undefined && ((t >= 0x40 && t <= 0x7e) || (t >= 0x80 && t <= 0xfc));
    const isSingle = (b >= 0x20 && b <= 0x7e) || (b >= 0xa1 && b <= 0xdf);
    if (isPair || isSingle) {
      if (start < 0) start = i;
      chars++;
      i += isPair ? 2 : 1;
    } else {
      flush(i);
      i++;
    }
  }
  flush(bytes.length);
  return found;
}
