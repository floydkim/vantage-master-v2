// 마우스 커서(원작 0x44dd9f가 LoadCursorA로 읽음). 전장(0x403d04)·Master making(0x42928b)이 WM_SETCURSOR에서 고른다
import type { ExeImage } from '../../formats/exeImage.ts';
import { readCursor } from '../../formats/cursors.ts';

/** 방향 0~5의 커서(0x503df4[방향]) */
export const DIRECTION_CURSORS = [0x69, 0x6a, 0x6c, 0x6b, 0x6d, 0x6e] as const;
/** 효과 범위·누르면 넘어감 커서(0x503e0c) */
export const TARGET_CURSOR = 0x75;

export interface CursorStyles {
  /** CSS cursor 값: 방향 0~5, 대상 */
  readonly directions: readonly string[];
  readonly target: string;
}

const cache = new WeakMap<ExeImage, CursorStyles>();

/** 커서를 CSS cursor 값(PNG 데이터 URL과 핫스폿, 못 쓰면 화살표)으로 */
export function cursorStyles(exe: ExeImage): CursorStyles {
  const hit = cache.get(exe);
  if (hit) return hit;
  const css = (id: number) => {
    const { hotspot, image } = readCursor(exe, id);
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    canvas.getContext('2d')!.putImageData(new ImageData(image.rgba, image.width, image.height), 0, 0);
    return `url(${canvas.toDataURL()}) ${hotspot.x} ${hotspot.y}, default`;
  };
  const styles = { directions: DIRECTION_CURSORS.map(css), target: css(TARGET_CURSOR) };
  cache.set(exe, styles);
  return styles;
}

/** 모양(방향 0~5, 'target', null = 화살표)의 CSS cursor 값 */
export const cursorStyle = (styles: CursorStyles, shape: number | 'target' | null): string => (shape === null ? '' : shape === 'target' ? styles.target : styles.directions[shape]);
