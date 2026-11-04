import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ScenarioMode } from '../../engine/scenario.ts';
import { readDialog } from '../../formats/dialogs.ts';
import { ScreenLayer } from '../frame/Desktop.tsx';
import { DialogBox } from '../frame/DialogBox.tsx';
import { centerDialog, dialogLayout } from '../frame/dialogLayout.ts';
import { WIN98 } from '../frame/frame.ts';
import { IDNO, IDOK, IDYES, messageBox } from '../frame/messageBox.ts';
import { AUTOSAVE_FILE } from '../battle/continueData.ts';
import { autosaveBlock, continueRows, deleteSave, loadContinue } from '../battle/saveStore.ts';
import { SlotDialog } from '../battle/SlotDialog.tsx';
import { GameDataDialog } from '../battle/GameDataDialog.tsx';
import type { Sound } from '../battle/sound.ts';
import type { Original } from '../battle/original.ts';
import { dibColors } from '../battle/palette.ts';
import { toRgba } from '../battle/screen.ts';
import { Opening } from './opening/scenes.ts';
import { OpeningMovie } from './OpeningMovie.tsx';
import { aviOrigin, glintFrame, loadTitleArt, TITLE_H, TITLE_W, titleAction, titleHit, titleImage, titleOrigin } from './titleArt.ts';

const CONFIRM_TITLE = 0x472680;
const ERROR_TITLE = 0x4758cc;
const TRACE_QUESTION = 0x474264; // "Found trace of system closed \nduring battle.\nDo you wish to play this battle again?" (0x441fd3)
const FOUND_QUESTION = 0x465d70; // "Continue data found.\nThe continue data is erased when loaded.\nDo you wish to load the continue data?" (0x426a3a)
const READ_FAILED = 0x474244; // "Reading failed." (0x441cb3)
const LOAD_FAILED = 0x4742b8; // "Loading failed." (0x441fd3)

type Modal = 'trace' | 'found' | 'slots' | 'gameData' | 'level' | 'network' | 'readError' | 'loadError' | null;
const TICK_MS = 48;
const SKIP_MS = 100 + TICK_MS; // 건너뜀: MCIWnd 멈춤 알림(100ms 타이머) → 0x426c7c → 다음 48ms 틱에 메뉴
const COUNTER_MS = 16; // 0x503dec: 16ms마다 1 줄어드는 카운터(오프닝 시계)
const EASY = 0xbc5;
const NORMAL = 0xbc6;

/**
 * 타이틀 장면(장면 1, CMainMenuWnd 0x42608f: 프레임을 덮는 화면 전체 검은 팝업 + 768 × 512 그림). 해독 메모 notes_title.md.
 * askTrace면 먼저 자동 저장 SV080을 묻는다(WinMain 0x441fd3, 프레임 위). opening이면 FALCOM.AVI(0x425fcd) → 오프닝 애니메이션(0x426c54, opening/) → 타이틀,
 * 아니면 바로(0x425fa0). AVI·애니메이션 중 클릭은 건너뜀(0x426c7c).
 * 메뉴(0x426a3a, 모두 소리 1): Scenario(Select Level 0x83, 시나리오는 아직 없어 남음), Expert(소리만), Network(지원하지 않는다는 안내창), Free Battle, Load Data, Quit
 */
export function TitleScreen({
  original,
  sound,
  seed,
  onSeed,
  askTrace,
  onTraceDone,
  onFreeBattle,
  onScenario,
  onResume,
  onGameData,
  opening,
  onOpeningDone,
  onQuit,
  onMusic,
}: {
  readonly original: Original;
  readonly sound: Sound;
  readonly seed: number;
  /** 오프닝 애니메이션이 게임 난수를 썼다(2장 0x434553, 4번) */
  readonly onSeed: (seed: number) => void;
  readonly askTrace: boolean;
  readonly onTraceDone: () => void;
  readonly onFreeBattle: () => void;
  /** Scenario(Select Level 0 Easy·1 Normal → 0x450da0)·Expert(2, 0x450e35): Master making(0x426d90) */
  readonly onScenario: (mode: ScenarioMode) => void;
  readonly onResume: (block: Uint8Array, seed: number) => void;
  /** 게임 데이터를 읽었다(0x44198d): 월드 장면으로 */
  readonly onGameData: (block: Uint8Array) => void;
  /** 앱을 처음 열 때(0x425fcd): FALCOM.AVI를 먼저 튼다 */
  readonly opening: boolean;
  readonly onOpeningDone: () => void;
  /** Quit(0x4261f7 → DestroyWindow(프레임)) */
  readonly onQuit: () => void;
  /** BGM 곡: AVI와 함께 0(0x425fcd), 건너뜀·돌아옴 8(0x426c7c). AVI가 끝까지 돌면 0이 이어진다 */
  readonly onMusic: (track: number) => void;
}) {
  const { exe, read } = original;
  const layer = useContext(ScreenLayer);
  const [modal, setModal] = useState<Modal>(() => (askTrace && autosaveBlock() ? 'trace' : null));
  // 'trace': 프레임 위 질문(팝업 전), 'avi': 동영상(상태 0), 'opening': 오프닝 애니메이션(상태 1), 'skip': 건너뛴 뒤 메뉴가 뜨기 전(검정, 클릭 무시),
  // 'menu': 타이틀 그림과 메뉴(상태 2)
  const [phase, setPhase] = useState<'trace' | 'avi' | 'opening' | 'skip' | 'menu'>(() => (modal === 'trace' ? 'trace' : opening ? 'avi' : 'menu'));
  const afterTrace = () => setPhase(opening ? 'avi' : 'menu');
  const art = useMemo(() => loadTitleArt(exe, read), [exe, read]);
  const level = useMemo(() => readDialog(exe, 0x83), [exe]);
  const [hover, setHover] = useState(-1);
  // 48ms 콜백(0x426ca9): 반짝임. 메뉴 동안만 늘고(모달 상자 동안은 멈춤) 메뉴는 마운트마다 한 번 뜨므로 틱 0 = 메뉴가 뜬 때
  const [tick, setTick] = useState(0);
  const paused = useRef(false);
  paused.current = modal !== null || phase !== 'menu';
  useEffect(() => {
    const id = setInterval(() => !paused.current && setTick((t) => t + 1), TICK_MS);
    return () => clearInterval(id);
  }, []);
  const canvas = useRef<HTMLCanvasElement>(null);
  const glint = glintFrame(tick);
  // 마우스 위·반짝임 프레임이 바뀔 때만 다시 그린다(48ms마다 같은 768 × 512를 다시 칠하지 않게)
  useEffect(() => {
    if (phase !== 'menu') return;
    canvas.current?.getContext('2d')?.putImageData(new ImageData(toRgba(titleImage(art, hover, glint), art.colors), TITLE_W, TITLE_H), 0, 0);
  }, [phase, art, hover, glint]);
  const toMenu = () => {
    setPhase('menu');
    onOpeningDone();
  };
  // 상태 1(0x426c54 → 콜백 0x426ca9): 48ms마다 엔진 시계(0x43307e)를 돌려 DIB·색 표를 칠한다. 카운터는 지난 시간이라 늦게 온 틱은 그리지 않고 따라잡는다.
  // 엔진이 끝을 알리면(타이틀 장면 0x439d23) 메뉴(0x426235, BGM 0 그대로)
  const anim = useRef<Opening | null>(null);
  const leaveOpening = () => {
    const o = anim.current;
    anim.current = null;
    if (o && o.seed !== seed) onSeed(o.seed);
  };
  useEffect(() => {
    if (phase !== 'opening') return;
    const o = new Opening(exe, read, seed);
    anim.current = o;
    o.start();
    let last = performance.now();
    const id = setInterval(() => {
      if (anim.current !== o) return;
      const n = Math.floor((performance.now() - last) / COUNTER_MS);
      last += n * COUNTER_MS;
      o.engine.elapse(n);
      const going = o.engine.tick();
      canvas.current?.getContext('2d')?.putImageData(new ImageData(toRgba(o.engine.dib, dibColors(o.engine.colors)), TITLE_W, TITLE_H), 0, 0);
      if (going) return;
      leaveOpening();
      toMenu();
    }, TICK_MS);
    return () => clearInterval(id);
  }, [phase]);
  const skipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (phase === 'menu' && !opening) onMusic(8); // 돌아옴(0x425fa0 → 0x426c7c)
  }, []);
  useEffect(() => () => void (skipTimer.current && clearTimeout(skipTimer.current)), []);
  const pointAt = (e: React.PointerEvent) => {
    const r = canvas.current?.getBoundingClientRect();
    return titleHit(Math.floor(e.clientX - (r?.left ?? 0)), Math.floor(e.clientY - (r?.top ?? 0)));
  };
  // vmv2.exe 0x00426a3a: 누른 점으로 마우스 위를 다시 정하고 그 항목
  const press = (e: React.PointerEvent) => {
    if (e.button !== 0 || modal || phase === 'skip') return;
    if (phase === 'opening') {
      // 0x426807 상태 1 → 0x426c7c: 엔진을 타이틀로 건너뛰고(0x433340, 화면 지움) BGM 8, 다음 48ms 틱에 메뉴
      leaveOpening();
      onMusic(8);
      setPhase('skip');
      skipTimer.current = setTimeout(toMenu, TICK_MS);
      return;
    }
    if (phase === 'avi') {
      // 0x426807 상태 0: MCIWnd 끝으로 → 멈춤 알림 → 0x426c7c(오프닝 애니메이션 건너뜀) → 다음 틱에 메뉴. 그 사이 클릭은 메뉴에 닿지 않는다
      setPhase('skip');
      skipTimer.current = setTimeout(() => {
        onMusic(8); // 0x426c7c
        toMenu();
      }, SKIP_MS);
      return;
    }
    const hit = pointAt(e);
    setHover(hit);
    const action = titleAction(hit);
    if (action === 'loadData') return loadData(); // 소리 1은 loadData가
    if (action) sound.call(['ui', 1]);
    if (action === 'selectLevel') setModal('level'); // 0x426727
    else if (action === 'expertMode') onScenario(2); // 0x4261f7 → 0x450e35
    else if (action === 'freeBattle') onFreeBattle();
    else if (action === 'quit') onQuit();
    else if (action === 'networkBattle') setModal('network'); // 원작 0x44f2e0(DirectPlay) 대신 안내창, 닫으면 타이틀에 남음
  };
  const boxes = useMemo(
    () => ({
      trace: messageBox(exe.cString(CONFIRM_TITLE), exe.cString(TRACE_QUESTION), [{ id: IDYES, text: '&Yes' }, { id: IDNO, text: '&No' }]),
      found: messageBox(exe.cString(CONFIRM_TITLE), exe.cString(FOUND_QUESTION), [{ id: IDYES, text: '&Yes' }, { id: IDNO, text: '&No' }]),
      readError: messageBox(exe.cString(ERROR_TITLE), exe.cString(READ_FAILED), [{ id: IDOK, text: 'OK' }]),
      loadError: messageBox(exe.cString(ERROR_TITLE), exe.cString(LOAD_FAILED), [{ id: IDOK, text: 'OK' }]),
      // 원작에 없는 안내(사용자 결정 10): 네트워크 대전(DirectPlay)은 옮기지 않는다
      network: messageBox('Network Battle', 'Network Battle is not supported in this version.', [{ id: IDOK, text: 'OK' }]),
      slots: readDialog(exe, 0x76),
    }),
    [exe],
  );
  const rows = useMemo(() => (modal === 'slots' || modal === 'found' ? continueRows(exe, read) : []), [modal, exe, read]);
  const at = (d: keyof typeof boxes) => centerDialog(null, dialogLayout(boxes[d], WIN98, layer.size).outer, layer.size);
  // Load Data(0x426a3a case 4): 소리 1, 유효한 이어 하기가 있으면 묻는다. 없거나 "아니오"면 게임 데이터(0x44198d)
  const loadData = () => {
    sound.call(['ui', 1]);
    setModal(continueRows(exe, read).some((r) => r.valid) ? 'found' : 'gameData');
  };
  const load = (slot: number | null) => {
    if (slot === null) return setModal(null);
    const loaded = loadContinue(slot, seed, (block, next) => {
      setModal(null);
      onResume(block, next);
    });
    if (!loaded) setModal('readError');
  };
  const traceAnswer = (id: number) => {
    if (id !== IDYES && id !== IDNO) return;
    sound.call(['ui', 1]);
    onTraceDone();
    if (id === IDNO) {
      deleteSave(AUTOSAVE_FILE);
      setModal(null);
      return afterTrace();
    }
    const block = autosaveBlock();
    if (!block) return setModal('loadError'); // SV080은 남는다, 닫으면 타이틀로
    setModal(null);
    onResume(block, seed);
  };
  const dialogs = layer.element
    ? createPortal(
        <>
          {modal && modal !== 'gameData' && <div className="battle-backdrop" onContextMenu={(e) => e.preventDefault()} />}
          {modal === 'trace' && <DialogBox dialog={boxes.trace} at={at('trace')} metrics={WIN98} onCommand={traceAnswer} />}
          {modal === 'found' && (
            <DialogBox
              dialog={boxes.found}
              at={at('found')}
              metrics={WIN98}
              onCommand={(id) => {
                if (id !== IDYES && id !== IDNO) return;
                sound.call(['ui', 1]);
                setModal(id === IDYES ? 'slots' : 'gameData');
              }}
            />
          )}
          {modal === 'gameData' && (
            <GameDataDialog
              exe={exe}
              mode="load"
              sound={sound}
              onDone={(block) => {
                setModal(null);
                if (block) onGameData(block); // 타이틀 닫기 → 0x4510b6(월드)
              }}
            />
          )}
          {modal === 'slots' && <SlotDialog dialog={boxes.slots} rows={rows} mode="load" at={at('slots')} metrics={WIN98} sound={sound} onClose={load} />}
          {modal === 'level' && (
            <DialogBox
              dialog={level}
              at={centerDialog(null, dialogLayout(level, WIN98).outer, layer.size)}
              metrics={WIN98}
              onCommand={(id) => {
                // 0x42668b: Easy(0)·Normal(1) 소리 1 → 0x4261f7, 다음 루프에 0x450da0. Cancel 소리 2
                if (id === EASY || id === NORMAL) sound.call(['ui', 1]);
                else if (id === 2) sound.call(['ui', 2]);
                else return;
                setModal(null);
                if (id !== 2) onScenario(id === EASY ? 0 : 1);
              }}
            />
          )}
          {(modal === 'readError' || modal === 'loadError' || modal === 'network') && (
            <DialogBox
              dialog={boxes[modal]}
              at={at(modal)}
              metrics={WIN98}
              onCommand={(id) => {
                if (id !== IDOK && id !== 2) return;
                setModal(null);
                if (phase === 'trace') afterTrace();
              }}
            />
          )}
        </>,
        layer.element,
      )
    : null;
  // VANTAGEPOPUP(화면 전체, WS_POPUP): 프레임·메뉴 줄을 덮는다. DIB 밖은 팔레트 10번(검정), 키보드 없음, 오른쪽 단추 무시
  const origin = titleOrigin(layer.size);
  const popup =
    layer.element && phase !== 'trace'
      ? createPortal(
          <div
            className="title-popup"
            style={{ position: 'absolute', inset: 0, background: '#000', zIndex: 100, overflow: 'hidden' }}
            onPointerDown={press}
            onPointerMove={(e) => phase === 'menu' && !modal && setHover(pointAt(e))}
            onContextMenu={(e) => e.preventDefault()}
          >
            {phase === 'avi' && <OpeningMovie at={aviOrigin(layer.size)} onStart={() => onMusic(0)} onEnd={() => setPhase('opening')} />}
            {(phase === 'menu' || phase === 'opening') && <canvas ref={canvas} width={TITLE_W} height={TITLE_H} style={{ position: 'absolute', left: origin.x, top: origin.y }} />}
          </div>,
          layer.element,
        )
      : null;
  return (
    <>
      {popup}
      {dialogs}
    </>
  );
}
