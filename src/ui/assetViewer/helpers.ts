export type AssetKind = 'palette' | 'font' | 'text' | 'wav' | 'image';

/** DIR 확장자와 내용으로 미리보기 종류를 고른다. 이름이 없는 DAT의 항목은 대부분 이미지다. */
export function guessKind(name: string | null, bytes: Uint8Array): AssetKind {
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) return 'wav'; // "RIFF"
  if (name?.endsWith('._PL')) return 'palette';
  if (name?.endsWith('._FN')) return 'font';
  if (name?.endsWith('._SC')) return 'text';
  return 'image';
}

export interface LayerRef {
  readonly dat: number;
  readonly entry: number;
  readonly start: number;
}

/** "0:1@10 0:2@50" → DATA00의 1번 항목을 10번 칸부터, 2번 항목을 50번 칸부터. */
export function parseLayerSpec(spec: string): LayerRef[] {
  return spec
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((part) => {
      const m = /^(\d+):(\d+)@(\d+)$/.exec(part);
      if (!m) throw new Error(`팔레트 지정 형식이 틀렸습니다: "${part}" (예: 0:1@10)`);
      const start = Number(m[3]);
      if (start > 255) throw new Error(`시작 칸은 0~255입니다: ${start}`);
      return { dat: Number(m[1]), entry: Number(m[2]), start };
    });
}

export function hexDump(bytes: Uint8Array, limit = 512): string {
  const end = Math.min(bytes.length, limit);
  const lines: string[] = [];
  for (let at = 0; at < end; at += 16) {
    const row = [...bytes.subarray(at, Math.min(at + 16, end))];
    const hex = row.map((b) => b.toString(16).padStart(2, '0')).join(' ');
    const ascii = row.map((b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.')).join('');
    lines.push(`${at.toString(16).padStart(6, '0')}  ${hex.padEnd(47)}  ${ascii}`);
  }
  return lines.join('\n');
}
