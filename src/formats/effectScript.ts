// 연출 스크립트(DATA12 항목, vmv2.exe 해석기 0x414939). i32 명령 워드가 점프 없이 앞으로만 이어지고 0x31에서 끝난다.
// 규칙에 쓰는 것은 타격 명령뿐이다: 0x2c 나머지 몫 전부, 0x2d n 몫 n/10(인자는 둘째 워드), 0x2e·0x2f 대상 둘레 거리 1·2 칸,
// 0x2b 행동 종류별 특수 효과(0x403aaa: 물높이 단계, Bless).
// 공격 연출(0x413852)은 행동 주체 유닛 +0x07 번 항목을 쓴다: 마스터는 마스터 번호, 네이티얼은 종류 + 0x1a(0x40fc66, 0x40f910).
export type Hit =
  | { readonly kind: 'part'; readonly tenths: number }
  | { readonly kind: 'rest' }
  | { readonly kind: 'ring'; readonly distance: number }
  | { readonly kind: 'special' };

const END = 0x31;
const LAST_OP = 0x34;
/** 명령마다 읽는 워드 수(적지 않은 명령은 1) */
const WORDS: Readonly<Record<number, number>> = {
  0x1c: 2, 0x1d: 2, 0x1e: 2, 0x1f: 2, 0x20: 4, 0x21: 4, 0x22: 2, 0x24: 2, 0x27: 6, 0x28: 6, 0x29: 6, 0x2a: 8, 0x2d: 3, 0x33: 3, 0x34: 2,
};
export const NATIAL_SCRIPT_BASE = 0x1a;

/** 끝 명령 0x31까지의 워드 수. 명령 길이 표로 건너뛰므로 인자 워드의 0x31은 끝이 아니다 */
export function scriptLength(words: Int32Array): number {
  for (let at = 0; at < words.length; at += WORDS[words[at]] ?? 1) if (words[at] === END) return at + 1;
  throw new Error('연출 스크립트가 끝나지 않습니다(0x31 없음)');
}

export function readHits(script: Uint8Array): Hit[] {
  const v = new DataView(script.buffer, script.byteOffset, script.byteLength);
  const hits: Hit[] = [];
  for (let at = 0; at + 4 <= script.length; ) {
    const op = v.getInt32(at, true);
    if (op === END) return hits;
    if (op < 0 || op > LAST_OP || op === 0x12 || op === 0x13) throw new Error(`연출 스크립트에 모르는 명령 0x${op.toString(16)}이 있습니다(위치 ${at})`);
    if (at + 4 * (WORDS[op] ?? 1) > script.length) break; // 인자 워드가 잘림 → 아래에서 끝이 없다고 알린다
    if (op === 0x2b) hits.push({ kind: 'special' });
    else if (op === 0x2c) hits.push({ kind: 'rest' });
    else if (op === 0x2d) hits.push({ kind: 'part', tenths: v.getInt32(at + 4, true) });
    else if (op === 0x2e || op === 0x2f) hits.push({ kind: 'ring', distance: op - 0x2d });
    at += 4 * (WORDS[op] ?? 1);
  }
  throw new Error('연출 스크립트가 끝나지 않습니다(0x31 없음)');
}
