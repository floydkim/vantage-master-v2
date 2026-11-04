import { useEffect, useRef } from 'react';
import { decodeMsVideo1, readAvi } from '../../formats/avi.ts';
import { originalBytes } from '../../originals/source.ts';
import type { Point } from '../frame/layout.ts';

/** RGB555 → RGBA(5비트를 8비트로: 위 비트를 아래에 되풀이) */
function toRgba(frame: Uint16Array, out: Uint8ClampedArray): void {
  for (let i = 0; i < frame.length; i++) {
    const c = frame[i];
    const r = (c >> 10) & 31;
    const g = (c >> 5) & 31;
    const b = c & 31;
    out[i * 4] = (r << 3) | (r >> 2);
    out[i * 4 + 1] = (g << 3) | (g >> 2);
    out[i * 4 + 2] = (b << 3) | (b >> 2);
    out[i * 4 + 3] = 255;
  }
}

/**
 * 오프닝 FALCOM.AVI(0x4263cd MCIWnd, 320 × 240, 20fps, 소리 없음)를 원본에서 읽어 풀며 1:1로 그린다(Microsoft Video 1, src/formats/avi.ts).
 * 첫 프레임에 onStart(BGM 0, 0x425fcd), 마지막 프레임이 제 시간을 다 보인 뒤 onEnd. 파일이 없거나 풀 수 없으면 바로 onEnd(원작의 AVI 열기 실패처럼)
 */
export function OpeningMovie({ at, onStart, onEnd }: { readonly at: Point; readonly onStart: () => void; readonly onEnd: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const start = useRef(onStart);
  start.current = onStart;
  const end = useRef(onEnd);
  end.current = onEnd;
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    originalBytes('VMO_WIN/FALCOM.AVI')
      .then((bytes) => {
        if (!live) return;
        const avi = readAvi(bytes);
        const c = canvas.current;
        const g = c?.getContext('2d');
        if (!c || !g || !avi.frames.length) return end.current();
        c.width = avi.width;
        c.height = avi.height;
        const frame = new Uint16Array(avi.width * avi.height);
        const image = new ImageData(avi.width, avi.height);
        const t0 = performance.now();
        let shown = 0;
        // 프레임 k는 t0 + k × 50ms에(늦은 틱은 밀린 프레임을 풀어 따라잡는다)
        const tick = () => {
          if (!live) return;
          const due = Math.min(avi.frames.length, Math.floor((performance.now() - t0) / avi.frameMs) + 1);
          if (due > shown) {
            for (; shown < due; shown++) decodeMsVideo1(avi.frames[shown], frame, avi.width, avi.height);
            toRgba(frame, image.data);
            g.putImageData(image, 0, 0);
          }
          const last = shown >= avi.frames.length;
          timer = setTimeout(() => (last ? live && end.current() : tick()), t0 + (last ? avi.frames.length : shown) * avi.frameMs - performance.now());
        };
        start.current();
        tick();
      })
      .catch(() => live && end.current());
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, []);
  return <canvas ref={canvas} width={320} height={240} style={{ position: 'absolute', left: at.x, top: at.y }} />;
}
