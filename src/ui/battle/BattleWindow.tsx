import { type MouseEvent, type PointerEvent, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { lightPhase } from '../../engine/rules/light.ts';
import { natialOf } from '../../engine/rules/summon.ts';
import { workGrid } from '../../engine/rules/terrain.ts';
import { masDescription, readScenario, readScenarioData, resultLevelUp } from '../../engine/scenario.ts';
import { MASTERS, unitOf } from '../../engine/state.ts';
import type { Cell, Command } from '../../engine/command.ts';
import type { TurnStep } from '../../engine/rules/turn.ts';
import type { StrikeRecord } from '../../engine/turn.ts';
import type { GameState } from '../../engine/state.ts';
import { masterText, readDescriptions, readMapLabel } from '../../formats/descriptions.ts';
import { readDialog } from '../../formats/dialogs.ts';
import { htmlText } from '../../i18n/hangul.ts';
import { loadMap } from '../../formats/mapData.ts';
import { readFreeModeNames, readMasterTable } from '../../formats/masterTable.ts';
import type { Light } from '../../formats/natialTable.ts';
import { u32 } from './attack.ts';
import { aiData } from './data.ts';
import {
  infoRadios, type InfoTexts, LIGHT_RADIOS, MAGIC_H, MAGIC_W, magicInfo, magicPicture, MASTER_PAGE, masterInfo, NATIAL_PAGE, natialInfo, PORTRAIT_SHOWN, PORTRAIT_W, readInfoTables, unitPortrait,
} from './infoDialogs.ts';
import { cpuStep, type Game, type GameSetup, humanStep, resumeGame, startGame, whoseTurn } from './game.ts';
import { commandMenu, MENU_H, MENU_W, menuItemAt, menuLabels } from './menu.ts';
import type { Original } from './original.ts';
import { NO_OVERLAY, type UiOverlay } from './overlay.ts';
import { FIELD_H, FIELD_W } from './raster.ts';
import type { UiSource } from './halfSheet.ts';
import { battleColors, battlePalette, drawBattle, enterHalf, leaveHalf, loadBattleArt, logicalPalette, toRgba } from './screen.ts';
import {
  actionsOf, chooseMenu, chooseUnitMenu, confirmDestruction, cursorShape, cursorStatus, drawnState, menuEnabled, overlayOf, pointer, press, pressRight, type Session, statusOf, type Step, timeUp, unitMenuEnabled,
} from './session.ts';
import type { Sound } from './sound.ts';
import { loadUiGraphics } from './sprites.ts';
import { runCommand } from './flow.ts';
import { Stage, walkSteps } from './stage.ts';
import { STATUS_H, STATUS_W, StatusWindow, type StatusView } from './statusWindow.ts';
import { Picture } from './Picture.tsx';
import { battleTrack } from '../sound/bgm.ts';
import { SKY_START } from './field.ts';
import { animationResets } from '../frame/options.ts';
import { readTimeTables, shownSide, startTimer, type Timer, tickTimer } from './timeLimit.ts';
import { centerOn, revealTarget, scaleScroll, scrollStep, type Viewport } from './view.ts';
import { WIN98 } from '../frame/frame.ts';
import { DialogBox, type DialogValues } from '../frame/DialogBox.tsx';
import { IDNO, IDOK, IDYES, messageBox } from '../frame/messageBox.ts';
import { encodeSaveFile } from '../../formats/saveFile.ts';
import { AUTOSAVE_FILE, AUTOSAVE_ID, CONTINUE_FILE, continueBlock, resumedMidTurn, type WindowPlaces } from './continueData.ts';
import { continueRows, deleteSave, readSlotIds, writeSave } from './saveStore.ts';
import { SlotDialog } from './SlotDialog.tsx';
import { type ArrangeKey, battlePaused, rearrangeNeeded } from './windowState.ts';
import { decodeState } from '../../engine/state.ts';
import { SCENE } from '../frame/frame.ts';
import { centerDialog, dialogLayout, fitPicture, placeDialog } from '../frame/dialogLayout.ts';
import { ScreenLayer } from '../frame/Desktop.tsx';
import { HELP_H, HELP_W, HelpWindow } from './helpWindow.ts';
import { type BattleTally, tallyOf, titlePrompt } from '../world/scenarioFlow.ts';
import { mapDescription } from '../world/worldArt.ts';
import { drawMinimap, MINIMAP_H, MINIMAP_W, minimapMarks, minimapSamples, minimapTerrain, shrinkTables } from './minimap.ts';
import { dibColors, resultPalette } from './palette.ts';
import { readGlyphs } from './font.ts';
import { cursorStyle, cursorStyles } from './cursors.ts';
import { NoticeBoard } from './NoticeBoard.tsx';
import { battleEndText, loadResultArt } from './resultWindow.ts';
import { ResultWindow } from './ResultWindow.tsx';
import { battleArrange, outer, type Point, type Rect, type Size, worldLayout } from '../frame/layout.ts';
import { MdiChild } from '../frame/MdiChild.tsx';
import type { Panes } from './Play.tsx';
import './battleWindow.css';

type Pane = 'battle' | 'status' | 'help' | 'view';


const TICK_MS = 48; // 대기 루프가 16ms 카운터를 3으로 둔다(0x44db4f·0x44e9b1)
const CPU_PAUSE_MS = 300; // ponytail: CPU 생각 시간 대신 쉬기
const UNIT_MENU_LABELS = 0x46005c; // 유닛 메뉴 이름 10개(0x41a88e)
const MENU_GAP = 32; // 메뉴 창은 커서 x − 폭/2, 커서 y + 32(0x419de1)
const DETAIL_INFO = 4;
const SAVE_QUESTION = 0x45e3c8; // 컨티뉴 데이터를 저장할지 묻는 글
const SURRENDER = 3021; // 대화 상자 0x84 Surrender
const CHOOSE_ACTION = 0x45e574; // "Choose your action." 명령 메뉴 팝업이 대화 상자가 닫히면(1000) 도움말에(0x403c7c)
const MAGIC_HELP = 0x462314; // 마법 설명 표[행동](0x424fd5): 10~15만 마법 설명

type Level = 0 | 1 | 2;
/** 네이티얼 칸 대화 상자: 소환 목록 0x6f(명령)·0x81(마스터 정보의 단추), 네이티얼 정보 0x7f. choice는 고른(보이는) 종류 */
type NatialBody = { readonly side: number; readonly choice: number | null; readonly level: Level; readonly light: Light; readonly texts: InfoTexts; readonly picture: Uint8Array | null };
type NatialDialog = (NatialBody & { readonly kind: 'summon' }) | (NatialBody & { readonly kind: 'summonList' }) | (NatialBody & { readonly kind: 'natial' });
/** 마법 목록 0x70(명령)·0x82(마스터 정보의 단추). choice는 고른 행동 */
type MagicBody = { readonly list: readonly number[]; readonly choice: number | null; readonly texts: InfoTexts; readonly picture: Uint8Array | null };
type MagicDialog = (MagicBody & { readonly kind: 'magic' }) | (MagicBody & { readonly kind: 'magicList' });
type MasterDialog = { readonly kind: 'master'; readonly side: number; readonly texts: InfoTexts; readonly picture: Uint8Array };
type Info = NatialDialog | MagicDialog | MasterDialog;
/** 대화 상자 쌓임: 맨 뒤가 맨 안쪽(켜진 것), 앞의 것은 자식을 붙여 꺼져 있다(0x41b878) */
type Dialog = Info | { readonly kind: 'mp' } | { readonly kind: 'confirm' } | { readonly kind: 'close' } | { readonly kind: 'giveup' } | { readonly kind: 'abort' } | { readonly kind: 'abandon' } | { readonly kind: 'slots' } | { readonly kind: 'writeError' };
const TEMPLATE: Record<Dialog['kind'], number> = { summon: 0x6f, magic: 0x70, mp: 0x73, confirm: 0x74, natial: 0x7f, master: 0x80, summonList: 0x81, magicList: 0x82, close: 0x84, giveup: -1, abort: -2, writeError: -3, abandon: -4, slots: 0x76 };
const ABORT_QUESTION = 0x45e3f0; // 컨티뉴 데이터를 저장할 수 없으니 전투를 그만둘지 묻는 글 (0x401bd8, 저장할 수 없을 때)
const WRITE_FAILED = 0x474254; // "Writing failed." (0x44ea4c, 제목 "Error" 0x4758cc, MB_OK)
const ERROR_TITLE = 0x4758cc;
const SURRENDER_QUESTION = 0x45e430; // "Is it okay to surrender?" (0x401d5b → MessageBox 0x42e7f7, 제목 0x472680, MB_YESNO)
const CONFIRM_TITLE = 0x472680;
const TITLES = { battle: 0x45f554, status: 0x45f400, help: 0x462374, view: 0x45f4dc }; // "Battle window" "Information window" "Help window" "Battle view window"
const ABANDON_QUESTION = 0x45f0d4; // "Do you wish to abbandon the game?" (결과 창 → 타이틀 0x407ff9(1), 시나리오일 때)
/** 대화 상자 템플릿이 아닌 것: 팝업에 붙지 않고 가운데 */
const centered = (kind: Dialog['kind']) => kind === 'close' || kind === 'giveup' || kind === 'abort' || kind === 'abandon' || kind === 'slots' || kind === 'writeError';
// 그림 사각형(대화 단위, 0x445355·0x4445c8·0x445924·0x425a2b)
const PORTRAIT_RECT = { left: 8, top: 5, right: 0x40, bottom: 0x5f };
const LIST_PORTRAIT_RECT = { left: 0x52, top: 5, right: 0x8a, bottom: 0x5f };
const MAGIC_RECT = { left: 0x41, top: 0, right: 0x86, bottom: 0x73 };
const PORTRAIT = { width: PORTRAIT_W, height: PORTRAIT_SHOWN };
const MAGIC = { width: MAGIC_W, height: MAGIC_H };

/** 확대 → 전장 픽셀 배율: x /2는 반 크기 칩(12 × 6)으로 그린다(0x40f03c) */
const scaleOf = (zoom: Panes['zoom']) => (zoom === 0 ? 0.5 : zoom);

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** 결과 창 END(0x408034)가 넘기는 것 */
export interface BattleOutcome {
  /** 0x476bd4: 이긴 진영(0·1), 비기면 −1 */
  readonly winner: number;
  readonly tally: BattleTally;
  /** 그때의 창 팔레트 0x4800e0(결과 창) */
  readonly palette: Uint8Array;
}

/** 한 판(진영마다 사람·CPU는 조종 값). onExit은 판을 마칠 때 이어 갈 난수 상태·가는 곳·블록의 창 구간을 넘긴다 */
export function BattleWindow({
  original,
  setup,
  seed,
  sound,
  icon,
  client,
  panes,
  options,
  modal,
  onMusic,
  onPanes,
  onScene,
  onExit,
  resume = null,
  places,
}: {
  readonly original: Original;
  readonly setup: GameSetup;
  /** 되살릴 저장 블록(0x401899): 상태와 창 자리·켬·확대. 없으면 새 전투 */
  readonly resume?: Uint8Array | null;
  /** 블록의 창 구간(+0x268~+0x2d3). 전장 칸이 없으면(0x45102d 뒤 확대 −1) 전투 배치를 새로 한다 */
  readonly places: WindowPlaces;
  readonly seed: number;
  readonly sound: Sound;
  /** MDI 자식 창 캡션 아이콘 */
  readonly icon: string;
  /** MDI 클라이언트 크기 */
  readonly client: Size;
  readonly panes: Panes;
  /** 옵션 word(0x503ff0): 애니메이션 비트 1·2·4 */
  readonly options: number;
  /** 프레임의 모달 대화 상자(Customize·Sound)가 열려 있다: 48ms 콜백이 멈춘다 */
  readonly modal: boolean;
  /** BGM 곡(0x443770): 전투 시작·되살리기는 맵 곡(0x401a0c), 끝·항복은 3 − 이김(0x401ec3·0x402020) */
  readonly onMusic: (track: number) => void;
  readonly onPanes: (update: (p: Panes) => Panes) => void;
  /** 장면이 바뀜(전투 4 → 결과 창 5, 0x407d43): 메뉴 켬·제목 */
  readonly onScene: (scene: number) => void;
  /** 판을 마친다: 이어 갈 난수 상태와 갈 곳(전장 창 닫기·Turn of World Map·결과 창 END → 월드 0x44fd31, Turn to Title → 타이틀 0x425fa0) */
  /** result: 결과 창에서 월드로 갈 때(0x408034) 이긴 진영·통계 자료·결과 창 팔레트(시나리오 진행과 장면 창 base) */
  readonly onExit: (seed: number, to: 'world' | 'title', places: WindowPlaces, result?: BattleOutcome) => void;
}) {
  const { exe, read, dat10 } = original;
  const map = useMemo(() => loadMap(exe, read, setup.map), [exe, read, setup.map]);
  useEffect(() => onMusic(battleTrack(map)), []); // 0x4017a2·0x401899 → 0x401a0c
  const data = useMemo(() => aiData(exe, read, map, dat10), [exe, read, map, dat10]);
  const art = useMemo(() => loadBattleArt(exe, read, map), [exe, read, map]);
  const labels = useMemo(() => menuLabels(exe), [exe]);
  const unitLabels = useMemo(() => {
    const v = new DataView(exe.read(UNIT_MENU_LABELS, 40).buffer);
    return Array.from({ length: 10 }, (_, i) => exe.cString(v.getUint32(i * 4, true)));
  }, [exe]);
  // 시나리오(블록 +0x8)면 진영 1 마스터 설명은 이 맵 MAS의 글(0x42d2e9: 시작·되살리기 0x401899)
  const scenario = useMemo(() => !!(resume ? readScenario(resume) : setup.battle?.scenario), [resume, setup.battle]);
  const texts = useMemo(() => {
    const t = readDescriptions(exe);
    return scenario ? { ...t, enemyMaster: masDescription(read(map.header.enemyMasterId)) } : t;
  }, [exe, read, map, scenario]);
  const dialogs = useMemo(
    (): Record<number, import('../../formats/dialogs.ts').Dialog> => ({
      ...Object.fromEntries(Object.values(TEMPLATE).filter((id) => id > 0).map((id) => [id, readDialog(exe, id)])),
      [-1]: messageBox(exe.cString(CONFIRM_TITLE), exe.cString(SURRENDER_QUESTION), [{ id: IDYES, text: '&Yes' }, { id: IDNO, text: '&No' }]),
      [-2]: messageBox(exe.cString(CONFIRM_TITLE), exe.cString(ABORT_QUESTION), [{ id: IDYES, text: '&Yes' }, { id: IDNO, text: '&No' }]),
      [-3]: messageBox(exe.cString(ERROR_TITLE), exe.cString(WRITE_FAILED), [{ id: IDOK, text: 'OK' }]),
      [-4]: messageBox(exe.cString(CONFIRM_TITLE), exe.cString(ABANDON_QUESTION), [{ id: IDYES, text: '&Yes' }, { id: IDNO, text: '&No' }]),
    }),
    [exe],
  );
  const glyphs = useMemo(() => readGlyphs(read), [read]);
  const infoTables = useMemo(() => readInfoTables(exe), [exe]);
  const [game, setGame] = useState<Game>(() =>
    resume
      ? resumeGame(data, decodeState(resume), setup.pattern, seed) // 0x401899 → 0x401b12 → 0x40536c: 같은 차례 입력 대기
      : startGame(data, { masters: readMasterTable(exe), oa: data.oa, names: readFreeModeNames(exe) }, setup, seed),
  );
  // 되살린 첫 차례가 이미 지형 효과를 받았으면(블록 +0x2dc = 1) 자동 저장도 하지 않는다(0x40546d)
  const resumedTurn = useRef<boolean | null>(null);
  resumedTurn.current ??= resumedMidTurn(resume);
  // 연출 틀: 표시 객체 풀·타이머 카운터·걷기(원작 0x403020·0x412f6d). 틱마다 ticks를 올려 다시 그린다
  const stage = useMemo(() => new Stage(art, game.result.state, options), [art]);
  // System > Customize OK(0x44ee63): 전투 중 끈 하늘은 처음 프레임(0x43d4b8), 물은 프레임 0(0x43e2e0). 대기 동작은 저절로 멈춘다
  const shownOptions = useRef(options);
  useEffect(() => {
    const r = animationResets(shownOptions.current, options, ending ? SCENE.result : SCENE.battle);
    shownOptions.current = options;
    if (r.resetSky) stage.sky = SKY_START;
    if (r.resetWater) stage.water = 0;
    stage.options = options;
  }, [options]);
  // 창 배치: 월드 배치(0x4510ca: 도움말 창 자리) 뒤 전투 배치(0x40e3be). Window arrange(0x40e4cd)마다 다시
  const [rects, setRects] = useState<Record<Pane, Rect>>(() => {
    const w = places;
    if (!w.battle || !w.status || !w.view || !w.help) return battleArrange(client, WIN98, panes.help);
    // 블록의 창 자리: 앞 전투(0x40e392는 확대가 −1일 때만 배치)·되살리기(0x401b12 → 0x40e58f·0x40ace3·0x40d7ae, 도움말 0x424c2a)
    const o = outer(WIN98);
    const at = (p: Point, size: Size): Rect => ({ left: p.x, top: p.y, right: p.x + size.width, bottom: p.y + size.height });
    return { battle: w.battle, status: at(w.status, o.status), help: at(w.help, o.help), view: at(w.view, o.view) };
  });
  // 저장 블록의 창 구간(0x441960 + 켬·확대). 월드 쪽 칸은 월드 장면이 남긴 값(되살리기는 블록 값)
  const windowPlaces = (): WindowPlaces => {
    const world = worldLayout(client, WIN98, { help: true, chat: false });
    const left = (r: Rect): Point => ({ x: r.left, y: r.top });
    return {
      world: places.world ?? world.world,
      mapInfo: places.mapInfo ?? world.mapInfo,
      masterInfo: places.masterInfo ?? world.masterInfo,
      chat: places.chat ?? world.chat,
      battle: rects.battle,
      status: left(rects.status),
      view: left(rects.view),
      help: left(rects.help),
      flags: { help: panes.help, chat: false, status: panes.status, view: panes.view },
      zoom: panes.zoom,
    };
  };
  const [order, setOrder] = useState<readonly Pane[]>(['help', 'view', 'status', 'battle']); // 뒤가 위, 맨 뒤가 활성
  // 도움말 끔은 다시 배치할 때만(0x40e4cd). 마운트 때는 처음 값(되살린 블록 자리를 덮지 않는다)
  const arrangedFor = useRef<ArrangeKey | null>(null);
  useEffect(() => {
    const key = { arranged: panes.arranged, width: client.width, height: client.height };
    if (rearrangeNeeded(arrangedFor.current, key)) setRects(battleArrange(client, WIN98, panes.help));
    arrangedFor.current = key;
  }, [panes.arranged, client.width, client.height]);
  const raise = (p: Pane) => setOrder((o) => (o[o.length - 1] === p ? o : [...o.filter((q) => q !== p), p]));
  const child = (p: Pane) => ({ rect: rects[p], active: order[order.length - 1] === p, z: order.indexOf(p) + 1, metrics: WIN98, icon, onActivate: () => raise(p), onRect: (r: Rect) => setRects((v) => ({ ...v, [p]: r })) });
  const [ticks, setTicks] = useState(0);
  // 걷는 동안(원작 단계 0): 그릴 상태와 표시. 끝나면 이어 하기가 다음 판을 넣는다
  const [walking, setWalking] = useState<{ readonly state: GameState; readonly overlay: UiOverlay } | null>(null);
  const [ready, setReady] = useState(false); // 전투 시작의 화면 이동이 끝나 입력 시작(0x40546d)을 거쳤다
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const [hover, setHover] = useState(-1);
  const [stack, setStack] = useState<readonly Dialog[]>([]);
  const dialog = stack.at(-1) ?? null;
  // 전투 끝: 알림판(0x42e090, 닫히면 then) → 결과 창(장면 5, 0x407d43). over는 승패가 난 뒤(항복 포함) 남은 흐름을 버린다
  // 알림마다 새 판(key): 떠 있는 알림을 다른 알림이 바꿔도 닫힘 타이머·닫힘 표시가 새로 시작한다
  const [notice, setNoticeState] = useState<{ readonly text: string; readonly then: () => void; readonly id: number } | null>(null);
  const noticeId = useRef(0);
  const setNotice = (n: { readonly text: string; readonly then: () => void } | null) => setNoticeState(n && { ...n, id: ++noticeId.current });
  const [ending, setEnding] = useState<{ readonly winner: number; readonly state: GameState; readonly won: boolean } | null>(null);
  const over = useRef(false);
  // 알림판·항복 확인(모달 MessageBox)·결과 창 동안 전투 48ms 콜백은 돌지 않는다(0x42e186·0x401bd8)
  const paused = useRef(false);
  paused.current = modal || battlePaused({ notice: notice !== null, ending: ending !== null, dialogs: stack.map((d) => d.kind) });
  const pausedNow = paused.current;
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const statusCanvas = useRef<HTMLCanvasElement>(null);
  const statusWindow = useRef<StatusWindow | null>(null);
  const statusView = useRef<StatusView | null>(null);
  // 생각 시간 제한(0x4055cf·0x407926): 타이머, 차례 진영, 남은 연장 횟수(블록 +0xe64: UI가 들고 저장 때 넣는다), 연장 아이콘 진영(0x476af0)
  const timeTables = useMemo(() => readTimeTables(exe), [exe]);
  const timer = useRef<Timer | null>(null);
  const timerSide = useRef(0);
  const extensions = useRef<readonly [number, number]>(game.result.state.timeExtensions);
  const iconSide = useRef(shownSide(game.result.state.sideStates.map((s) => s.controller), null));
  const timeView = (): StatusView['time'] => ({ on: timer.current !== null, remaining: timer.current?.remaining ?? 0, extensions: iconSide.current === null ? 0 : extensions.current[iconSide.current] });
  const withTime = (state: GameState): GameState => ({ ...state, timeExtensions: extensions.current });
  const timeTick = useRef<() => void>(() => {});
  // 상태 창의 커서 칸(0x476be0): 차례 시작(0x403c8e)과 커서가 켜진 채 칸이 바뀔 때(0x403d7b)만
  const [infoCell, setInfoCell] = useState<Cell | null>(null);
  const menuCanvas = useRef<HTMLCanvasElement>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  const layer = useContext(ScreenLayer);
  // 도움말 창(0x424c2a)과 미니맵(전투 시작 0x40d4f3: 그때 시각 팔레트로 표본)
  const help = useMemo(() => new HelpWindow(read), [read]);
  const helpCanvas = useRef<HTMLCanvasElement>(null);
  const viewCanvas = useRef<HTMLCanvasElement>(null);
  const samples = useMemo(() => {
    const logical = logicalPalette(art, game.result.state); // 그때 시각 팔레트(0x4232a9가 읽는 LOGPALETTE)
    return minimapSamples(art.sheet.chips, logical, shrinkTables(exe, map));
  }, [art]);
  const session = game.session;
  const turn = whoseTurn(game);
  // 개발 빌드에서만 차례 상태를 내보인다(브라우저 확인용, __vmv2Bgm과 같은 방식)
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const r = game.result;
    const actor = 'winner' in r ? null : r.actor;
    // win(진영): 그 진영이 이긴 것으로 끝내고 결과 창(시나리오 흐름 확인용)
    const win = (side: number) => {
      over.current = true;
      finish(side, r.state, battleEndText(exe, r.state, side).won);
    };
    (window as unknown as { __vmv2Battle?: unknown }).__vmv2Battle = { turn, actor, side: actor === null ? null : unitOf(r.state, actor).side, phase: session?.phase ?? null, win };
  }, [game, session, turn]);

  // 전장 창이 보이는 부분(전장 DIB 좌표, 확대를 뺀 값). 확대 x 2는 칩 48 × 24로 그린다(0x40f03c)
  // stage.scroller·흐름의 reveal은 한 번 만든 클로저라 확대는 ref로 읽는다
  const zoom = panes.zoom;
  const zoomRef = useRef(zoom);
  const viewport = (): Viewport => {
    const el = scroller.current!;
    const z = scaleOf(zoomRef.current);
    return { left: el.scrollLeft / z, top: el.scrollTop / z, width: el.clientWidth / z, height: el.clientHeight / z };
  };
  const scrollField = (left: number, top: number) => scroller.current?.scrollTo(left * scaleOf(zoomRef.current), top * scaleOf(zoomRef.current));
  // UI 페이지(0x2c6~)에 든 것: 입력 시작이 표식 그림을 읽고(0x476bb0), 명령 실행부터 차례 흐름 끝까지 연출 그림(0x476bb4). x /2로 바꿀 때 반 시트의 출처
  const uiSource = useRef<UiSource>('keep');

  const failed = useRef(false); // 오류가 나면 타이머가 연출을 더 돌리지 않는다
  const run = useCallback((f: () => void) => {
    try {
      f();
    } catch (e) {
      console.error(e);
      failed.current = true;
      setError((p) => p ?? messageOf(e)); // 첫 오류를 남긴다
    }
  }, []);

  // 걷기(0x406c5b → 0x41377b): 걷는 동안 state와 overlay를 그리고, 다 걸은 틱에 then
  const walk = (state: GameState, overlay: UiOverlay, unit: number, to: Cell, then: () => void) => {
    const { steps, flying } = walkSteps(data, state, unit, to);
    setWalking({ state, overlay });
    stage.walk(unit, steps, flying, () => {
      setWalking(null);
      run(then);
    });
  };

  // 명령 하나 = 차례 흐름 하나(flow.ts): 명령 연출, 행동 뒤 흐름, 다음 차례 시작까지. 단계마다 그릴 상태(상태 창 0x40aee4)를 바꾸고, 입력 시작·전투 끝에 then
  const flow = (before: GameState, actor: number, command: Command, received: boolean, trace: readonly StrikeRecord[], steps: readonly TurnStep[], then: () => void) => {
    uiSource.current = 'shrink'; // 0x406d13
    setWalking({ state: before, overlay: NO_OVERLAY });
    runCommand(stage, data, before, actor, command, received, trace, steps, {
      show: (state) => setWalking((w) => w && { ...w, state }),
      done: () => {
        if (over.current) return; // 항복으로 버린 흐름
        uiSource.current = 'keep'; // 0x40623b
        setWalking(null);
        run(then);
      },
      notice: (text, then) => setNotice({ text, then: () => run(then) }), // 물이 돌아옴(0x4022d7)
      reveal: (cell, check, around) => scroller.current && revealTarget(map, workGrid(map, before), cell, check, viewport(), around),
    });
  };

  // vmv2.exe 0x00407926(p): 생각 시간 한 틱. 정보 창은 시간 칸(0x40b00c), 연장을 쓰면 전체(0x40aee4). 다 썼고 입력 중이면 true
  const tickTime = (input: boolean): boolean => {
    const t = timer.current;
    if (!t || over.current) return false;
    const side = timerSide.current;
    const r = tickTimer(timeTables, game.result.state.timeLimit, t, extensions.current[side], Math.floor(performance.now()), input);
    timer.current = r.timer;
    extensions.current = side === 0 ? [r.extensions, extensions.current[1]] : [extensions.current[0], r.extensions];
    for (const n of r.sounds) sound.call(['ui', n]);
    const w = statusWindow.current;
    const v = statusView.current;
    const view = v && { ...v, time: timeView(), water: stage.water, pose: v.unit !== null ? stage.poseOf(v.unit) : undefined }; // 전체 다시 그리기도 지금 자세·물 프레임으로
    if (w && view && r.redraw && (r.redraw === 'all' ? (w.update(view), true) : w.updateTime(view))) {
      statusCanvas.current?.getContext('2d')?.putImageData(new ImageData(toRgba(w.image, battleColors(art, view.state, stage.shade, stage.flash, stage.shadeTime)), STATUS_W, STATUS_H), 0, 0);
    }
    return r.expired;
  };
  // 시간을 다 씀(0x406cd2 → 0x406d13): 열린 대화 상자·메뉴를 닫고 차례 유닛 칸에서 Stand by
  const forceStandBy = (s: Session) =>
    run(() => {
      timer.current = null;
      setStack([]);
      setMenuAt(null);
      const step = timeUp(s);
      const trace: StrikeRecord[] = [];
      const steps: TurnStep[] = [];
      const next = humanStep({ ...game, session: s }, step, trace, steps);
      stage.show(s.moved, NO_OVERLAY, s.cursor, false);
      flow(s.moved, s.actor, step.command!, false, trace, steps, () => setGame(next));
    });
  timeTick.current = () => {
    if (tickTime(!walking) && session) forceStandBy(session);
  };

  // 세션 함수의 결과: 알림·확인 창, 또는 명령을 실행하고 다음 차례로
  const take = (step: Step, at?: { x: number; y: number }) =>
    !walking &&
    ready &&
    run(() => {
      // 알림·확인은 지금 대화 상자의 자식으로(0x419cea → 0x41b878: 소환·마법 목록은 열린 채 꺼진다). 명령을 실행하거나 단계가 바뀌면 모두 닫힌다
      setStack((s) => (step.alert ? [...s, { kind: 'mp' }] : step.confirm ? [...s, { kind: 'confirm' }] : []));
      for (const n of step.sounds ?? []) sound.call(['ui', n]);
      if (step.command) timer.current = null; // 0x406d13
      const trace: StrikeRecord[] = [];
      const steps: TurnStep[] = [];
      const next = step.alert || step.confirm ? { ...game, session: step.session } : humanStep(game, step, trace, steps);
      const phase = next.session?.phase;
      const enter = () => {
        if ((phase === 3 || phase === 7) && session?.phase !== phase && at) {
          setMenuAt(at);
          setHover(-1);
        }
        if (phase !== 3 && phase !== 7) setMenuAt(null);
        setGame(next);
      };
      // 단계 2(또는 범위 보기 0x11·0x12·0x14)에서 다른 칸을 누르면 걸은 뒤 단계 3(0x406c5b → 0x405fba). 단계 0이라 표식·커서를 끈다
      const from = session && unitOf(session.moved, session.actor);
      const to = next.session && unitOf(next.session.moved, next.session.actor);
      if (session && session.phase !== 3 && phase === 3 && from && to && (from.x !== to.x || from.y !== to.y)) {
        stage.show(session.moved, NO_OVERLAY, session.cursor, false);
        // 걷기 끝(0x405fba)도 0x407926(1): 다 썼으면 단계 3 대신 새 칸에서 Stand by
        walk(session.moved, NO_OVERLAY, session.actor, to, () => (tickTime(true) && next.session ? forceStandBy(next.session) : enter()));
      } else if (session && step.command && steps.length) {
        // 명령 확정(0x406d13): 메뉴를 닫고 단계 0(표시·커서 끔) 뒤 차례 흐름
        setMenuAt(null);
        stage.show(session.moved, NO_OVERLAY, session.cursor, false);
        flow(session.moved, session.actor, step.command, false, trace, steps, enter);
      } else enter();
    });

  // 화면 이동 한 단계(연출 객체 0x4165bb): 창 가운데 목표까지 가로·세로 48px씩
  useEffect(() => {
    stage.scroller = (x, y) => {
      if (!scroller.current) return true;
      const vp = viewport();
      const target = centerOn(x, y, vp);
      const next = scrollStep(vp, target);
      scrollField(next.left, next.top);
      return next.left === target.left && next.top === target.top;
    };
    stage.onCursor = setInfoCell; // 0x403c8e → 0x40aefd
    if ('winner' in game.result) return setReady(true);
    stage.scrollToUnit(game.result.actor); // 전투 시작의 차례 시작(0x40536c → 0x4147b3), 다 옮기면 입력 시작
    stage.continueWith(() => setReady(true));
  }, [stage]);

  // 입력 시작(0x40546d → 0x4055cf): 차례 흐름의 화면 이동이 끝난 뒤. 상태 줄은 새 문구가 있을 때만 바꾼다(0x424fed)
  useEffect(() => {
    if (!ready || 'winner' in game.result) return;
    const u = unitOf(game.result.state, game.result.actor);
    loadUiGraphics(read, art.sheet); // 0x422f9a: 공격·투사체 그림이 덮은 표식 그림
    uiSource.current = 'markers';
    // 자동 저장(0x40546d → 0x442045): 사람·CPU 모든 차례, 지형 효과를 준 직후 주체가 살았을 때 SV080(식별값 1)
    if (resumedTurn.current) resumedTurn.current = false;
    else writeSave(AUTOSAVE_FILE, encodeSaveFile(continueBlock(withTime(game.result.state), windowPlaces(), AUTOSAVE_ID)));
    stage.startTurn({ x: u.x, y: u.y });
    if (game.session) {
      sound.call(['ui', 5]); // 사람 입력 시작(0x4055cf)
      timerSide.current = u.side;
      timer.current = startTimer(timeTables, game.result.state.timeLimit, game.result.actor < MASTERS, Math.floor(performance.now()));
      stage.setShade('dark', game.result.state.timeOfDay); // 0x4027e3
      setStatus(cursorStatus(data, texts, game.session) ?? ''); // 0x403bde
    }
  }, [game.result, map, ready]);
  // 차례 시작(0x40536c): 차례 진영이 사람이면 연장 아이콘을 그 진영으로
  useEffect(() => {
    if ('winner' in game.result) return;
    const s = game.result.state;
    iconSide.current = shownSide(s.sideStates.map((x) => x.controller), iconSide.current, unitOf(s, game.result.actor).side);
  }, [game.result]);
  // 대화 상자 초기화가 바꾼 어두운 칸(0x402902, 'base')은 범위 보이기(0x43d3a6)·유닛 메뉴 닫기(0x405e1d)가 되돌린다: 명령·유닛 메뉴(단계 3·7)를 떠나면
  useEffect(() => {
    if (stage.shade === 'base' && session && session.phase !== 3 && session.phase !== 7) stage.setShade('dark', game.result.state.timeOfDay);
  }, [session?.phase]);
  useEffect(() => {
    const at = session ? statusOf(data, session) : null;
    if (at !== null) setStatus(exe.cString(at));
    else if (session?.phase === 7) setStatus(cursorStatus(data, texts, session) ?? ''); // 0x404c02 → 0x424ed3: 고른 유닛 설명
  }, [session, data, exe, texts]);

  // 타이머(0x403020): 연출 틀 한 틱(4틱마다 상태 창 그림 0x40aff3)
  useEffect(() => {
    const id = setInterval(() => {
      if (failed.current || paused.current) return;
      run(() => timeTick.current()); // 0x403020 맨 앞: 0x407926(입력 단계 ≠ 0)
      run(() => {
        const draw = stage.tick();
        for (const c of stage.takeSounds()) sound.call(c);
        if (!draw || !statusWindow.current || !statusView.current) return;
        const view = statusView.current;
        statusWindow.current.tick({ ...view, water: stage.water, pose: view.unit !== null ? stage.poseOf(view.unit) : undefined });
        statusCanvas.current?.getContext('2d')?.putImageData(new ImageData(toRgba(statusWindow.current.image, battleColors(art, view.state, stage.shade, stage.flash, stage.shadeTime)), STATUS_W, STATUS_H), 0, 0);
      });
      setTicks((t) => t + 1);
    }, TICK_MS);
    return () => clearInterval(id);
  }, [art, stage, run, sound]);

  // 지금 판의 상태와 입력 표시(걷는 동안은 걷기 전 그대로)
  const shown = useMemo(() => {
    if (walking) return walking;
    const state = session ? drawnState(session) : game.result.state; // 유닛 메뉴의 가상 배치(0x405a6e)도
    const overlay = session
      ? overlayOf(data, session, 0)
      : turn === 'cpu' && !('winner' in game.result)
        ? { ...NO_OVERLAY, turnMarker: { unit: game.result.actor, remote: false } } // CPU 생각 동안도 차례 표식(0x4055cf → 0x40574a)
        : NO_OVERLAY;
    return { state, overlay };
  }, [walking, session, game.result, turn, data]);
  const shownState = useRef(shown.state); // x /2인 동안 그림을 읽을 때의 논리 팔레트(시각)
  shownState.current = shown.state;
  useEffect(() => {
    if (!walking) run(() => stage.show(shown.state, shown.overlay, session?.cursor ?? null, session?.cursorOn ?? false));
  }, [shown, walking, session, stage, run]);

  // CPU 차례(0x406573): 차례 표식을 지우고 단계 0, 도착 칸이 창 밖이면 화면을 옮긴 뒤(0x406ad9·0x406b3a → 0x4147b3) 걸어서 차례 흐름(0x4067b1)
  useEffect(() => {
    if (!ready || turn !== 'cpu' || error || walking || over.current || pausedNow) return;
    const id = setTimeout(
      () =>
        run(() => {
          if (over.current || paused.current) return; // 생각을 기다리는 동안 모달 상자·항복
          const r = game.result;
          if ('winner' in r) return;
          const trace: StrikeRecord[] = [];
          const steps: TurnStep[] = [];
          const { game: next, command } = cpuStep(game, trace, steps);
          const u = unitOf(r.state, r.actor);
          const { to } = command;
          const go = () => flow(r.state, r.actor, command, true, trace, steps, () => setGame(next));
          stage.decide(r.state);
          setWalking({ state: r.state, overlay: NO_OVERLAY });
          if (to.x === u.x && to.y === u.y) return go();
          const move = () => walk(r.state, NO_OVERLAY, r.actor, to, go);
          const center = scroller.current && revealTarget(map, workGrid(map, r.state), to, command.kind !== 0 ? 1 : 0, viewport(), 2);
          if (!center) return move();
          stage.scrollTo(center.x, center.y);
          stage.continueWith(move); // 0x40672d
        }),
      CPU_PAUSE_MS,
    );
    return () => clearTimeout(id);
  }, [game, turn, error, walking, ready, run, pausedNow]);

  // 확대를 바꾸면 스크롤 위치를 내용 크기 비례로(0x40f03c → 0x442aea, 왼쪽 위 기준). 캔버스가 줄면 브라우저가 먼저 잘라 버리므로 바뀌기 전 위치를 들고 있는다
  const scrollPos = useRef({ left: 0, top: 0 });
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const keep = () => (scrollPos.current = { left: el.scrollLeft, top: el.scrollTop });
    el.addEventListener('scroll', keep);
    return () => el.removeEventListener('scroll', keep);
  }, []);
  useLayoutEffect(() => {
    // 0x40e762: x /2로 들어가면 반 시트를 채우고(0x40ee74), 나오면 표식 그림을 온 시트에 다시(0x40ef93)
    const state = shownState.current;
    const logical = () => logicalPalette(art, shownState.current, stage.shade, stage.shadeTime);
    if (zoom === 0 && !art.sheet.half) run(() => enterHalf(art, state, logical(), uiSource.current, logical));
    if (zoom !== 0 && art.sheet.half) {
      leaveHalf(art);
      if (uiSource.current === 'markers') loadUiGraphics(read, art.sheet);
    }
    const el = scroller.current;
    const old = zoomRef.current;
    zoomRef.current = zoom;
    if (!el || old === zoom) return;
    el.scrollTo(scaleScroll(scrollPos.current.left, scaleOf(old), scaleOf(zoom)), scaleScroll(scrollPos.current.top, scaleOf(old), scaleOf(zoom)));
  }, [zoom, art]);

  // 도움말 창(0x424fed): 문구가 바뀌면 다시 쓰고, 색 표가 바뀌는 틱마다 다시 칠한다
  useEffect(() => {
    run(() => help.set(status));
  }, [status, help, run]);
  // 미니맵 지형: 물높이·마정석으로 작업 격자가 바뀌면 다시 그린다(0x40d52e)
  const grid = useMemo(() => workGrid(map, shown.state), [map, shown.state]);
  const gridKey = useMemo(() => grid.join(','), [grid]);
  const terrain = useMemo(() => minimapTerrain(map, grid, samples), [gridKey, samples]);
  useEffect(() => {
    run(() => {
      const colors = battleColors(art, shown.state, stage.shade, stage.flash, stage.shadeTime);
      helpCanvas.current?.getContext('2d')?.putImageData(new ImageData(toRgba(help.image, colors), HELP_W, HELP_H), 0, 0);
      const vc = viewCanvas.current?.getContext('2d');
      if (vc && scroller.current) {
        const vp = viewport();
        const image = drawMinimap(terrain, minimapMarks(map, grid, shown.state), { left: vp.left, top: vp.top, right: vp.left + vp.width, bottom: vp.top + vp.height });
        vc.putImageData(new ImageData(toRgba(image, colors), MINIMAP_W, MINIMAP_H), 0, 0);
      }
    });
  }, [shown, ticks, status, terrain, panes.view, panes.help, art, stage, run]);
  // 미니맵(0x40daeb): 누르면 잡고(0x40e2d4 SetCapture) 끄는 동안 그 점이 가운데가 되게 전장 창을 옮긴다(0x40e1e6: (점 − 보이는 사각형 반) × 6).
  // 움직일 때마다 단계 1이면 도움말을 맵 설명으로(0x403c67 → 0x424e78), 화면 이동 연출 중(0x4147e8)이면 옮기지 않는다. 떼면 놓는다(0x40e30a)
  const viewDragging = useRef(false);
  const dialogMoved = useRef<Point[]>([]); // 쌓인 대화 상자를 끌어 옮긴 만큼(깊이별, DialogBox가 열릴 때 0으로 알린다)
  const pressView = (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    viewDragging.current = true;
    dragView(e);
  };
  const dragView = (e: PointerEvent) => {
    if (session?.phase === 1) setStatus(mapDescription(map, scenario));
    if (!viewDragging.current || stage.moving || !scroller.current) return;
    const vp = viewport();
    const w = Math.trunc((vp.left + vp.width) / 6) - Math.trunc(vp.left / 6);
    const h = Math.trunc((vp.top + vp.height) / 6) - Math.trunc(vp.top / 6);
    scrollField((e.nativeEvent.offsetX - Math.trunc(w / 2)) * 6, (e.nativeEvent.offsetY - Math.trunc(h / 2)) * 6);
  };

  // 그리기
  useEffect(() => {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx) return;
    run(() => {
      const colors = battleColors(art, shown.state, stage.shade, stage.flash, stage.shadeTime);
      const overlay = { ...shown.overlay, cursor: stage.cursorView() };
      const half = zoomRef.current === 0;
      const image = drawBattle(art, shown.state, { water: stage.water, sky: stage.sky }, overlay, stage.pool, half);
      ctx.putImageData(new ImageData(toRgba(image, colors), half ? FIELD_W / 2 : FIELD_W, half ? FIELD_H / 2 : FIELD_H), 0, 0);
    });
  }, [shown, ticks, session, art, stage, run, zoom]);
  useEffect(() => {
    const menu = menuCanvas.current?.getContext('2d');
    if (!menu || session?.phase !== 3) return;
    run(() => {
      const image = commandMenu(read, labels, menuEnabled(data, session), hover);
      menu.putImageData(new ImageData(toRgba(image, battleColors(art, session.moved, stage.shade, undefined, stage.shadeTime)), MENU_W, MENU_H), 0, 0);
    });
  }, [session, hover, menuAt, art, data, read, labels, run]);

  // 전투 상태 창: 상태나 상태 창의 커서 칸이 바뀔 때 다시 그린다(0x40aee4). 지형 그림·초상은 타이머도 4틱마다(0x40b47d)
  useEffect(() => {
    const ctx = statusCanvas.current?.getContext('2d');
    if (!ctx) return;
    run(() => {
      const { state } = shown; // 연출 중에는 타격마다 바뀐 HP
      const unit = infoCell ? state.units.findIndex((u) => u && u.x === infoCell.x && u.y === infoCell.y) : -1;
      const view: StatusView = { state, cursor: infoCell, unit: unit >= 0 ? unit : null, water: stage.water, time: timeView() };
      statusView.current = view;
      if (statusWindow.current) statusWindow.current.update({ ...view, pose: view.unit !== null ? stage.poseOf(view.unit) : undefined });
      else statusWindow.current = new StatusWindow({ exe, read, art, data, mapLabel: readMapLabel(exe, setup.map) }, view);
      ctx.putImageData(new ImageData(toRgba(statusWindow.current.image, battleColors(art, state, stage.shade, stage.flash, stage.shadeTime)), STATUS_W, STATUS_H), 0, 0);
    });
  }, [shown, infoCell, art, data, exe, read, setup.map, run]);

  const field = (e: MouseEvent) => [Math.floor(e.nativeEvent.offsetX / scaleOf(zoom)), Math.floor(e.nativeEvent.offsetY / scaleOf(zoom))] as const;
  // 가상 화면 좌표(팝업 자리)
  const toScreen = (e: MouseEvent) => {
    const r = layer.element?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  };
  // WM_SETCURSOR(0x40f195 → 0x403d04): 마우스가 움직일 때, 그리고 팝업·대화 상자가 생기거나 사라질 때(Windows가 마우스 이동을 보냄) 커서를 고른다.
  // 명령 연출·걷기(단계 0, 0x406d13)는 화살표. 대화 상자 동안도 전장 입력을 막으므로 화살표
  const lastField = useRef<readonly [number, number] | null>(null);
  const setCursor = () => {
    if (canvas.current) canvas.current.style.cursor = cursorStyle(cursorStyles(exe), session && !dialog && !walking && lastField.current ? cursorShape(data, session, ...lastField.current) : null);
  };
  useEffect(setCursor, [session, dialog, walking]);
  const onMove = (e: MouseEvent) => {
    lastField.current = field(e);
    setCursor();
    if (!session || dialog || walking || !ready) return;
    const s = pointer(data, session, ...field(e), (e.buttons & 1) !== 0);
    const moved = s.cursor?.x !== session.cursor?.x || s.cursor?.y !== session.cursor?.y;
    if (!moved && s.moved === session.moved) return; // 바뀐 것이 없으면 다시 그리지 않는다
    if (moved) stage.pointer(s.cursor); // 0x403d7b: 커서 프레임 0
    if (moved && s.phase === 1) setStatus(cursorStatus(data, texts, s) ?? ''); // 커서 칸 설명(0x403d7b → 0x403bde)
    if (moved && s.cursorOn && s.cursor) setInfoCell(s.cursor);
    setGame({ ...game, session: s });
  };
  const onDown = (e: MouseEvent) => {
    if (!session || dialog || walking || !ready) return;
    const at = toScreen(e);
    if (e.button === 0) {
      const step = press(data, session, ...field(e));
      take(step, at);
      // 단계 8에서 칸을 누름 → 가상 배치(0x405a6e)가 정보 창을 커서 칸으로(0x40aefd)
      if (session.phase === 8 && step.session.phase === 7 && step.session.cursor) setInfoCell(step.session.cursor);
    }
    else if (e.button === 2) take(pressRight(data, session, ...field(e)), at);
  };
  // 범위 보기 진입(단계 9~0xf는 0x404d69~0x405083이 직접, 단계 8은 0x4048a7의 0x403b10(1, 1)이 커서를 켜며): 정보 창을 커서 칸으로(0x40aefd)
  const viewRange = (step: Step) => {
    if (walking || !ready) return;
    take(step);
    if (step.session.phase >= 8 && step.session.cursor) setInfoCell(step.session.cursor);
  };
  const menuItem = (item: number) => {
    if (!session || walking) return;
    const side = unitOf(session.moved, session.actor).side;
    if (item === 2 && session.actor < MASTERS) openInfo({ kind: 'magic', list: actionsOf(data, session.moved, session.actor).spells, choice: null, texts: {}, picture: null }); // 0x41a528 경우 2
    else if (item === 3) openInfo({ kind: 'summon', side, choice: null, level: 0, light: lightNow(), texts: {}, picture: null }); // 경우 3(진영 +0x38 전부)
    else take(chooseMenu(data, session, item + 1));
  };

  // 정보 대화 상자 ----------------------------------------------------------------
  const lightNow = () => lightPhase(game.result.state.timeOfDay, map.header); // 0x402272
  // 열기: 효과음 1(0x41a528·0x405f5a·0x444980), 초기화가 어두운 칸을 기본 팔레트로(0x402902). 팝업은 숨는다(0x419cea)
  const openInfo = (d: Info) => {
    sound.call(['ui', 1]);
    stage.setShade('base', game.result.state.timeOfDay);
    setStack((s) => [...s, d]);
  };
  const replaceTop = (d: Info) => setStack((s) => [...s.slice(0, -1), d]);
  // 0x444ec8: 미리보기 칸을 앞 글 위에, 그림은 페이지 0x2e6(0x4227d5)
  const fillNatial = (d: NatialDialog, type: number): NatialDialog => ({
    ...d,
    choice: type,
    texts: { ...d.texts, ...natialInfo(infoTables, type, d.level, d.light) },
    picture: unitPortrait(art, type + 0x1a, d.side, NATIAL_PAGE),
  });
  // 0x4258ca
  const fillMagic = (d: MagicDialog, action: number): MagicDialog => ({ ...d, choice: action, texts: { ...d.texts, ...magicInfo(infoTables, action) }, picture: magicPicture(art, action) });
  // 유닛 메뉴 Detail Info(0x405f5a): 네이티얼은 0x7f(지금 레벨·밝기로 채워 연다), 마스터는 진영 레코드로 0x80
  const detailInfo = (s: NonNullable<typeof session>) => {
    const u = unitOf(s.base, s.selected!);
    if (s.selected! >= MASTERS) return openInfo(fillNatial({ kind: 'natial', side: u.side, choice: null, level: u.level as Level, light: lightNow(), texts: {}, picture: null }, u.type));
    const record = s.base.sides[u.side];
    openInfo({ kind: 'master', side: u.side, texts: masterInfo(infoTables, record), picture: unitPortrait(art, record.master, u.side, MASTER_PAGE) });
  };
  // 가장 안쪽 대화 상자 닫기(0x41b83e → 부모에 1000): 0x80은 도움말을 마스터 설명으로(0x444980), 명령 메뉴 팝업은 다시 보이며 "Choose your action."(0x41a479)
  const closeTop = (...sounds: number[]) => {
    for (const n of sounds) sound.call(['ui', n]);
    const [top, parent] = [stack.at(-1), stack.at(-2)];
    setStack((s) => s.slice(0, -1));
    if (parent?.kind === 'master' && session) setStatus(masterText(texts, parent.side, session.base.sides[parent.side].master));
    else if (!parent && top?.kind !== 'close' && session?.phase === 3) setStatus(exe.cString(CHOOSE_ACTION));
  };
  const infoValues = (d: Info): DialogValues => {
    if (d.kind === 'master') return { texts: d.texts };
    if (d.kind === 'magic' || d.kind === 'magicList') {
      return { texts: d.texts, lists: { 1402: { items: d.list.map((a) => infoTables.actionNames[a] ?? ''), selected: d.choice === null ? null : d.list.indexOf(d.choice) } } };
    }
    const on = d.kind !== 'summon' && d.choice !== null; // 0x444c2b: 켬 허용(0x6f는 0)과 유닛
    const r = infoRadios(d.level, d.light, on, on && natialOf(data.natials, d.choice!).lightPreference !== 0 && map.header.lightChanges);
    const v = { texts: d.texts, checked: r.checked, disabled: new Set(r.disabled) };
    if (d.kind === 'natial' || !session) return v;
    const list = session.base.sides[d.side].natials;
    return { ...v, lists: { 1403: { items: list.map((t) => natialOf(data.natials, t).name), selected: d.choice === null ? null : list.indexOf(d.choice) } } };
  };
  const infoCommand = (d: Info, id: number, code: 'click' | 'select' | 'double' | 'update', k?: number) => {
    if (!session) return;
    const listOf = (n: NatialDialog) => session.base.sides[n.side].natials;
    if (code === 'select') {
      sound.call(['ui', 0]); // 선택이 바뀐 경우만(0x44589e·0x4258ca, DialogBox는 같은 줄을 보내지 않는다)
      if (d.kind === 'magic' || d.kind === 'magicList') {
        replaceTop(fillMagic(d, d.list[k!]));
        setStatus(exe.cString(u32(exe, MAGIC_HELP + d.list[k!] * 4))); // 0x424fd5
      } else if (d.kind === 'summon' || d.kind === 'summonList') {
        const type = listOf(d)[k!];
        replaceTop(fillNatial(d, type));
        setStatus(texts.natials[type]); // 0x424fa7
      }
      return;
    }
    if (id === 2) return closeTop(2); // Cancel·Close·X·Esc(0x41ba4d)
    const command = d.kind === 'magic' || d.kind === 'summon';
    if (code === 'double' && !command) return; // 0x81·0x82 처리기는 두 번 누름을 보지 않는다
    if (code === 'double' || id === 1) {
      if (d.kind === 'natial' || d.kind === 'master') return closeTop(1); // Enter = IDOK, 값 검사 늘 1
      const choice = code === 'double' ? (d.kind === 'magic' ? d.list[k!] : listOf(d as NatialDialog)[k!]) : d.choice;
      if (choice === null) return code === 'click' ? void sound.call(['ui', 3]) : undefined; // 값 검사 실패
      if (!command) return closeTop(1);
      return take(chooseMenu(data, session, d.kind === 'magic' ? 3 : 4, choice)); // 팝업에 0x4b0·0x4b1(대화 상자 쪽 소리 없음, 스스로 닫지 않음)
    }
    if (id >= 3015 && id <= 3020 && 'level' in d) {
      // 레벨·밝기 라디오(0x4452d7): 바뀌면 소리 0과 다시 채우기
      const level = id <= 3017 ? ((id - 3015) as Level) : d.level;
      const light = id > 3017 ? (LIGHT_RADIOS.indexOf(id as (typeof LIGHT_RADIOS)[number]) as Light) : d.light;
      if (level === d.level && light === d.light) return;
      sound.call(['ui', 0]);
      const next = { ...d, level, light };
      return replaceTop(next.choice === null ? next : fillNatial(next, next.choice));
    }
    if (d.kind === 'master' && id === 3007) openInfo({ kind: 'magicList', list: session.base.sides[d.side].spells, choice: null, texts: {}, picture: null });
    if (d.kind === 'master' && id === 3008) openInfo({ kind: 'summonList', side: d.side, choice: null, level: 0, light: lightNow(), texts: {}, picture: null });
  };

  const menuPos = menuAt && {
    left: Math.max(0, Math.min(menuAt.x - MENU_W / 2, layer.size.width - MENU_W)),
    top: Math.max(0, Math.min(menuAt.y + MENU_GAP, layer.size.height - MENU_H)),
  };
  // 쌓인 대화 상자의 자리: 템플릿 (0, 0)이라 클라이언트가 부모(팝업, 또는 부모 대화 상자) 클라이언트 원점에(끌어 옮겼으면 옮긴 자리). 0x84만 가운데(0x41b918)
  const placed = (() => {
    let origin: Point = menuPos ? { x: menuPos.left, y: menuPos.top } : { x: 0, y: 0 };
    return stack.map((d, i) => {
      const size = dialogLayout(dialogs[TEMPLATE[d.kind]], WIN98, layer.size).outer;
      const at = centered(d.kind) ? centerDialog(null, size, layer.size) : placeDialog(origin, size, WIN98, layer.size);
      const moved = dialogMoved.current[i];
      origin = { x: at.x + (moved?.x ?? 0) + WIN98.dlgFrame, y: at.y + (moved?.y ?? 0) + WIN98.dlgFrame + WIN98.caption };
      return at;
    });
  })();
  const popupHidden = stack.some((d) => !centered(d.kind));
  // 전장 창 닫기·Turn to Title(0x401bd8): 저장할 수 있으면(0x407823: 사람 입력 세션, 걷기·연출 중이 아님) 대화 상자 0x84(Save·Surrender·Cancel),
  // 아니면 ABORT_QUESTION(예/아니오)
  const canSave = () => session !== null && !walking && !over.current;
  const askClose = () => !dialog && setStack([{ kind: canSave() ? 'close' : 'abort' }]);
  // 전투를 끝내고 나간다(0x401bd8 정리: 자동 저장 SV080을 지운다)
  const exitTo = useRef<'world' | 'title'>('world'); // 닫기를 부른 곳(전장 창 X는 월드)
  const leave = () => {
    deleteSave(AUTOSAVE_FILE);
    onExit(game.memory.seed, exitTo.current, windowPlaces());
  };
  // vmv2.exe 0x00441e36: 고른 칸에 저장(덮어쓰기 확인 없음). 쓰면 전투가 끝나고, 못 쓰면 "Writing failed." 뒤 전투로
  const saveTo = (slot: number) => {
    const block = continueBlock(withTime(game.result.state), windowPlaces(), readSlotIds()[slot]);
    if (writeSave(CONTINUE_FILE + slot, encodeSaveFile(block))) leave();
    else setStack([{ kind: 'writeError' }]);
  };
  const slotRows = useMemo(() => (stack.some((d) => d.kind === 'slots') ? continueRows(exe, read) : []), [stack, exe, read]);
  const closeRequest = useRef(panes.close);
  useEffect(() => {
    if (closeRequest.current === panes.close) return;
    closeRequest.current = panes.close;
    exitTo.current = panes.exitTo;
    if (ending) {
      // 결과 창(0x408034 → 월드, 0x407ff9 → 타이틀. 시나리오면 버릴지 묻는다)
      if (panes.exitTo === 'title' && titlePrompt('result', setup.battle?.scenario !== undefined)) return setStack([{ kind: 'abandon' }]);
      return onExit(game.memory.seed, panes.exitTo, windowPlaces(), panes.exitTo === 'world' ? outcome() : undefined);
    }
    askClose();
  }, [panes.close]);

  // 전투 끝(0x401ec3): 마지막 상태를 그린 뒤 알림판, 닫히면 전장·정보·미니맵 창을 닫고 도움말 문구를 비운 뒤 결과 창(0x40216b → 0x401bd8(0) → 0x407d43)
  const finish = (winner: number, state: GameState, won: boolean) => {
    deleteSave(AUTOSAVE_FILE); // 0x40216b → 0x401bd8(0) → 0x44206d
    setStack([]);
    setMenuAt(null);
    setStatus('');
    setEnding({ winner, state, won });
    onScene(SCENE.result);
  };
  useEffect(() => {
    const r = game.result;
    if (!('winner' in r) || over.current) return;
    over.current = true;
    const end = battleEndText(exe, r.state, r.winner);
    onMusic(end.won ? 2 : 3);
    setNotice({ text: end.text, then: () => finish(r.winner, r.state, end.won) });
  }, [game.result]);
  // Give up(0x401d5b): 확인 뒤(답과 상관없이 소리 1) 항복 진영(0x401df5: 사람 진영, 둘이면 차례 유닛 진영) → "<이름> has surrendered" → 결과 창
  const giveUpRequest = useRef(panes.giveUp);
  useEffect(() => {
    if (giveUpRequest.current === panes.giveUp) return;
    giveUpRequest.current = panes.giveUp;
    if (over.current || ending || stack.some((d) => d.kind === 'giveup')) return;
    setStack((s) => [...s, { kind: 'giveup' }]);
  }, [panes.giveUp]);
  const surrender = () => {
    if ('winner' in game.result) return;
    const state = shownState.current;
    const humans = [0, 1].filter((s) => state.sideStates[s].controller === 0);
    const side = humans.length === 1 ? humans[0] : unitOf(game.result.state, game.result.actor).side;
    over.current = true;
    timer.current = null;
    setWalking(null);
    setStack([]);
    setMenuAt(null);
    const end = battleEndText(exe, state, 1 - side, side);
    onMusic(end.won ? 2 : 3);
    setNotice({ text: end.text, then: () => finish(1 - side, state, end.won) });
  };
  const resultArt = useMemo(() => ending && loadResultArt(exe, read, ending.state.sides), [ending, exe, read]);
  const resultBase = useMemo(() => ending && resultPalette(read, battlePalette(art, ending.state, stage.shade, stage.shadeTime)), [ending, art, read]);
  const resultColors = useMemo(() => resultBase && dibColors(resultBase), [resultBase]);
  // 0x4080ac: 시나리오(블록 +0x8)에서 이겼으면 쪽 5(레벨 업·고른 맵 +0x2d4의 보상)
  const levelUp = useMemo(() => {
    if (!ending?.won || !readScenario(ending.state.raw)) return null;
    const selected = new DataView(ending.state.raw.buffer, ending.state.raw.byteOffset).getInt32(0x2d4, true);
    return resultLevelUp({ masters: readMasterTable(exe), ...readScenarioData(exe) }, ending.state.sides[0], selected);
  }, [ending, exe]);
  // 0x408034가 읽는 것: 이긴 진영과 통계(tallyOf)
  const outcome = (): BattleOutcome | undefined => (ending && resultBase ? { winner: ending.winner, tally: tallyOf(ending.state), palette: resultBase } : undefined);
  return (
    <div className="battle-window">
      {!ending && (
        <MdiChild
          title={exe.cString(TITLES.battle)}
          kind="sizable"
          scroll
          {...child('battle')}
          onClose={() => {
            exitTo.current = 'world'; // 0x40ea8e → 0x44fd31
            askClose();
          }}
          clientRef={(el) => (scroller.current = el)}
        >
          <canvas ref={canvas} width={zoom === 0 ? FIELD_W / 2 : FIELD_W} height={zoom === 0 ? FIELD_H / 2 : FIELD_H} style={{ width: FIELD_W * scaleOf(zoom), height: FIELD_H * scaleOf(zoom) }} data-ticks={ticks} onMouseMove={onMove} onMouseDown={onDown} onContextMenu={(e) => e.preventDefault()} />
        </MdiChild>
      )}
      {!ending && panes.status && (
        <MdiChild title={exe.cString(TITLES.status)} kind="fixed" {...child('status')} onClose={() => onPanes((p) => ({ ...p, status: false }))}>
          <canvas className="battle-info" ref={statusCanvas} width={STATUS_W} height={STATUS_H} />
        </MdiChild>
      )}
      {panes.help && (
        <MdiChild title={exe.cString(TITLES.help)} kind="fixed" {...child('help')} onClose={() => onPanes((p) => ({ ...p, help: false }))}>
          <canvas ref={helpCanvas} width={HELP_W} height={HELP_H} aria-label={htmlText(status)} />
        </MdiChild>
      )}
      {!ending && panes.view && (
        <MdiChild title={exe.cString(TITLES.view)} kind="fixed" {...child('view')} onClose={() => onPanes((p) => ({ ...p, view: false }))}>
          <canvas ref={viewCanvas} width={MINIMAP_W} height={MINIMAP_H} onPointerDown={pressView} onPointerMove={dragView} onPointerUp={() => (viewDragging.current = false)} />
        </MdiChild>
      )}
      {ending && resultArt && resultColors && (
        <ResultWindow art={resultArt} state={ending.state} winner={ending.winner} levelUp={levelUp} colors={resultColors} client={client} metrics={WIN98} sound={sound} paused={modal} onEnd={() => onExit(game.memory.seed, 'world', windowPlaces(), outcome())} />
      )}
      {layer.element &&
        createPortal(
          <>
            {notice && (
              <NoticeBoard
                key={notice.id}
                text={notice.text}
                chips={art.sheet.chips}
                glyphs={glyphs}
                colors={battleColors(art, shownState.current, stage.shade, stage.flash, stage.shadeTime)}
                screen={layer.size}
                onClose={() => {
                  setNotice(null);
                  notice.then();
                }}
              />
            )}
            {session?.phase === 3 && menuPos && (
              <canvas
                className="battle-menu"
                ref={menuCanvas}
                width={MENU_W}
                height={MENU_H}
                style={{ ...menuPos, visibility: popupHidden ? 'hidden' : undefined }}
                onMouseMove={(e) => setHover(menuItemAt(menuEnabled(data, session), e.nativeEvent.offsetX, e.nativeEvent.offsetY))}
                onMouseLeave={() => setHover(-1)}
                onMouseDown={(e) => {
                  if (dialog) return;
                  if (e.button === 2) return take(chooseMenu(data, session, 0));
                  const item = e.button === 0 ? menuItemAt(menuEnabled(data, session), e.nativeEvent.offsetX, e.nativeEvent.offsetY) : -1;
                  if (item >= 0) menuItem(item);
                }}
                onContextMenu={(e) => e.preventDefault()}
              />
            )}
            {session?.phase === 7 && menuPos && (
              <ul
                className="battle-unit-menu"
                style={{ ...menuPos, visibility: popupHidden ? 'hidden' : undefined }}
                onContextMenu={(e) => (e.preventDefault(), !dialog && take(pressRight(data, session, 0, 0)))}
              >
                {unitLabels.map((label, i) => {
                  const on = unitMenuEnabled(data, session)[i];
                  return (
                    <li key={i} className={on ? 'on' : 'off'} onClick={() => !dialog && on && (i === DETAIL_INFO ? detailInfo(session) : viewRange(chooseUnitMenu(data, session, i)))}>
                      {htmlText(label)}
                    </li>
                  );
                })}
              </ul>
            )}
            {(dialog || error) && (
              <div
                className="battle-backdrop"
                onContextMenu={(e) => {
                  e.preventDefault();
                  // 전장 오른쪽 누름(0x4045ee·0x405c74·0x405e1d 효과음 2 두 번 → 0x419d46): 팝업에 붙은 가장 안쪽 대화 상자만 닫는다
                  if (dialog && !centered(dialog.kind) && (session?.phase === 3 || session?.phase === 7)) closeTop(2, 2);
                }}
              />
            )}
            {stack.map((d, i) => {
              const box = { dialog: dialogs[TEMPLATE[d.kind]], at: placed[i], metrics: WIN98, enabled: i === stack.length - 1, onMoved: (p: Point) => void (dialogMoved.current[i] = p) };
              if (d.kind === 'close') {
                return (
                  <DialogBox
                    key={i}
                    {...box}
                    values={{ texts: { 3022: exe.cString(SAVE_QUESTION) } }}
                    onCommand={(id) => {
                      if (id === 2) return closeTop(2);
                      if (id === 1) {
                        sound.call(['ui', 1]); // 0x42e897: Save → 슬롯 대화 상자(0x84는 닫힘)
                        return setStack([{ kind: 'slots' }]);
                      }
                      if (id !== SURRENDER) return;
                      sound.call(['ui', 1]);
                      leave();
                    }}
                  />
                );
              }
              if (d.kind === 'slots') {
                return <SlotDialog key={i} dialog={box.dialog} rows={slotRows} mode="save" at={box.at} metrics={WIN98} sound={sound} onClose={(slot) => (slot === null ? setStack([]) : saveTo(slot))} />;
              }
              if (d.kind === 'abort' || d.kind === 'abandon') {
                return (
                  <DialogBox
                    key={i}
                    {...box}
                    onCommand={(id) => {
                      if (id !== IDYES && id !== IDNO) return;
                      sound.call(['ui', 1]); // 0x42e7f7
                      if (id === IDYES) leave();
                      else setStack([]);
                    }}
                  />
                );
              }
              if (d.kind === 'writeError') return <DialogBox key={i} {...box} onCommand={(id) => (id === IDOK || id === 2) && setStack([])} />;
              if (d.kind === 'giveup') {
                return (
                  <DialogBox
                    key={i}
                    {...box}
                    onCommand={(id) => {
                      if (id !== IDYES && id !== IDNO) return;
                      sound.call(['ui', 1]); // 0x42e7f7: 답과 상관없이
                      if (id === IDYES) surrender();
                      else setStack((s) => s.filter((k) => k.kind !== 'giveup'));
                    }}
                  />
                );
              }
              if (d.kind === 'mp') return <DialogBox key={i} {...box} onCommand={(id) => (id === 1 || id === 2) && closeTop(1)} />;
              if (d.kind === 'confirm') {
                return (
                  <DialogBox
                    key={i}
                    {...box}
                    onCommand={(id) => {
                      if (id === 2) return closeTop(2);
                      if (id === 1 && session) take(confirmDestruction(data, session)); // OK는 소리 없이 0x405f13(효과음 1)
                    }}
                  />
                );
              }
              const magic = d.kind === 'magic' || d.kind === 'magicList';
              const size = magic ? MAGIC : PORTRAIT;
              const rect = fitPicture(magic ? MAGIC_RECT : d.kind === 'summon' || d.kind === 'summonList' ? LIST_PORTRAIT_RECT : PORTRAIT_RECT, size);
              return (
                <DialogBox key={i} {...box} values={infoValues(d)} onCommand={(id, code, k) => infoCommand(d, id, code, k)}>
                  {d.picture && <Picture image={d.picture} size={size} rect={rect} colors={battleColors(art, game.result.state, stage.shade, stage.flash, stage.shadeTime)} />}
                </DialogBox>
              );
            })}
          </>,
          layer.element,
        )}
      {error &&
        layer.element &&
        createPortal(
          <div className="battle-dialog battle-error" role="alert">
            <p>{error}</p>
            <button type="button" onClick={() => onExit(game.memory.seed, 'title', {})}>
              처음으로
            </button>
          </div>,
          layer.element, // 가상 화면 안에
        )}
    </div>
  );
}
