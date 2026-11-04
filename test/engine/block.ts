import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

/** test/golden/<name>.json의 경우 목록 */
export function readGolden<T>(name: string): readonly T[] {
  return JSON.parse(readFileSync(new URL(`../golden/${name}.json`, import.meta.url), 'utf8')).cases;
}

/** 오라클이 zlib + base64로 담은 상태 블록 */
export const inflateBlock = (encoded: string): Uint8Array => new Uint8Array(inflateSync(Buffer.from(encoded, 'base64')));

// 비교에서 빼는 바이트 [시작, 끝): 진영 상태 +0x14(진영 마스터 유닛 객체의 실행 중 주소, 2진영)와 창·메뉴 구간 +0x268~+0x2d3(③ UI 몫, re/state-map.md)
const MASKED: readonly (readonly [number, number])[] = [[0xa00, 0xa04], [0xa18, 0xa1c], [0x268, 0x2d4]];

/** 두 블록에서 다른 바이트(가린 구간 제외)를 "+오프셋: 우리 ≠ 원작"으로 */
export const blockDifferences = (ours: Uint8Array, original: Uint8Array): string[] =>
  [...ours.keys()]
    .filter((i) => ours[i] !== original[i] && !MASKED.some(([start, end]) => i >= start && i < end))
    .map((i) => `+0x${i.toString(16)}: ${ours[i]} ≠ ${original[i]}`);
