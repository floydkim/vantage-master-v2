import { useEffect, useMemo, useState } from 'react';
import '../assetViewer/assetViewer.css';
import { readMenu } from '../../formats/menus.ts';
import { Desktop } from '../frame/Desktop.tsx';
import { type FrameContext, frameTitle, type MenuFlags, menuState, SCENE, WIN98 } from '../frame/frame.ts';
import { FrameWindow, iconUrl } from '../frame/FrameWindow.tsx';
import { LaunchIcon } from '../frame/LaunchIcon.tsx';
import { BattleWindow } from './BattleWindow.tsx';
import { decodeState } from '../../engine/state.ts';
import { freeModeSides } from '../../engine/battleStart.ts';
import { MASTER_COUNT, readFreeModeNames, readMasterTable } from '../../formats/masterTable.ts';
import type { ThinkingPattern } from '../../ai/think.ts';
import { WorldScene, type WorldSettings } from '../world/WorldScene.tsx';
import { readWindows, type WindowPlaces } from './continueData.ts';
import { freeBattlePanes } from './windowState.ts';
import { bgmDevices, fallbackDevice, OPT, readOptions, savedDevice, writeOptions } from '../frame/options.ts';
import { Bgm, readBgmTable } from '../sound/bgm.ts';
import { RecordingDevice } from '../sound/recordingPlayer.ts';
import { MidiDevice } from '../sound/midiPlayer.ts';
import { type OptionDialog, OptionDialogs } from '../frame/OptionDialogs.tsx';
import { GameDataDialog, LeaveWorldDialog } from './GameDataDialog.tsx';
import { gameDataBlock, savedPlaces, worldFromGameData } from './gameData.ts';
import { type GameSetup, seedFromClock } from './game.ts';
import { language, loadOriginal, type Original } from './original.ts';
import { detectOrigin, type Origin } from '../../originals/source.ts';
import { idbStore } from '../../originals/store.ts';
import { SetupWizard } from '../setup/SetupWizard.tsx';
import { Sound, webPlayer } from './sound.ts';
import { TitleScreen } from '../title/TitleScreen.tsx';
import { MasterMakingWindow } from '../master/MasterMaking.tsx';
import { SceneWindow } from '../scene/SceneWindow.tsx';
import type { ScenePlayer } from '../scene/engine.ts';
import { afterBattle, titlePrompt } from '../world/scenarioFlow.ts';
import { titleBase } from '../master/makeMaster.ts';
import { loadTitleArt } from '../title/titleArt.ts';
import { readScenario, readScenarioData, type ScenarioMode, scenarioBlock } from '../../engine/scenario.ts';

// 원작은 시작 때 한 번 시드를 두고(0x452ecf) 판을 넘어 난수 상태를 이어 간다
const APP_SEED = seedFromClock(new Date());

/** 지금 옮긴 메뉴 명령. 나머지는 각 계획에서(그때까지 회색) */
const READY = new Set([0x9c7b, 0x9c7c, 0x9c7e, 0x9c80, 0x9c81, 0x9c82, 0x9c5b, 0x9c5c, 0x9c7d, 0x9c7f, 0x9c43, 0x9c44, 0x9c45]);

/** 전투 장면이 켜고 끄는 창과 다시 배치 요청 */
export interface Panes {
  readonly status: boolean;
  readonly help: boolean;
  /** 미니맵(View) */
  readonly view: boolean;
  /** 전장 확대(0x40e762): 0 x /2, 1 x 1, 2 x 2 */
  readonly zoom: 0 | 1 | 2;
  /** Window arrange(0x40e4cd)를 누를 때마다 늘어난다 */
  readonly arranged: number;
  /** Turn to Title·Turn of World Map(전투 0x401bd8 닫기 확인, 결과 창 0x408034)을 누를 때마다 늘어난다 */
  readonly close: number;
  /** 마지막 닫기 요청이 가는 곳: Turn of World Map은 월드, Turn to Title은 타이틀 */
  readonly exitTo: 'world' | 'title';
  /** Give up(0x9c82 → 0x401d5b)을 누를 때마다 늘어난다 */
  readonly giveUp: number;
}

const CLOSE_CONFIRM = '게임을 끝내고 바탕 화면으로 돌아갈까요? 저장하지 않은 진행은 사라질 수 있습니다.';

/** #play: 가상 화면 안의 원작 프레임. 타이틀(장면 1: FALCOM.AVI·오프닝·메뉴) → 월드 장면(장면 3) → 전투(4)·결과 창(5) → 월드 */
export function Play() {
  const [original, setOriginal] = useState<Original | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [setup, setSetup] = useState<GameSetup | null>(null);
  const [seed, setSeed] = useState(APP_SEED);
  const [panes, setPanes] = useState<Panes>({ status: true, help: true, view: true, zoom: 1, arranged: 0, close: 0, exitTo: 'world', giveUp: 0 });
  // 월드 장면의 설정(블록: 고른 맵, 진영 레코드, 조종, 시간 제한). null이면 타이틀(시작 화면)
  const [world, setWorld] = useState<WorldSettings | null>(null);
  // Master making(장면 2)의 모드. 시나리오(0x5061d8)면 난이도(0x5061cc), 프리면 null
  const [making, setMaking] = useState<ScenarioMode | null>(null);
  // 장면 창(장면 6): 결과 창 END(0x408034)의 장면 종류, 우리 진영·통계, 창 팔레트 base(결과 창). 개발용 진입 ?scene=종류,마스터[,ED 번호]#play
  const [scene6, setScene6] = useState<{ kind: number; index: number; player: ScenePlayer; base: Uint8Array | null } | null>(() => {
    const q = import.meta.env.DEV ? new URLSearchParams(location.search).get('scene') : null;
    if (!q) return null;
    const [kind, master = 0, index = 0] = q.split(',').map(Number);
    // 종류 0~6, 마스터 0~26, ED 번호는 엔딩(6)만 0~0x1b. 그 밖은 무시하고 타이틀
    if (![kind, master, index].every(Number.isInteger) || kind < 0 || kind > 6 || master < 0 || master >= MASTER_COUNT || index < 0 || index > (kind === 6 ? 0x1b : 0)) return null;
    const stats = new Array<number>(59).fill(0).map((_, k) => (k * 7) % 50);
    return { kind, index, player: { name: 'Floyd', master, natials: [1, 7, 13, 22], spells: [10], stats }, base: null };
  });
  // 옵션 word(0x503ff0)와 BGM 장치(0x4cd688): 저장소 SaveDataKey·BGM Device. 생각 방식은 비트 8(전투 시작·되살리기 때 읽음)
  const [opts, setOpts] = useState(readOptions);
  const pattern: ThinkingPattern = opts.options & OPT.noGuard ? 'noGuard' : 'standard';
  const [optionDialog, setOptionDialog] = useState<OptionDialog | null>(null); // 모달: 열린 동안 월드·전투 콜백이 멈춘다
  const [savingGameData, setSavingGameData] = useState(false); // Save GameData(0x441aea) 대화 상자 0x78
  const [leavingWorld, setLeavingWorld] = useState(false); // 시나리오 월드 → 타이틀의 묻기(0x451bbb(1) → 0x42e92b)
  const [scene, setScene] = useState<number>(SCENE.battle); // 전투 4 → 결과 창 5
  const [resume, setResume] = useState<Uint8Array | null>(null); // 되살릴 저장 블록
  // 블록의 창 구간(+0x268~+0x2d3): 장면을 오가도 남는다. Free Battle(0x45102d)이 비운다(월드 배치, 전장 확대 −1)
  const [places, setPlaces] = useState<WindowPlaces>({});
  const [traceAsked, setTraceAsked] = useState(false); // 시작 때 SV080 질문(WinMain 0x441fd3)은 한 번
  const [opening, setOpening] = useState(true); // FALCOM.AVI는 앱을 처음 열 때만(0x425fcd). 타이틀로 돌아올 때(0x425fa0)는 없다
  const [quit, setQuit] = useState(false); // Quit: 프레임을 없앤다(0x4261f7 → DestroyWindow(프레임))
  // 원본 출처(서버 먼저, 다음 브라우저 저장소). 없으면 설치 마법사, [원본 파일…]로 다시 열기
  const store = useMemo(() => idbStore(), []);
  const [origin, setOrigin] = useState<Origin | null>(null);
  const [wizard, setWizard] = useState(false);
  const [launched, setLaunched] = useState(false); // 바탕화면 아이콘으로 실행하기 전(사용자가 눌러야 브라우저가 소리를 낸다)
  const [devices, setDevices] = useState(() => bgmDevices(null)); // 쓸 수 있는 BGM 장치(Sound 대화 상자 라디오 차례)
  useEffect(() => {
    void detectOrigin(store).then((o) => {
      setOrigin(o);
      if (o === 'none') return;
      // 저장소 목록(쓸 수 있는 BGM 장치)과 원본을 함께 읽는다. 원본 읽기가 실패하면 목록을 기다리지 않고 오류
      const devices = o === 'stored' ? store.paths().then(bgmDevices, () => bgmDevices([])) : Promise.resolve(bgmDevices(null));
      loadOriginal().then(
        async (loaded) => {
          // BGM을 만들기 전에: 저장된 장치를 쓸 수 없으면(CD 음악을 빼고 다시 넣음 등) 이번 실행은 첫 쓸 수 있는 장치로. 저장된 선택은 그대로(다시 넣으면 그 장치)
          const d = await devices;
          setDevices(d);
          setOpts((p) => ({ ...p, device: fallbackDevice(p.device, d) }));
          setOriginal(loaded);
        },
        (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
      );
    });
  }, [store]);
  const chrome = useMemo(() => {
    if (!original) return null;
    // BGM(0x443770): 브라우저 MIDI(spessasynth), CD 음원·SC-88 녹음(pnpm import-cd-audio). 옵션·장치는 처음 저장소 값, 바뀌면 Sound OK가 알린다
    const table = readBgmTable(original.exe);
    const midi = new MidiDevice(table);
    const cd = new RecordingDevice(table, 'CDDA');
    const sc88 = new RecordingDevice(table, 'SC88');
    const bgm = new Bgm(table, { cd, midi, sc88 }, opts.options, opts.device);
    midi.onEnded = () => bgm.ended(bgm.device === 1 || bgm.device === 2); // 0x443847: 지금 장치에서 온 알림만
    cd.onEnded = () => bgm.ended(bgm.device === 0);
    sc88.onEnded = () => bgm.ended(bgm.device === 3);
    for (const d of [midi, cd, sc88]) d.onFailed = (track) => bgm.failed(track);
    if ((opts.options & OPT.bgm) !== 0 && (opts.device === 1 || opts.device === 2)) midi.prefetch(); // 사운드폰트(32MB)를 첫 곡 전에 받기 시작
    if (import.meta.env.DEV) (window as unknown as { __vmv2Bgm?: Bgm }).__vmv2Bgm = bgm; // 브라우저 확인용
    return { icon: iconUrl(original.exe), launchIcon: iconUrl(original.exe, 32), menu: readMenu(original.exe, 0x66), sound: new Sound(original.exe, webPlayer(original.dat13)), bgm };
  }, [original]);
  useEffect(() => {
    if (chrome) chrome.sound.effects = (opts.options & OPT.effects) !== 0; // 대화 상자가 닫힌 뒤 적용(OK 소리는 옛 비트)
  }, [chrome, opts.options]);
  // 월드 장면(0x4516f4)은 BGM 1. 결과 창 뒤·게임 데이터 읽기 뒤에도
  const inWorld = world !== null && setup === null && scene6 === null && !quit;
  useEffect(() => {
    if (inWorld) chrome?.bgm.play(1);
  }, [inWorld, chrome]);
  // 저장된 원본을 읽지 못하면(빠졌거나 깨짐) 까닭과 함께 마법사로 다시 넣게 한다. 서버 출처(개발)는 안내 한 줄
  if (error) return origin === 'stored' ? <Desktop>{() => <SetupWizard store={store} problem={error} onDone={() => location.reload()} />}</Desktop> : <p role="alert">{error}</p>;
  if (origin === 'none') return <Desktop>{() => <SetupWizard store={store} onDone={() => location.reload()} />}</Desktop>;
  if (!original || !chrome) return <p>원본을 읽는 중…</p>;
  const ctx: FrameContext = {
    scene: setup ? scene : scene6 ? SCENE.ending : world ? SCENE.world : making !== null ? SCENE.masterMake : SCENE.title,
    network: false,
    scenario: making ?? world?.scenario?.mode ?? null, // 블록 +0x8·+0xc(프레임 제목의 모드)
    human: (setup?.battle?.controllers ?? [0]).includes(0), // Give up은 사람 진영이 있을 때(0x4077d9)
    zoom: panes.zoom,
    view: panes.view,
    status: panes.status,
    help: panes.help,
    chat: false,
  };
  const flags: Record<number, MenuFlags> = Object.fromEntries(Object.entries(menuState(ctx)).map(([id, f]) => [id, { ...f, enabled: f.enabled && READY.has(Number(id)) }]));
  for (const m of chrome.menu.flatMap((top) => top.items ?? [])) if (!READY.has(m.id)) flags[m.id] ??= { enabled: false, checked: false };
  const modal = optionDialog !== null || savingGameData || leavingWorld || wizard; // 마법사(원본 파일…)가 열린 동안도 전투·월드를 멈춘다(제거 중 자동 저장 막기)
  // 월드 → 타이틀(0x451bbb(1)): 시나리오면 게임 데이터를 저장할지 묻는다
  const leaveWorld = () => (titlePrompt('world', world?.scenario !== undefined) ? setLeavingWorld(true) : setWorld(null));
  // 프레임 닫기 단추: 게임을 끝내고 바탕화면으로. 다시 열어 음악·타이머·상태를 모두 처음으로(언어 바꾸기와 같음). 타이틀은 프레임을 가려 누를 수 없다
  const closeGame = () => {
    if (!modal && window.confirm(CLOSE_CONFIRM)) location.reload(); // 모달 대화 상자가 프레임을 끈다
  };
  const command = (id: number) => {
    if (modal) return; // 모달 대화 상자가 프레임을 끈다
    chrome.sound.call(['ui', 1]); // 메뉴 명령은 거의 모두 효과음 1(0x44e437)
    if (id === 0x9c7e) return setOptionDialog('customize'); // 0x44ee63
    if (id === 0x9c7c) return setOptionDialog('sound'); // 0x443511
    if (id === 0x9c7b) return setSavingGameData(true); // 0x441aea(장면 3만 켬)
    if (id === 0x9c81 || id === 0x9c80) {
      const exitTo = id === 0x9c80 ? 'world' : 'title';
      if (setup || making !== null) setPanes((p) => ({ ...p, close: p.close + 1, exitTo })); // 전투면 닫기 확인, 결과 창이면 닫기, Master making은 닫고 타이틀(0x44e390)
      else leaveWorld();
    }
    else if (id === 0x9c82) setPanes((p) => ({ ...p, giveUp: p.giveUp + 1 }));
    else if (id === 0x9c5c) setPanes((p) => ({ ...p, status: !p.status }));
    else if (id === 0x9c5b) setPanes((p) => ({ ...p, view: !p.view }));
    else if (id >= 0x9c43 && id <= 0x9c45) setPanes((p) => ({ ...p, zoom: (id - 0x9c43) as Panes['zoom'] }));
    else if (id === 0x9c7d) setPanes((p) => ({ ...p, help: !p.help }));
    else if (id === 0x9c7f) setPanes((p) => ({ ...p, arranged: p.arranged + 1 }));
  };
  return (
    <Desktop noKorean={language() === 'ko' && !original.korean} fixes={original.korean} running={launched && !quit} onOriginals={origin === 'stored' ? () => setWizard(true) : undefined}>
      {(screen) => quit ? <div style={{ position: 'absolute', inset: 0, background: '#000' }} /> : (
        <>
        {launched ? (
        <FrameWindow title={frameTitle(original.exe, ctx)} icon={chrome.icon} menu={chrome.menu} flags={flags} onCommand={command} onClose={closeGame} screen={screen} metrics={WIN98}>
          {(client) =>
            setup ? (
              <BattleWindow
                original={original}
                setup={setup}
                seed={seed}
                sound={chrome.sound}
                icon={chrome.icon}
                client={client}
                panes={panes}
                onPanes={setPanes}
                onScene={setScene}
                resume={resume}
                places={places}
                options={opts.options}
                modal={modal}
                onMusic={(track) => chrome.bgm.play(track)}
                onExit={(next, to, p, result) => {
                  setSeed(next);
                  setPlaces(p);
                  setSetup(null);
                  setResume(null);
                  if (to === 'title') return setWorld(null);
                  // 0x408034: 시나리오에서 이겼으면 통계·진행, 장면이면 장면 창(0x41beb4 → 0x41becb)
                  if (!result || !world?.scenario) return;
                  const r = afterBattle({ masters: readMasterTable(original.exe), ...readScenarioData(original.exe) }, world, result.winner, result.tally);
                  setWorld(r.settings);
                  if (r.scene === -1) return;
                  const s0 = r.settings.sides[0];
                  setScene6({ kind: r.scene, index: 0, player: { name: s0.name, master: s0.master, natials: s0.natials, spells: s0.spells, stats: r.settings.scenario!.stats }, base: result.palette });
                }}
              />
            ) : scene6 ? (
              <SceneWindow
                original={original}
                sound={chrome.sound}
                kind={scene6.kind}
                index={scene6.index}
                player={scene6.player}
                base={scene6.base ?? titleBase(loadTitleArt(original.exe, original.read).colors)}
                paused={modal}
                onMusic={(track) => chrome.bgm.play(track)}
                onDone={(to) => {
                  // 장 사이 장면 끝은 월드(0x4516f4), 엔딩·보고서 끝은 타이틀(0x425fa0)
                  setScene6(null);
                  if (to === 'title') {
                    setWorld(null);
                  }
                }}
              />
            ) : world ? (
              <WorldScene
                original={original}
                sound={chrome.sound}
                icon={chrome.icon}
                client={client}
                help={panes.help}
                paused={modal}
                places={places}
                onPlaces={(p) => setPlaces((v) => ({ ...v, ...p }))}
                arranged={panes.arranged}
                settings={world}
                onSettings={setWorld}
                onTitle={leaveWorld}
                onStart={(s, p) => {
                  // 0x4017a2: 장면 4. 전장 자리가 없으면(확대 −1) 0x40e392가 확대 x 1·전투 배치, 있으면 앞 전투 자리·확대 그대로
                  if (!places.battle) setPanes((v) => ({ ...v, zoom: 1 }));
                  setPlaces((v) => ({ ...v, ...p }));
                  setScene(SCENE.battle);
                  setSetup({ map: s.selected, battle: s, pattern });
                }}
              />
            ) : making !== null ? (
              <MasterMakingWindow
                original={original}
                sound={chrome.sound}
                icon={chrome.icon}
                client={client}
                mode={making}
                seed={seed}
                paused={modal}
                close={panes.close}
                onMusic={(track) => chrome.bgm.play(track)}
                onDone={(player, next) => {
                  // 0x45102d: 고른 맵 −1, 시간 제한 ∞, 월드 배치. 진영 1은 맵을 고를 때 0x42d2e9가 채운다(그 전은 자리만)
                  setSeed(next);
                  setMaking(null);
                  setPlaces({});
                  setPanes(freeBattlePanes);
                  const free = freeModeSides({ masters: readMasterTable(original.exe), names: readFreeModeNames(original.exe) });
                  // 0x450da0·0x450e35의 블록: 맵 플래그는 첫 묶음만 열림, 통계 59칸 0(0x41bce9)
                  const block = new DataView(scenarioBlock(making, readScenarioData(original.exe).groups).buffer);
                  const flags = Array.from({ length: 52 }, (_, k) => block.getInt32(0x198 + k * 4, true));
                  setWorld({ sides: [player, free[1]], controllers: [0, 1], timeLimit: 3, selected: -1, scenario: { mode: making, flags, stats: new Array<number>(59).fill(0) } });
                }}
                onTitle={(next) => {
                  setSeed(next);
                  setMaking(null);
                }}
              />
            ) : (
              <TitleScreen
                original={original}
                sound={chrome.sound}
                seed={seed}
                onSeed={setSeed}
                askTrace={!traceAsked}
                onTraceDone={() => setTraceAsked(true)}
                opening={opening}
                onOpeningDone={() => setOpening(false)}
                onQuit={() => {
                  chrome.bgm.close();
                  setQuit(true);
                }}
                onMusic={(track) => chrome.bgm.play(track)}
                onScenario={(mode) => {
                  // 0x450da0·0x450e35: 시나리오 플래그, 첫 묶음, 진영 0 사람·1 CPU → Master making(0x426d90)
                  setTraceAsked(true);
                  setMaking(mode);
                }}
                onFreeBattle={() => {
                  // Free Battle(0x426a3a 경우 2 → 0x450ed7·0x45102d): 기본 진영(0x42d473), 진영 0 사람·1 CPU, 시간 제한 ∞, 고른 맵 없음
                  setTraceAsked(true);
                  setPlaces({});
                  setPanes(freeBattlePanes);
                  const sides = freeModeSides({ masters: readMasterTable(original.exe), names: readFreeModeNames(original.exe) });
                  setWorld({ sides, controllers: [0, 1], timeLimit: 3, selected: -1 });
                }}
                onGameData={(block) => {
                  // 0x44198d → 0x4510b6: 블록 그대로 월드(0x45102d를 거치지 않음: 고른 맵·창 자리·켬·확대가 저장된 대로)
                  const g = worldFromGameData(block);
                  setTraceAsked(true);
                  setPlaces(g.places);
                  setPanes((p) => ({ ...p, help: g.places.flags!.help, status: g.places.flags!.status, view: g.places.flags!.view, zoom: (g.places.zoom! >= 0 && g.places.zoom! <= 2 ? g.places.zoom : p.zoom) as Panes['zoom'] }));
                  setWorld(g.settings);
                }}
                onResume={(block, next) => {
                  setOpening(false); // 되살리면 AVI·타이틀이 없다(0x401899)
                  // 되살리기(0x401899): 블록의 창 켬·확대(−1이면 1), 맵(+0x2d4), 마스터·레벨
                  const state = decodeState(block);
                  const w = readWindows(block);
                  setTraceAsked(true);
                  setPanes((p) => ({ ...p, help: w.flags.help, status: w.flags.status, view: w.flags.view, zoom: (w.zoom >= 0 && w.zoom <= 2 ? w.zoom : 1) as Panes['zoom'] }));
                  setSeed(next);
                  setScene(SCENE.battle);
                  setResume(block);
                  setPlaces(w);
                  // 판이 끝나면 블록의 설정 그대로 월드로(0x44fd31)
                  const v = new DataView(block.buffer, block.byteOffset);
                  const settings: WorldSettings = { sides: [state.sides[0], state.sides[1]], controllers: [state.sideStates[0].controller, state.sideStates[1].controller], timeLimit: state.timeLimit, selected: v.getInt32(0x2d4, true), scenario: readScenario(block) };
                  setWorld(settings);
                  setSetup({ map: settings.selected, battle: settings, pattern });
                }}
              />
            )
          }
        </FrameWindow>
        ) : (
          <LaunchIcon icon={chrome.launchIcon} label="Vantage Master V2" screen={screen} active={!wizard} onOpen={() => setLaunched(true)} />
        )}
        {savingGameData && world && (
          <GameDataDialog
            exe={original.exe}
            mode="save"
            sound={chrome.sound}
            // 0x441960(창 자리)·켬·확대(전장 자리가 아직 없으면 −1) → +0 = 0
            block={() => gameDataBlock(world, savedPlaces(places, panes))}
            onDone={() => setSavingGameData(false)}
          />
        )}
        {leavingWorld && world && (
          <LeaveWorldDialog
            exe={original.exe}
            sound={chrome.sound}
            block={() => gameDataBlock(world, savedPlaces(places, panes))}
            onDone={(leave) => {
              setLeavingWorld(false);
              if (leave) setWorld(null);
            }}
          />
        )}
        {optionDialog && (
          <OptionDialogs
            exe={original.exe}
            which={optionDialog}
            options={opts.options}
            device={opts.device}
            devices={devices}
            scene={ctx.scene}
            sound={chrome.sound}
            onClose={(next) => {
              setOptionDialog(null);
              if (!next) return;
              // 0x443511 OK: 장치가 바뀌면 멈춤·CD 닫기, BGM 비트나 장치가 바뀌면 지금 곡 다시(0x44372e)
              chrome.bgm.soundOk(next.options, next.device, next);
              setOpts({ options: next.options, device: next.device });
              writeOptions(next.options, savedDevice(next.device, opts.device, readOptions().device));
            }}
          />
        )}
        {wizard && <SetupWizard store={store} onDone={() => location.reload()} onCancel={() => setWizard(false)} />}
        </>
      )}
    </Desktop>
  );
}
