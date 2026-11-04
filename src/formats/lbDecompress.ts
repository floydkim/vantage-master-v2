// 팔콤 LB 압축 해제.
// 데이터는 블록의 연속이다: u16 블록 크기 + 본문 + u8 계속 여부(0이면 끝).
// 본문 첫 바이트가 0이면 모드 B(비트 플래그 LZ), 아니면 모드 A(바이트 토큰).

interface Reader {
  readonly src: Uint8Array;
  pos: number;
  bits: number;
  bitCount: number;
}

interface Output {
  buf: Uint8Array<ArrayBuffer>;
  len: number;
}

function readByte(r: Reader): number {
  if (r.pos >= r.src.length) throw new RangeError('압축 데이터가 잘렸습니다');
  return r.src[r.pos++];
}

function peekByte(r: Reader): number {
  if (r.pos >= r.src.length) throw new RangeError('압축 데이터가 잘렸습니다');
  return r.src[r.pos];
}

// vmv2.exe 0x0044d3cf: 비트가 떨어지면 그 자리에서 u16 LE를 읽어 채운다. 낮은 비트부터 꺼낸다.
function readBit(r: Reader): number {
  if (r.bitCount === 0) {
    r.bits = readByte(r) | (readByte(r) << 8);
    r.bitCount = 16;
  }
  const bit = r.bits & 1;
  r.bits >>= 1;
  r.bitCount--;
  return bit;
}

// vmv2.exe 0x0044d453: n비트를 먼저 읽은 비트가 상위가 되도록 모은다.
function readBits(r: Reader, n: number): number {
  let v = 0;
  for (let i = 0; i < n; i++) v = (v << 1) | readBit(r);
  return v;
}

function push(o: Output, value: number): void {
  if (o.len === o.buf.length) {
    const bigger = new Uint8Array(o.buf.length * 2);
    bigger.set(o.buf);
    o.buf = bigger;
  }
  o.buf[o.len++] = value;
}

function copyBack(o: Output, distance: number, count: number): void {
  if (distance <= 0 || distance > o.len) throw new RangeError(`잘못된 역참조 거리: ${distance}`);
  for (let i = 0; i < count; i++) push(o, o.buf[o.len - distance]);
}

function fill(o: Output, value: number, count: number): void {
  for (let i = 0; i < count; i++) push(o, value);
}

// vmv2.exe 0x0044ca71: 소비한 바이트 수가 블록 크기(크기 필드 2바이트 포함)와 같아지면 끝.
function decodeModeA(r: Reader, o: Output, blockSize: number): void {
  let used = 2;
  const take = (): number => {
    used++;
    return readByte(r);
  };
  while (used !== blockSize) {
    if (used > blockSize) throw new RangeError('모드 A 블록 크기를 넘었습니다');
    const b = take();
    if (b & 0x80) {
      // 역참조: 거리 13비트, 길이 2비트+4. 바로 뒤의 0x60~0x7f 바이트는 같은 거리에서 이어서 복사한다.
      const distance = ((b & 0x1f) << 8) | take();
      copyBack(o, distance, ((b >> 5) & 3) + 4);
      while (used !== blockSize && peekByte(r) >> 5 === 3) copyBack(o, distance, take() & 0x1f);
    } else if (b & 0x40) {
      // 반복: 0x10 비트가 서 있으면 개수 12비트, 아니면 4비트. 개수+4번 채운다.
      const count = b & 0x10 ? ((b & 0x0f) << 8) | take() : b & 0x0f;
      fill(o, take(), count + 4);
    } else {
      // 리터럴: 0x20 비트가 서 있으면 개수 13비트, 아니면 5비트.
      const count = b & 0x20 ? ((b & 0x1f) << 8) | take() : b & 0x1f;
      for (let i = 0; i < count; i++) push(o, take());
    }
  }
}

// vmv2.exe 0x0044d283: 앞에서부터 1비트가 나오는 위치로 길이를 정한다.
function readLength(r: Reader): number {
  if (readBit(r)) return 2;
  if (readBit(r)) return 3;
  if (readBit(r)) return 4;
  if (readBit(r)) return 5;
  if (readBit(r)) return readBits(r, 3) + 6;
  return readByte(r) + 14;
}

// vmv2.exe 0x0044cff5: 0x00과 첫 플래그 바이트(8비트) 뒤로 비트와 바이트가 섞여 나온다.
// 플래그 0 = 리터럴. 1 다음 0 = 거리 8비트, 1 다음 1 = 거리 13비트(0이면 끝, 1이면 반복).
function decodeModeB(r: Reader, o: Output): void {
  readByte(r);
  r.bits = readByte(r);
  r.bitCount = 8;
  for (;;) {
    if (!readBit(r)) {
      push(o, readByte(r));
      continue;
    }
    let distance: number;
    if (!readBit(r)) {
      distance = readByte(r);
    } else {
      distance = (readBits(r, 5) << 8) | readByte(r);
      if (distance === 0) return;
      if (distance === 1) {
        const count = readBit(r) ? (readBits(r, 4) << 8) | readByte(r) : readBits(r, 4);
        fill(o, readByte(r), count + 14);
        continue;
      }
    }
    copyBack(o, distance, readLength(r));
  }
}

// vmv2.exe 0x0044c970
export function lbDecompress(src: Uint8Array): Uint8Array<ArrayBuffer> {
  const r: Reader = { src, pos: 0, bits: 0, bitCount: 0 };
  const o: Output = { buf: new Uint8Array(Math.max(1024, src.length * 4)), len: 0 };
  do {
    const blockSize = readByte(r) | (readByte(r) << 8);
    if (peekByte(r) === 0) decodeModeB(r, o);
    else decodeModeA(r, o, blockSize);
  } while (readByte(r) !== 0);
  return o.buf.slice(0, o.len);
}
