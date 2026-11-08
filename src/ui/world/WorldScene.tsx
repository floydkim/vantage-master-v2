import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { FreeBattleSetup } from '../../engine/battleStart.ts';
import { toggleItem } from '../../engine/battleStart.ts';
import { readScenarioData, scenarioEnemy } from '../../engine/scenario.ts';
import type { SideRecord } from '../../engine/state.ts';
import { readMasterTable } from '../../formats/masterTable.ts';
import { loadMap } from '../../formats/mapData.ts';
import { WIN98 } from '../frame/frame.ts';
import { ScreenLayer } from '../frame/Desktop.tsx';
import { dialogLayout } from '../frame/dialogLayout.ts';
import { readDialog } from '../../formats/dialogs.ts';
import { readDescriptions } from '../../formats/descriptions.ts';
import { htmlText } from '../../i18n/hangul.ts';
import { applyEdit, editDialogAt, editOf } from './masterEdit.ts';
import { type Editing, MasterEditDialog } from './MasterEditDialog.tsx';
import { outer, type Point, type Rect, type Size, worldLayout } from '../frame/layout.ts';
import { MdiChild } from '../frame/MdiChild.tsx';
import { HELP_H, HELP_W, HelpWindow } from '../battle/helpWindow.ts';
import type { Original } from '../battle/original.ts';
import { dibColors, worldPalette } from '../battle/palette.ts';
import { toRgba } from '../battle/screen.ts';
import type { Sound } from '../battle/sound.ts';
import type { WindowPlaces } from '../battle/continueData.ts';
import { type ArrangeKey, rearrangeNeeded } from '../battle/windowState.ts';
import {
  clickSounds,
  loadWorldArt,
  MAP_INFO_H,
  MAP_INFO_W,
  mapDescription,
  mapInfoClick,
  mapInfoHit,
  mapInfoImage,
  mapSelectOrder,
  MASTER_INFO_H,
  MASTER_INFO_W,
  masterInfoClick,
  masterInfoHit,
  masterInfoImage,
  WORLD_H,
  WORLD_W,
  worldHit,
  worldImage,
} from './worldArt.ts';

const TICK_MS = 48;
const FLAGS = new Array(52).fill(1); // 프리 모드: 맵마다 고를 수 있음(블록 +0x198, 0x450ed7)

/** 월드 장면에서 정하는 것(원작은 블록에: 고른 맵 +0x2d4, 진영 레코드, 조종, 시간 제한 +0x14, 시나리오 칸). 결과 창 뒤 돌아와도 그대로 */
export interface WorldSettings extends FreeBattleSetup {
  /** 고른 맵, 없으면 −1 */
  readonly selected: number;
}

type Child = 'world' | 'mapInfo' | 'masterInfo' | 'help';

/**
 * 프리 모드 월드 장면(장면 3, 0x4516f4): 월드 창(크기 조절·스크롤), 맵을 고르면 맵 정보 창과 마스터 정보 창, 도움말 창. 96ms 깜빡임(0x451d12).
 * READY → onStart(설정, 창 자리), 월드 창 닫기 → onTitle. 초상 칸은 마스터 편집 대화 상자 0x7d(모달리스: 열린 동안 마스터 정보 창 입력을 막는다). 창 자리는 블록 값(places)이 있으면 그대로(결과 창 뒤 0x44fd31은 다시 배치하지 않음). 마스터 편집 대화 상자 0x7d는 ③b-4c-2(초상 칸은 지금 소리만)
 */
export function WorldScene({
  original,
  sound,
  icon,
  client,
  help: helpOn,
  paused,
  places,
  onPlaces,
  arranged,
  settings,
  onSettings,
  onStart,
  onTitle,
}: {
  readonly original: Original;
  readonly sound: Sound;
  readonly icon: string;
  readonly client: Size;
  readonly help: boolean;
  /** 프레임의 모달 대화 상자가 열려 있다: 48ms 콜백(깜빡임)이 멈춘다 */
  readonly paused: boolean;
  /** 블록의 창 구간(+0x268 월드, +0x278 맵 정보, +0x280 마스터 정보, 도움말). 빈 칸은 월드 배치(0x4510ca) */
  readonly places: WindowPlaces;
  /** 창 자리가 바뀔 때(블록 창 구간을 늘 지금 값으로: 게임 데이터 저장 0x441960) */
  readonly onPlaces: (places: WindowPlaces) => void;
  /** Window arrange(0x4512fc)를 누를 때마다 늘어난다 */
  readonly arranged: number;
  readonly settings: WorldSettings;
  readonly onSettings: (s: WorldSettings) => void;
  readonly onStart: (s: WorldSettings, places: WindowPlaces) => void;
  readonly onTitle: () => void;
}) {
  const { exe, read } = original;
  const art = useMemo(() => loadWorldArt(exe, read), [exe, read]);
  const scenarioData = useMemo(() => ({ masters: readMasterTable(exe), ...readScenarioData(exe) }), [exe]);
  const scenario = settings.scenario;
  const flags = scenario?.flags ?? FLAGS;
  const editable = !scenario; // 0x42ad13(시나리오 = 0)
  const layout = useMemo(() => worldLayout(client, WIN98, { help: true, chat: false }), [client]);
  const o = outer(WIN98);
  const at = (p: Point, size: Size): Rect => ({ left: p.x, top: p.y, right: p.x + size.width, bottom: p.y + size.height });
  const arrange = (w: WindowPlaces): Record<Child, Rect> => ({ world: w.world ?? layout.world, mapInfo: at(w.mapInfo ?? layout.mapInfo, o.mapInfo), masterInfo: at(w.masterInfo ?? layout.masterInfo, o.masterInfo), help: at(w.help ?? layout.help, o.help) });
  const [rects, setRects] = useState(() => arrange(places));
  const arrangedFor = useRef<ArrangeKey | null>(null);
  useEffect(() => {
    const key = { arranged, width: client.width, height: client.height };
    if (rearrangeNeeded(arrangedFor.current, key)) setRects(arrange({}));
    arrangedFor.current = key;
  }, [arranged, client.width, client.height]);
  const left = (r: Rect): Point => ({ x: r.left, y: r.top });
  useEffect(() => onPlaces({ world: rects.world, mapInfo: left(rects.mapInfo), masterInfo: left(rects.masterInfo), help: left(rects.help) }), [rects]);
  // 고른 맵이 있으면(결과 창 뒤 0x4516f4 끝의 0x4514a2(맵, 1)) 두 창을 다시 연다
  const [open, setOpen] = useState({ mapInfo: settings.selected >= 0, masterInfo: settings.selected >= 0 });
  const [order, setOrder] = useState<readonly Child[]>(() => (settings.selected >= 0 ? ['help', 'world', 'mapInfo', 'masterInfo'] : ['help', 'world']));
  const raise = (c: Child) => setOrder((v) => [...v.filter((k) => k !== c), c]);
  const child = (c: Child) => ({ rect: rects[c], active: order[order.length - 1] === c, z: order.indexOf(c) + 1, metrics: WIN98, icon, onActivate: () => raise(c), onRect: (r: Rect) => setRects((v) => ({ ...v, [c]: r })) });
  const [worldHover, setWorldHover] = useState(-1);
  const [mapHover, setMapHover] = useState(-1);
  const [masterHover, setMasterHover] = useState(-1);
  // 깜빡임: 48ms 콜백 두 번마다 프레임 + 1(월드 0x451d83, 맵 정보 0x429e3d는 따로 센다)
  const [frames, setFrames] = useState({ world: 0, mapInfo: 0 });
  const ticks = useRef(0);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  useEffect(() => {
    const id = setInterval(() => {
      if (pausedRef.current || ++ticks.current < 2) return;
      ticks.current = 0;
      setFrames((f) => ({ world: (f.world + 1) & 7, mapInfo: (f.mapInfo + 1) & 7 }));
    }, TICK_MS);
    return () => clearInterval(id);
  }, []);
  const map = useMemo(() => (settings.selected >= 0 ? loadMap(exe, read, settings.selected) : null), [exe, read, settings.selected]);
  const cleared = !!map && flags[map.index] === 2;
  const colors = useMemo(() => dibColors(worldPalette(read, map ? read(map.header.paletteId) : null, cleared)), [read, map, cleared]);
  const help = useMemo(() => new HelpWindow(read), [read]);
  const [helpText, setHelpText] = useState(() => (map ? mapDescription(map, !!scenario) : ''));
  const layer = useContext(ScreenLayer);
  // 마스터 편집(0x483ef8): READY·맵 정보·마스터 정보 창 닫기는 소리 없이 버린다(0x42aeb6), 도움말은 맵 설명
  const [editing, setEditing] = useState<Editing | null>(null);
  const descriptions = useMemo(() => readDescriptions(exe).masters, [exe]);
  const endEdit = () => {
    setEditing(null);
    if (map) setHelpText(mapDescription(map, !!scenario)); // 0x42aeb6 → 0x424e78
  };

  const paint = (ref: HTMLCanvasElement | null, image: Uint8Array, w: number, h: number) => ref?.getContext('2d')?.putImageData(new ImageData(toRgba(image, colors), w, h), 0, 0);
  const worldCanvas = useRef<HTMLCanvasElement>(null);
  const mapCanvas = useRef<HTMLCanvasElement>(null);
  const masterCanvas = useRef<HTMLCanvasElement>(null);
  const helpCanvas = useRef<HTMLCanvasElement>(null);
  // 창마다 그림이 바뀔 때만 칠한다(깜빡임 프레임은 96ms마다)
  const mode = scenario ? scenario.mode : null;
  useEffect(() => paint(worldCanvas.current, worldImage(art, flags, settings.selected, worldHover, frames.world, mode), WORLD_W, WORLD_H), [art, flags, settings.selected, worldHover, frames.world, mode, colors]);
  useEffect(() => {
    if (open.mapInfo && map) paint(mapCanvas.current, mapInfoImage(art, map, read((10 << 16) | (0xad + map.index * 2)), { hover: mapHover, frame: frames.mapInfo, timeLimit: settings.timeLimit, cleared, reward: mode !== null && map.index < scenarioData.rewards.length ? scenarioData.rewards[map.index] : -1 }), MAP_INFO_W, MAP_INFO_H);
  }, [open.mapInfo, map, art, read, mapHover, frames.mapInfo, settings.timeLimit, cleared, mode, scenarioData, colors]);
  useEffect(() => {
    if (open.masterInfo) paint(masterCanvas.current, masterInfoImage(art, settings.sides, settings.controllers, masterHover, editable), MASTER_INFO_W, MASTER_INFO_H);
  }, [open.masterInfo, art, settings.sides, settings.controllers, masterHover, editable, colors]);
  useEffect(() => {
    help.set(helpText);
    paint(helpCanvas.current, help.image, HELP_W, HELP_H);
  }, [help, helpText, colors, helpOn]); // 도움말 창을 껐다 켜면 캔버스가 새로 생긴다

  const point = (e: React.MouseEvent) => [e.nativeEvent.offsetX, e.nativeEvent.offsetY] as const;
  // vmv2.exe 0x004514a2(맵, 0): 소리 1(같은 맵도), 맵 정보·마스터 정보 만들기/갱신, 도움말 = 맵 설명(0x424e78), 월드 창 맨 아래로
  const select = (m: number) => {
    for (const n of clickSounds('world', m)) sound.call(['ui', n]);
    const next = m === map?.index ? map : loadMap(exe, read, m);
    // 시나리오는 고를 때마다 적 진영을 맵의 MAS로(0x42d2e9)
    if (scenario) onSettings({ ...settings, selected: m, sides: [settings.sides[0], scenarioEnemy(scenarioData, read(next.header.enemyMasterId), scenario.mode)] });
    else if (m !== settings.selected) onSettings({ ...settings, selected: m });
    if (!open.mapInfo) {
      setFrames((f) => ({ ...f, mapInfo: 0 }));
      setMapHover(-1); // 새 창(0x429883)의 마우스 위는 −1
    }
    if (!open.masterInfo) setMasterHover(-1); // 새 창(0x42ad13)의 마우스 위도 −1
    setOpen({ mapInfo: true, masterInfo: true });
    setHelpText(mapDescription(next, !!scenario));
    const created = (['mapInfo', 'masterInfo'] as const).filter((k) => !open[k]);
    setOrder((v) => mapSelectOrder<Child>(v, created, 'world'));
  };
  const setSides = (sides: readonly SideRecord[], controllers = settings.controllers) => onSettings({ ...settings, sides: [sides[0], sides[1]], controllers });

  return (
    <div className="world-scene">
      <MdiChild title={exe.cString(0x475cac)} kind="sizable" scroll {...child('world')} onClose={onTitle}>
        <canvas
          ref={worldCanvas}
          width={WORLD_W}
          height={WORLD_H}
          onMouseMove={(e) => setWorldHover(worldHit(art, flags, ...point(e)))}
          onMouseDown={(e) => {
            if (e.button !== 0) return;
            const hit = worldHit(art, flags, ...point(e));
            setWorldHover(hit);
            if (hit < 0) return raise('world'); // 0x4520fe: 빈 곳은 월드 창을 맨 위로(소리 없음)
            select(hit);
          }}
        />
      </MdiChild>
      {open.mapInfo && map && (
        <MdiChild
          title={exe.cString(0x468bc0)}
          kind="fixed"
          {...child('mapInfo')}
          onClose={() => {
            setOpen({ mapInfo: false, masterInfo: false }); // 0x429a1c → 0x42aeb6
            endEdit();
          }}
        >
          <canvas
            ref={mapCanvas}
            width={MAP_INFO_W}
            height={MAP_INFO_H}
            onMouseMove={(e) => setMapHover(mapInfoHit(...point(e)))}
            onMouseDown={(e) => {
              if (e.button !== 0) return;
              const hit = mapInfoHit(...point(e));
              setMapHover(hit);
              const action = mapInfoClick(hit, cleared);
              if (!action) return;
              for (const n of clickSounds('mapInfo', hit)) sound.call(['ui', n]);
              if (action === 'start') {
                setEditing(null);
                onStart(settings, { world: rects.world, mapInfo: left(rects.mapInfo), masterInfo: left(rects.masterInfo), help: left(rects.help) });
              } else onSettings({ ...settings, timeLimit: hit - 2 });
            }}
          />
        </MdiChild>
      )}
      {open.masterInfo && (
        <MdiChild
          title={exe.cString(0x468cbc)}
          kind="fixed"
          {...child('masterInfo')}
          onClose={() => {
            setOpen((v) => ({ ...v, masterInfo: false }));
            endEdit();
          }}
        >
          <canvas
            ref={masterCanvas}
            width={MASTER_INFO_W}
            height={MASTER_INFO_H}
            onMouseMove={(e) => !editing && setMasterHover(masterInfoHit(...point(e), editable))}
            onMouseDown={(e) => {
              if (e.button !== 0 || editing) return; // 편집이 열린 동안은 무시(0x42bd04·0x42bd5e)
              const hit = masterInfoHit(...point(e), editable);
              setMasterHover(hit);
              const action = masterInfoClick(hit, editable);
              if (!action) return;
              for (const n of clickSounds('masterInfo', hit)) sound.call(['ui', n]);
              const s = hit >> 5;
              const t = hit & 0x1f;
              if (action === 'edit') {
                // 0x42bd5e → 0x42c495: 커서 기준 자리(0x42c4d6), 도움말 = 마스터 설명(0x424f8f)
                const r = layer.element?.getBoundingClientRect();
                const cursor = { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
                const size = dialogLayout(readDialog(exe, 0x7d), WIN98).outer;
                const main = { left: 0, top: 0, right: layer.size.width, bottom: layer.size.height };
                setEditing({ side: s, edit: editOf(settings.sides[s]), at: editDialogAt(cursor, size, main, layer.size), name: null });
                setHelpText(descriptions[settings.sides[s].master]);
                return;
              }
              if (action === 'controller') setSides(settings.sides, settings.controllers.map((c, k) => (k === s ? (c === 0 ? 1 : 0) : c)) as unknown as FreeBattleSetup['controllers']); // 0x42b502
              else setSides(settings.sides.map((r, k) => (k === s ? toggleItem(r, t - 2) : r))); // 0x42b4ab
            }}
          />
        </MdiChild>
      )}
      {editing && (
        <MasterEditDialog
          original={original}
          art={art}
          colors={colors}
          sound={sound}
          editing={editing}
          onEditing={setEditing}
          onHelp={setHelpText}
          onDone={(e) => {
            // OK: 0x42b390 → 0x42c0ff(레코드) → 초상 다시 읽기 → 마스터 정보 다시 그림. Cancel: 0x42b3f0. 둘 다 도움말 = 맵 설명
            if (e) setSides(settings.sides.map((r, k) => (k === editing.side ? applyEdit(r, e) : r)));
            endEdit();
          }}
        />
      )}
      {helpOn && (
        <MdiChild title={exe.cString(0x462374)} kind="fixed" {...child('help')}>
          <canvas ref={helpCanvas} width={HELP_W} height={HELP_H} aria-label={htmlText(helpText)} />
        </MdiChild>
      )}
    </div>
  );
}
