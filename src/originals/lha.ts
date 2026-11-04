// LHA 아카이브(팔콤 VMOnline.exe 자체 압축 해제 파일 안). 머리 수준 2, 방식 -lh0-(저장)·-lh5-(사전 8KB 정적 허프만)·-lhd-(폴더)만 쓴다(2026-11-02 확인)

export interface LhaEntry {
  readonly path: string;
  readonly data: Uint8Array;
}

const ascii = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n));

/** 자체 압축 해제 exe(또는 .lzh)에서 파일들을 푼다. 폴더 항목은 건너뛰고, 경로 구분자는 '/'. 모르는 방식·머리·CRC 불일치는 던진다 */
export function readLha(bytes: Uint8Array): LhaEntry[] {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = -1;
  for (let i = 2; i + 5 <= bytes.length; i++) {
    if (bytes[i] === 0x2d && bytes[i + 1] === 0x6c && bytes[i + 2] === 0x68 && bytes[i + 4] === 0x2d && bytes[i - 2] !== 0) {
      at = i - 2;
      break;
    }
  }
  if (at < 0) throw new Error('LHA 아카이브가 없습니다');
  const out: LhaEntry[] = [];
  while (at + 2 <= bytes.length && v.getUint16(at, true) !== 0) {
    const size = v.getUint16(at, true);
    const method = ascii(bytes, at + 2, 5);
    if (bytes[at + 20] !== 2) throw new Error(`LHA 머리 수준 ${bytes[at + 20]}은 읽지 않습니다`);
    const packed = v.getUint32(at + 7, true);
    const length = v.getUint32(at + 11, true);
    const crc = v.getUint16(at + 21, true);
    let name = '';
    let dir = '';
    // 확장 머리: [종류 1][자료][다음 크기 u16], 크기는 셋을 합한 것
    for (let p = at + 26, n = v.getUint16(at + 24, true); n; ) {
      const data = bytes.subarray(p + 1, p + n - 2);
      if (bytes[p] === 1) name = String.fromCharCode(...data);
      else if (bytes[p] === 2) dir = String.fromCharCode(...data.map((c) => (c === 0xff ? 0x2f : c)));
      p += n;
      n = v.getUint16(p - 2, true);
    }
    const body = bytes.subarray(at + size, at + size + packed);
    at += size + packed;
    if (method === '-lhd-') continue;
    const data = method === '-lh0-' ? body.slice() : method === '-lh5-' ? lh5(body, length) : null;
    if (!data) throw new Error(`LHA 방식 ${method}은 풀지 않습니다`);
    if (crc16(data) !== crc) throw new Error(`${dir}${name}의 CRC가 맞지 않습니다`);
    out.push({ path: (dir && !dir.endsWith('/') ? `${dir}/` : dir) + name, data });
  }
  return out;
}

/** CRC-16/ARC(다항식 0xA001, 처음 0) */
function crc16(data: Uint8Array): number {
  let crc = 0;
  for (const b of data) {
    crc ^= b;
    for (let k = 0; k < 8; k++) crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
  }
  return crc;
}

const NC = 510; // 글자 256 + 길이 254(3~256)
const NP = 14; // 사전 8KB: 거리 비트 수 0~13
const NT = 19;
const CBIT = 9;
const PBIT = 4;
const TBIT = 5;

/** -lh5-: 블록마다 크기 16비트, 길이 표(NT)·글자·길이 표(NC)·거리 표(NP) 뒤 그만큼의 부호(ar002 알고리즘) */
function lh5(src: Uint8Array, length: number): Uint8Array {
  const out = new Uint8Array(length);
  let read = 0;
  let bitbuf = 0;
  let sub = 0;
  let count = 0;
  const fill = (n: number) => {
    bitbuf = (bitbuf << n) & 0xffff;
    while (n > count) {
      n -= count;
      bitbuf |= (sub << n) & 0xffff;
      sub = read < src.length ? src[read++] : 0;
      count = 8;
    }
    count -= n;
    bitbuf |= sub >> count;
  };
  const bits = (n: number) => {
    const x = bitbuf >> (16 - n);
    fill(n);
    return x;
  };
  fill(16);
  const left = new Uint16Array(2 * NC - 1);
  const right = new Uint16Array(2 * NC - 1);
  const cLen = new Uint8Array(NC);
  const cTable = new Uint16Array(4096);
  const ptLen = new Uint8Array(NT);
  const ptTable = new Uint16Array(256);

  const makeTable = (nchar: number, bitlen: Uint8Array, tablebits: number, table: Uint16Array) => {
    const count = new Array<number>(17).fill(0);
    const weight = new Array<number>(17).fill(0);
    const start = new Array<number>(18).fill(0);
    for (let i = 0; i < nchar; i++) count[bitlen[i]]++;
    for (let i = 1; i <= 16; i++) start[i + 1] = start[i] + (count[i] << (16 - i));
    if (start[17] !== 1 << 16) throw new Error('LHA 허프만 표가 깨졌습니다');
    const jut = 16 - tablebits;
    for (let i = 1; i <= tablebits; i++) {
      start[i] >>= jut;
      weight[i] = 1 << (tablebits - i);
    }
    for (let i = tablebits + 1; i <= 16; i++) weight[i] = 1 << (16 - i);
    for (let i = start[tablebits + 1] >> jut; i < 1 << tablebits; i++) table[i] = 0;
    let avail = nchar;
    const mask = 1 << (15 - tablebits);
    for (let ch = 0; ch < nchar; ch++) {
      const len = bitlen[ch];
      if (!len) continue;
      const next = start[len] + weight[len];
      if (len <= tablebits) for (let i = start[len]; i < next; i++) table[i] = ch;
      else {
        // 표에 넘치는 부호는 left·right 나무로
        let k = start[len];
        let arr = table;
        let idx = k >> jut;
        for (let i = len - tablebits; i; i--) {
          if (arr[idx] === 0) {
            left[avail] = right[avail] = 0;
            arr[idx] = avail++;
          }
          const node = arr[idx];
          arr = k & mask ? right : left;
          idx = node;
          k <<= 1;
        }
        arr[idx] = ch;
      }
      start[len] = next;
    }
  };
  const readPtLen = (nn: number, nbit: number, special: number) => {
    const n = bits(nbit);
    if (n === 0) {
      const c = bits(nbit);
      ptLen.fill(0, 0, nn);
      ptTable.fill(c);
      return;
    }
    let i = 0;
    while (i < n) {
      let c = bitbuf >> 13;
      if (c === 7) for (let m = 1 << 12; m & bitbuf; m >>= 1) c++;
      fill(c < 7 ? 3 : c - 3);
      ptLen[i++] = c;
      if (i === special) for (let z = bits(2); z > 0; z--) ptLen[i++] = 0;
    }
    ptLen.fill(0, i, nn);
    makeTable(nn, ptLen, 8, ptTable);
  };
  const readCLen = () => {
    const n = bits(CBIT);
    if (n === 0) {
      const c = bits(CBIT);
      cLen.fill(0);
      cTable.fill(c);
      return;
    }
    let i = 0;
    while (i < n) {
      let c = ptTable[bitbuf >> 8];
      for (let m = 1 << 7; c >= NT; m >>= 1) c = bitbuf & m ? right[c] : left[c];
      fill(ptLen[c]);
      if (c <= 2) {
        let z = c === 0 ? 1 : c === 1 ? bits(4) + 3 : bits(CBIT) + 20;
        while (z-- > 0) cLen[i++] = 0;
      } else cLen[i++] = c - 2;
    }
    cLen.fill(0, i);
    makeTable(NC, cLen, 12, cTable);
  };
  let pos = 0;
  while (pos < length) {
    let block = bits(16);
    if (!block) throw new Error('LHA 자료가 깨졌거나 잘렸습니다'); // 잘린 자료는 0으로 채워져 블록 크기 0: 그대로 두면 끝없이 돈다
    readPtLen(NT, TBIT, 3);
    readCLen();
    readPtLen(NP, PBIT, -1);
    for (; block > 0 && pos < length; block--) {
      let c = cTable[bitbuf >> 4];
      for (let m = 1 << 3; c >= NC; m >>= 1) c = bitbuf & m ? right[c] : left[c];
      fill(cLen[c]);
      if (c < 256) {
        out[pos++] = c;
        continue;
      }
      let p = ptTable[bitbuf >> 8];
      for (let m = 1 << 7; p >= NP; m >>= 1) p = bitbuf & m ? right[p] : left[p];
      fill(ptLen[p]);
      if (p) p = (1 << (p - 1)) + bits(p - 1);
      for (let len = c - 256 + 3; len > 0 && pos < length; len--, pos++) out[pos] = out[pos - p - 1];
    }
  }
  return out;
}
