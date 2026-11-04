import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { readScenarioData, type ScenarioMode } from '../../engine/scenario.ts';
import type { SideRecord } from '../../engine/state.ts';
import { readDialog } from '../../formats/dialogs.ts';
import { readMasterTable } from '../../formats/masterTable.ts';
import type { Original } from '../battle/original.ts';
import { toRgba } from '../battle/screen.ts';
import type { Sound } from '../battle/sound.ts';
import { cursorStyle, cursorStyles } from '../battle/cursors.ts';
import { ScreenLayer } from '../frame/Desktop.tsx';
import { DialogBox } from '../frame/DialogBox.tsx';
import { dialogLayout } from '../frame/dialogLayout.ts';
import { WIN98 } from '../frame/frame.ts';
import { makeMasterRect, outer, type Rect, type Size } from '../frame/layout.ts';
import { MdiChild } from '../frame/MdiChild.tsx';
import { loadTitleArt } from '../title/titleArt.ts';
import { nameDialogAt } from '../world/masterEdit.ts';
import { MAKE_H, MAKE_W, MasterMaking, readMakeMasterData, titleBase } from './makeMaster.ts';

const TICK_MS = 48;
const TITLE = 0x468b40; // "Master making"
const NAME_DIALOG = 0x7c; // "Input Master Name"
const NAME_EDIT = 0x8fc;
const IDOK = 1;

/**
 * Master making 창(장면 2, 0x426d90): 프레임 클라이언트 가운데 608 × 448 MDI 자식(대화 상자 테두리, 0x429030이 최대·최소화·크기 조절을 뗌).
 * 48ms 콜백(0x426ff9)을 돌리고, 이름 대화 상자 0x7c(모달리스, 0x42967b)를 띄운다. 끝나면 onDone(우리 진영, 난수) → 월드(0x45102d),
 * 창 닫기(WM_CLOSE → 0x426f81)는 타이틀(0x425fa0)
 */
export function MasterMakingWindow({
  original,
  sound,
  icon,
  client,
  mode,
  seed,
  paused,
  close,
  onMusic,
  onDone,
  onTitle,
}: {
  readonly original: Original;
  readonly sound: Sound;
  readonly icon: string;
  readonly client: Size;
  readonly mode: ScenarioMode;
  readonly seed: number;
  /** 프레임의 모달 대화 상자가 열려 있다: 48ms 콜백이 멈춘다 */
  readonly paused: boolean;
  /** Turn to Title(0x44e390 장면 2 → 0x426f81)을 누를 때마다 늘어난다 */
  readonly close: number;
  readonly onMusic: (track: number) => void;
  readonly onDone: (player: SideRecord, seed: number) => void;
  readonly onTitle: (seed: number) => void;
}) {
  const { exe, read } = original;
  const [machine] = useState(() => {
    const data = readMakeMasterData(exe, read, { masters: readMasterTable(exe), ...readScenarioData(exe) });
    return new MasterMaking(data, mode, seed, titleBase(loadTitleArt(exe, read).colors));
  });
  const nameDialog = useMemo(() => readDialog(exe, NAME_DIALOG), [exe]);
  const layer = useContext(ScreenLayer);
  const [rect, setRect] = useState<Rect>(() => makeMasterRect(client, WIN98));
  const [, redraw] = useState(0);
  const [name, setName] = useState<{ text: string; at: { x: number; y: number } } | null>(null);
  const clientEl = useRef<HTMLDivElement | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const done = useRef(false);
  const asked = useRef(false); // 이름 상자를 띄웠다(타이머 콜백이 상태를 늦게 본다)

  const after = () => {
    if (machine.closed && !done.current) {
      done.current = true;
      onDone(machine.player!, machine.seed);
      return;
    }
    if (machine.prompt !== null && !asked.current) {
      asked.current = true;
      // 0x429496: Master making 창의 가로 가운데, 위 끝이 창 높이의 7/8
      const r = clientEl.current?.getBoundingClientRect();
      const l = layer.element?.getBoundingClientRect();
      const x = (r?.left ?? 0) - (l?.left ?? 0) - WIN98.dlgFrame;
      const y = (r?.top ?? 0) - (l?.top ?? 0) - WIN98.caption - WIN98.dlgFrame;
      const size = outer(WIN98).makeMaster;
      const parent = { left: x, top: y, right: x + size.width, bottom: y + size.height };
      setName({ text: machine.prompt, at: nameDialogAt(parent, dialogLayout(nameDialog, WIN98).outer, layer.size) });
    }
    redraw((n) => n + 1);
  };
  const afterRef = useRef(after);
  afterRef.current = after; // 타이머는 첫 렌더에 걸리므로 최신 onDone·화면 크기를 보게

  useEffect(() => {
    if (import.meta.env.DEV) (window as unknown as { __vmv2Making?: MasterMaking }).__vmv2Making = machine; // 브라우저 확인용
    for (const track of machine.bgm) onMusic(track); // 0x42754c: BGM 6
    const id = setInterval(() => {
      if (pausedRef.current || done.current) return;
      machine.tick();
      afterRef.current();
    }, TICK_MS);
    return () => clearInterval(id);
  }, []);
  const closeAt = useRef(close);
  useEffect(() => {
    if (close === closeAt.current) return;
    done.current = true;
    onTitle(machine.seed);
  }, [close]);
  useEffect(() => {
    canvas.current?.getContext('2d')?.putImageData(new ImageData(toRgba(machine.image, machine.colors), MAKE_W, MAKE_H), 0, 0);
  });

  const point = (e: React.MouseEvent) => [e.nativeEvent.offsetX, e.nativeEvent.offsetY] as const;
  return (
    <>
      <MdiChild
        title={exe.cString(TITLE)}
        icon={icon}
        rect={rect}
        kind="fixed"
        active={name === null}
        z={1}
        metrics={WIN98}
        onActivate={() => {}}
        onRect={setRect}
        clientRef={(el) => (clientEl.current = el)}
        onClose={() => {
          done.current = true;
          onTitle(machine.seed); // 0x426f81 → 0x425fa0
        }}
      >
        <canvas
          ref={canvas}
          width={MAKE_W}
          height={MAKE_H}
          onMouseMove={(e) => {
            // WM_SETCURSOR(0x42928b): 입력 모드 2(+0x4e8, 누르면 넘어감)면 0x503e0c, 아니면 화살표
            e.currentTarget.style.cursor = cursorStyle(cursorStyles(exe), machine.input === 2 ? 'target' : null);
            const hover = machine.hover;
            machine.move(...point(e));
            if (machine.hover !== hover) {
              machine.repaint(); // 선택지 강조를 다음 프레임(96ms)까지 기다리지 않고 바로
              redraw((n) => n + 1);
            }
          }}
          onMouseDown={(e) => {
            if (e.button !== 0) return;
            for (const n of machine.click(...point(e))) sound.call(['ui', n]);
            after();
          }}
        />
      </MdiChild>
      {name &&
        layer.element &&
        createPortal(
        <DialogBox
          dialog={nameDialog}
          at={name.at}
          metrics={WIN98}
          values={{ texts: { [NAME_EDIT]: name.text } }}
          onCommand={(id, code, _index, text) => {
            if (id === NAME_EDIT && code === 'update') return setName({ ...name, text: text ?? '' });
            if (id !== IDOK) return; // 0x4295e9: Cancel(Esc)은 무시
            if (!machine.name(name.text)) return sound.call(['ui', 3]); // 0x42959e: 1~16바이트가 아니면 상자에 남는다
            sound.call(['ui', 1]);
            setName(null);
            after();
          }}
        />,
          layer.element,
        )}
    </>
  );
}
