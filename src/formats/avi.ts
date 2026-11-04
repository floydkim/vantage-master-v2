// 오프닝 FALCOM.AVI(원작 0x4263cd MCIWnd): RIFF AVI, 비디오 하나(Microsoft Video 1 'CRAM', 16비트 RGB555, 320 × 240, 20fps, 소리 없음)

export interface Avi {
  readonly width: number;
  readonly height: number;
  /** 프레임 하나의 시간(avih 마이크로초 / 1000) */
  readonly frameMs: number;
  /** 비디오 칸(00dc·00db)의 자료, 차례대로. 0바이트 칸은 앞 프레임 그대로 */
  readonly frames: Uint8Array[];
}

const fourcc = (b: Uint8Array, at: number) => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);

export function readAvi(bytes: Uint8Array): Avi {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (fourcc(bytes, 0) !== 'RIFF' || fourcc(bytes, 8) !== 'AVI ') throw new Error('AVI 파일이 아닙니다');
  let frameMs = 0;
  let width = 0;
  let height = 0;
  const frames: Uint8Array[] = [];
  // 칸: [id 4][크기 u32][자료(짝수로 맞춤)]. LIST는 [LIST][크기][종류 4][칸들]
  const walk = (from: number, to: number) => {
    for (let at = from; at + 8 <= to; ) {
      const id = fourcc(bytes, at);
      const size = v.getUint32(at + 4, true);
      const body = at + 8;
      if (id === 'LIST') walk(body + 4, body + size);
      else if (id === 'avih') frameMs = v.getUint32(body, true) / 1000;
      else if (id === 'strf' && !width) {
        width = v.getInt32(body + 4, true);
        height = Math.abs(v.getInt32(body + 8, true));
        if (v.getUint16(body + 14, true) !== 16 || fourcc(bytes, body + 16).toLowerCase() !== 'cram') throw new Error('Microsoft Video 1(16비트)이 아닙니다');
      } else if (id === '00dc' || id === '00db') frames.push(bytes.subarray(body, body + size));
      at = body + size + (size & 1);
    }
  };
  walk(12, bytes.length);
  return { width, height, frameMs, frames };
}

/**
 * Microsoft Video 1 16비트 프레임 하나를 frame(위에서 아래 행, RGB555)에 덧그린다. 4 × 4 블록을 아래 블록 행부터, 블록 안은 아래 줄부터:
 * 두 바이트 a·b가 b & 0xfc == 0x84면 다음 (b − 0x84) × 256 + a 블록을 건너뜀(앞 프레임 그대로), b < 0x80이면 비트 16개(b·a)로 두 색(첫 색의 0x8000이 서면
 * 네 2 × 2 칸마다 두 색씩 여덟 색), 그 밖은 (b·a) 한 색. 비트가 1이면 색 0, 0이면 색 1
 */
export function decodeMsVideo1(chunk: Uint8Array, frame: Uint16Array, width: number, height: number): void {
  const wide = width >> 2;
  const high = height >> 2;
  let total = wide * high;
  let skip = 0;
  let at = 0;
  const u16 = () => {
    const x = chunk[at] | (chunk[at + 1] << 8);
    at += 2;
    return x;
  };
  const colors = new Uint16Array(8);
  for (let by = high; by > 0; by--) {
    let block = (by * 4 - 1) * width; // 그 블록 행의 맨 아래 줄
    for (let bx = wide; bx > 0; bx--, block += 4) {
      if (skip) {
        skip--;
        total--;
        continue;
      }
      if (at + 2 > chunk.length) return; // 짧은 칸: 남은 블록은 앞 프레임 그대로
      const a = chunk[at++];
      const b = chunk[at++];
      if (a === 0 && b === 0 && total === 0) return;
      total--;
      if ((b & 0xfc) === 0x84) {
        skip = ((b - 0x84) << 8) + a - 1;
        continue;
      }
      let p = block;
      if (b < 0x80) {
        let flags = (b << 8) | a;
        colors[0] = u16();
        colors[1] = u16();
        const eight = (colors[0] & 0x8000) !== 0;
        if (eight) for (let k = 2; k < 8; k++) colors[k] = u16();
        for (let y = 0; y < 4; y++, p -= width + 4) {
          for (let x = 0; x < 4; x++, flags >>= 1) frame[p++] = colors[(eight ? ((y & 2) << 1) + (x & 2) : 0) + ((flags & 1) ^ 1)];
        }
      } else {
        const c = (b << 8) | a;
        for (let y = 0; y < 4; y++, p -= width + 4) for (let x = 0; x < 4; x++) frame[p++] = c;
      }
    }
  }
}
