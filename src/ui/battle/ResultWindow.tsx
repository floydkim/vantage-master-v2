import { useEffect, useMemo, useRef, useState } from 'react';
import type { GameState } from '../../engine/state.ts';
import type { Metrics } from '../frame/frame.ts';
import type { Rect, Size } from '../frame/layout.ts';
import { MdiChild } from '../frame/MdiChild.tsx';
import { drawResultPage, LAST_PAGE, RESULT_H, RESULT_W, type ResultArt, type ResultLevelUp, resultHit } from './resultWindow.ts';
import { toRgba } from './screen.ts';
import type { Sound } from './sound.ts';

const TITLE = 0x45f080; // "Battle results window"
const TICK_MS = 48;

/** vmv2.exe 0x00407d43: 바깥 = 608 × 420 + 대화 틀·캡션, MDI 클라이언트 가운데(x는 0 아래로 자르지 않음, y는 0 이상) */
export function resultRect(client: Size, m: Metrics): Rect {
  const w = RESULT_W + m.dlgFrame * 2;
  const h = RESULT_H + m.caption + m.dlgFrame * 2;
  const left = Math.trunc((client.width - w) / 2);
  const top = Math.max(0, Math.trunc((client.height - h) / 2));
  return { left, top, right: left + w, bottom: top + h };
}

/**
 * 결과 창(Battle results window, CBtlRepWnd): 시스템 메뉴가 없어 닫기 단추가 없다. 단추 깜빡임은 48ms 콜백(0x4083df) 두 번마다 프레임 + 1(0x408418),
 * 마우스 위는 노랑(0x40a91e), 누르면 소리 1과 쪽 넘기기(0x40a95c), 마지막 쪽의 END → onEnd(0x408034)
 */
export function ResultWindow({
  art,
  state,
  winner,
  levelUp,
  colors,
  client,
  metrics,
  sound,
  paused,
  onEnd,
}: {
  readonly art: ResultArt;
  readonly state: GameState;
  readonly winner: number;
  /** 시나리오에서 이기면 쪽 5(0x408447) */
  readonly levelUp: ResultLevelUp | null;
  readonly colors: Uint8Array;
  readonly client: Size;
  readonly metrics: Metrics;
  readonly sound: Sound;
  /** 모달 대화 상자(Customize·Sound) 동안 48ms 콜백(0x4083df)이 돌지 않는다 */
  readonly paused: boolean;
  readonly onEnd: () => void;
}) {
  const [rect, setRect] = useState(() => resultRect(client, metrics));
  const [page, setPage] = useState(0);
  const [hover, setHover] = useState(-1);
  const [frame, setFrame] = useState(0);
  const ticks = useRef(0);
  const stopped = useRef(paused);
  stopped.current = paused;
  useEffect(() => {
    const id = setInterval(() => {
      if (stopped.current || ++ticks.current < 2) return;
      ticks.current = 0;
      setFrame((f) => (f + 1) & 7);
    }, TICK_MS);
    return () => clearInterval(id);
  }, []);
  const image = useMemo(() => drawResultPage(art, state, winner, page, hover, frame, levelUp), [art, state, winner, page, hover, frame, levelUp]);
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    canvas.current?.getContext('2d')?.putImageData(new ImageData(toRgba(image, colors), RESULT_W, RESULT_H), 0, 0);
  }, [image, colors]);
  const at = (e: React.MouseEvent) => resultHit(e.nativeEvent.offsetX, e.nativeEvent.offsetY, page);
  return (
    <MdiChild title={art.text(TITLE)} icon="" kind="bare" rect={rect} active z={1} metrics={metrics} onActivate={() => {}} onRect={setRect}>
      <canvas
        ref={canvas}
        width={RESULT_W}
        height={RESULT_H}
        onMouseMove={(e) => setHover(at(e))}
        onMouseDown={(e) => {
          if (e.button !== 0) return;
          const hit = at(e);
          setHover(hit);
          if (hit < 0) return;
          sound.call(['ui', 1]);
          const next = page + (hit === 0 ? -1 : 1);
          if (next > (levelUp ? 5 : LAST_PAGE)) return onEnd();
          setPage(next);
          setHover(resultHit(e.nativeEvent.offsetX, e.nativeEvent.offsetY, next));
        }}
      />
    </MdiChild>
  );
}
