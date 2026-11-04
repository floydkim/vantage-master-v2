import { useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Original } from '../battle/original.ts';
import { toRgba } from '../battle/screen.ts';
import type { Sound } from '../battle/sound.ts';
import { ScreenLayer } from '../frame/Desktop.tsx';
import { SCENE_H, SCENE_START, SCENE_W, SceneEngine, type ScenePlayer } from './engine.ts';

const TICK_MS = 48;
const COUNTER_MS = 16; // 0x503dec: 16ms마다 1 줄어드는 카운터

/**
 * 장면 창(장면 6, 0x41becb): 화면 전체 팝업(0x43b210, 프레임·메뉴 줄을 덮음) 가운데 768 × 512 DIB. 48ms 콜백 0x41d843,
 * 16ms 카운터는 지난 시간만큼 줄인다(0x44e9b1, 늦으면 엔진이 스텝을 몰아 돈다). 보고서 쪽만 단추 마우스 위·누르기를 받는다.
 * 끝나면 onDone: 종류 0~5는 월드(0x4516f4), 엔딩은 타이틀(0x425fa0)
 */
export function SceneWindow({
  original,
  sound,
  kind,
  index = 0,
  player,
  base,
  paused,
  onMusic,
  onDone,
}: {
  readonly original: Original;
  readonly sound: Sound;
  /** 0x48341c: 0~5 장 사이 장면(DATA08), 6 엔딩 */
  readonly kind: number;
  /** 종류 6에서 처음 ED 번호(개발용: 1~0x1a 이어지는 ED, 0x1b 보고서). 0이면 마스터 ED */
  readonly index?: number;
  readonly player: ScenePlayer;
  /** 창 팔레트 0x4800e0의 지금 색(앞 장면이 남긴 색) */
  readonly base: Uint8Array;
  /** 프레임의 모달 대화 상자가 열려 있다: 콜백이 멈춘다 */
  readonly paused: boolean;
  readonly onMusic: (track: number) => void;
  readonly onDone: (next: 'world' | 'title') => void;
}) {
  const layer = useContext(ScreenLayer);
  const music = useRef(onMusic);
  music.current = onMusic;
  const [engine] = useState(() => {
    const e = new SceneEngine(original, kind, player, base, (track) => music.current(track));
    if (index > 0) {
      e.index = index - 1; // 0x41d7e8로 넘어간다
      e.finish();
    }
    return e;
  });
  const [, redraw] = useState(0);
  const canvas = useRef<HTMLCanvasElement>(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const done = useRef(onDone);
  done.current = onDone;
  const counter = useRef(SCENE_START);
  // 닫힌 뒤 틱·누르기가 또 와도 한 번만 알린다
  const finished = useRef(false);
  const finish = () => {
    if (finished.current || !engine.closed || !engine.next) return;
    finished.current = true;
    done.current(engine.next);
  };

  useEffect(() => {
    if (import.meta.env.DEV) (window as unknown as { __vmv2Scene?: SceneEngine }).__vmv2Scene = engine; // 브라우저 확인용
    let last = performance.now();
    const id = setInterval(() => {
      const n = Math.floor((performance.now() - last) / COUNTER_MS);
      last += n * COUNTER_MS;
      if (counter.current !== 0) counter.current = n < counter.current ? counter.current - n : 0; // 0x44e9b1
      if (pausedRef.current || engine.closed) return;
      engine.tick(counter.current);
      redraw((v) => v + 1);
      finish();
    }, TICK_MS);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    canvas.current?.getContext('2d')?.putImageData(new ImageData(toRgba(engine.image, engine.colors), SCENE_W, SCENE_H), 0, 0);
  });

  if (!layer.element) return null;
  const left = Math.trunc((layer.size.width - SCENE_W) / 2);
  const top = Math.trunc((layer.size.height - SCENE_H) / 2);
  const point = (e: React.PointerEvent) => [e.nativeEvent.offsetX, e.nativeEvent.offsetY] as const;
  return createPortal(
    <div className="scene-popup" style={{ position: 'absolute', inset: 0, background: '#000', zIndex: 100, overflow: 'hidden' }} onContextMenu={(e) => e.preventDefault()}>
      <canvas
        ref={canvas}
        width={SCENE_W}
        height={SCENE_H}
        style={{ position: 'absolute', left, top }}
        onPointerMove={(e) => {
          if (engine.move(...point(e))) redraw((v) => v + 1); // 보고서 단추 위가 바뀔 때만
        }}
        onPointerDown={(e) => {
          if (e.button !== 0 || pausedRef.current) return;
          for (const n of engine.click(...point(e))) sound.call(['ui', n]);
          redraw((v) => v + 1);
          finish();
        }}
      />
    </div>,
    layer.element,
  );
}
