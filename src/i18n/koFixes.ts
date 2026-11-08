// 한국어판 오역 보정(설계 docs/superpowers/specs/2026-11-05-korean-fixes-design.md §6). 표의 항목은 원래 글(CP949 바이트)의 해시와
// 짧은 정발판 조각(from)·고친 글(to). from이 없으면 줄 전체를 to로. 해시가 맞지 않는 글은 그대로 둔다
import { cp949 } from './hangul.ts';
import table from './koFixes.json';

interface Fix {
  readonly sha: string;
  readonly from?: string;
  readonly to: string;
}

const fixes = new Map<string, Fix[]>();
for (const f of table as readonly Fix[]) fixes.set(f.sha, [...(fixes.get(f.sha) ?? []), f]);

/** 바이트 문자열(글자 = 바이트)의 보정 글. 표에 없으면 그대로 */
export function fixLine(s: string): string {
  const found = fixes.get(sha16(Uint8Array.from(s, (c) => c.charCodeAt(0))));
  return found ? found.reduce((t, f) => (f.from === undefined ? cp949(f.to) : replaceChars(t, cp949(f.from), cp949(f.to))), s) : s;
}

/** from을 모두 to로 바꾸되 글자 경계(0x80 이상이면 2바이트 글자)에서만 찾는다. 바이트로 찾으면 앞 글자 둘째 바이트와 다음 글자 첫 바이트가 붙어 맞을 수 있다 */
function replaceChars(t: string, from: string, to: string): string {
  let out = '';
  for (let i = 0; i < t.length; ) {
    if (t.startsWith(from, i)) {
      out += to;
      i += from.length;
    } else {
      const n = t.charCodeAt(i) >= 0x80 ? 2 : 1;
      out += t.slice(i, i + n);
      i += n;
    }
  }
  return out;
}

const K = Uint32Array.from(
  '428a2f98 71374491 b5c0fbcf e9b5dba5 3956c25b 59f111f1 923f82a4 ab1c5ed5 d807aa98 12835b01 243185be 550c7dc3 72be5d74 80deb1fe 9bdc06a7 c19bf174 e49b69c1 efbe4786 0fc19dc6 240ca1cc 2de92c6f 4a7484aa 5cb0a9dc 76f988da 983e5152 a831c66d b00327c8 bf597fc7 c6e00bf3 d5a79147 06ca6351 14292967 27b70a85 2e1b2138 4d2c6dfc 53380d13 650a7354 766a0abb 81c2c92e 92722c85 a2bfe8a1 a81a664b c24b8b70 c76c51a3 d192e819 d6990624 f40e3585 106aa070 19a4c116 1e376c08 2748774c 34b0bcb5 391c0cb3 4ed8aa4a 5b9cca4f 682e6ff3 748f82ee 78a5636f 84c87814 8cc70208 90befffa a4506ceb bef9a3f7 c67178f2'
    .split(' ')
    .map((h) => parseInt(h, 16)),
);

/** SHA-256 16진 앞 16자. 그리는 자리에서 바로 써야 해 동기로 구현했다(브라우저 crypto.subtle은 비동기) */
export function sha16(bytes: Uint8Array): string {
  const n = Math.ceil((bytes.length + 9) / 64) * 64;
  const m = new Uint8Array(n);
  m.set(bytes);
  m[bytes.length] = 0x80;
  const v = new DataView(m.buffer);
  v.setUint32(n - 8, Math.floor(bytes.length / 0x20000000));
  v.setUint32(n - 4, (bytes.length * 8) >>> 0);
  const h = Uint32Array.of(0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19);
  const w = new Uint32Array(64);
  const rotr = (x: number, r: number) => (x >>> r) | (x << (32 - r));
  for (let o = 0; o < n; o += 64) {
    for (let i = 0; i < 16; i++) w[i] = v.getUint32(o + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = w[i - 16] + s0 + w[i - 7] + s1;
    }
    let [a, b, c, d, e, f, g, k] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (k + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      [k, g, f, e, d, c, b, a] = [g, f, e, (d + t1) | 0, c, b, a, (t1 + t2) | 0];
    }
    [a, b, c, d, e, f, g, k].forEach((x, i) => (h[i] += x));
  }
  return [h[0], h[1]].map((x) => x.toString(16).padStart(8, '0')).join('');
}
