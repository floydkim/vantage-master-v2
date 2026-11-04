// 이어 하기(중단 저장): 저장 블록(0x441e36 = 유닛 압축 0x4071ea + 창 위치 0x441960 + 블록 +0 슬롯 식별값), 목록 줄(0x44161a),
// 슬롯 식별값(레지스트리 System Flags, 0x442098), 슬롯 대화 상자 0x76의 규칙(0x441199·0x44112c). 파일 바이트는 saveFile.ts(0x44147f)
import { decodeState, encodeState, type GameState } from '../../engine/state.ts';
import type { ExeImage } from '../../formats/exeImage.ts';
import { decodeSaveFile } from '../../formats/saveFile.ts';
import type { Point, Rect } from '../frame/layout.ts';
import { u32 } from './attack.ts';
import { formatC } from './statusWindow.ts';

/** 이어 하기 슬롯 8칸(SV100~SV107), 자동 저장 SV080(식별값 1) */
export const SLOTS = 8;
export const CONTINUE_FILE = 100;
export const AUTOSAVE_FILE = 0x50;
export const AUTOSAVE_ID = 1;
/** 목록 칸 76바이트(0x44161a 칸 0x50 − 유효 4) */
const ROW_BYTES = 76;

/** 블록 창 구간(+0x268~+0x2d3)에 적는 창 자리. 바깥 사각형·왼쪽 위(MDI 클라이언트 좌표). 없는 창은 블록 값을 그대로 둔다 */
export interface WindowPlaces {
  readonly world?: Rect;
  readonly mapInfo?: Point;
  readonly masterInfo?: Point;
  readonly help?: Point;
  readonly chat?: Rect;
  readonly battle?: Rect;
  readonly status?: Point;
  readonly view?: Point;
  /** 켬(+0x288 도움말, +0x294 채팅, +0x2bc 정보 창, +0x2c8 미니맵)과 확대(+0x2a8) */
  readonly flags?: { readonly help: boolean; readonly chat: boolean; readonly status: boolean; readonly view: boolean };
  readonly zoom?: number;
}

const at = { world: 0x268, mapInfo: 0x278, masterInfo: 0x280, helpOn: 0x288, help: 0x28c, chatOn: 0x294, chat: 0x298, zoom: 0x2a8, battle: 0x2ac, statusOn: 0x2bc, status: 0x2c0, viewOn: 0x2c8, view: 0x2cc } as const;

/** vmv2.exe 0x00441960(8개 함수가 창이 있을 때만 바깥 사각형을 MDI 클라이언트 좌표로)와 0x407334(켬)·확대 */
export function writeWindows(block: Uint8Array, w: WindowPlaces): void {
  const v = new DataView(block.buffer, block.byteOffset, block.byteLength);
  const rect = (o: number, r?: Rect) => r && [r.left, r.top, r.right, r.bottom].forEach((x, k) => v.setInt32(o + k * 4, x, true));
  const point = (o: number, p?: Point) => p && [p.x, p.y].forEach((x, k) => v.setInt32(o + k * 4, x, true));
  rect(at.world, w.world);
  point(at.mapInfo, w.mapInfo);
  point(at.masterInfo, w.masterInfo);
  point(at.help, w.help);
  rect(at.chat, w.chat);
  rect(at.battle, w.battle);
  point(at.status, w.status);
  point(at.view, w.view);
  if (w.flags) {
    v.setInt32(at.helpOn, w.flags.help ? 1 : 0, true);
    v.setInt32(at.chatOn, w.flags.chat ? 1 : 0, true);
    v.setInt32(at.statusOn, w.flags.status ? 1 : 0, true);
    v.setInt32(at.viewOn, w.flags.view ? 1 : 0, true);
  }
  if (w.zoom !== undefined) v.setInt32(at.zoom, w.zoom, true);
}

/** 되살릴 때(0x401899·0x401b12) 블록의 창 자리·켬·확대 */
export function readWindows(block: Uint8Array): Required<WindowPlaces> {
  const v = new DataView(block.buffer, block.byteOffset, block.byteLength);
  const i = (o: number) => v.getInt32(o, true);
  const rect = (o: number): Rect => ({ left: i(o), top: i(o + 4), right: i(o + 8), bottom: i(o + 12) });
  const point = (o: number): Point => ({ x: i(o), y: i(o + 4) });
  return {
    world: rect(at.world),
    mapInfo: point(at.mapInfo),
    masterInfo: point(at.masterInfo),
    help: point(at.help),
    chat: rect(at.chat),
    battle: rect(at.battle),
    status: point(at.status),
    view: point(at.view),
    flags: { help: i(at.helpOn) !== 0, chat: i(at.chatOn) !== 0, status: i(at.statusOn) !== 0, view: i(at.viewOn) !== 0 },
    zoom: i(at.zoom),
  };
}

/** vmv2.exe 0x00441e36: 저장할 블록(파일 바이트는 encodeSaveFile) */
export function continueBlock(state: GameState, windows: WindowPlaces, id: number): Uint8Array<ArrayBuffer> {
  const block = encodeState(state);
  writeWindows(block, windows);
  new DataView(block.buffer).setUint32(0, id, true);
  return block;
}

/** 목록 줄에 쓰는 이름: 맵 이름(맵 구조체 +0), 마스터 종류 이름(0x469014) */
export interface RowNames {
  readonly maps: readonly string[];
  readonly masters: readonly string[];
}

const MASTER_NAMES = 0x469014;
export const readMasterClassNames = (exe: ExeImage): string[] => Array.from({ length: 27 }, (_, k) => exe.cString(u32(exe, MASTER_NAMES + k * 4)));

/**
 * vmv2.exe 0x0044161a: 목록 줄. 파일이 없거나 풀리지 않거나 블록 +0이 식별값과 다르면 대시 줄(무효). n ≥ 100은 맵 이름까지(이어 하기), 아래는 게임 데이터 형식.
 * date는 파일 마지막 쓴 시각(지역 [년, 월, 일, 시, 분]). 줄이 76바이트 칸을 넘으면 앞 76자(원작은 다음 칸이 덮는다)
 */
export function continueRow(exe: ExeImage, file: Uint8Array | null, n: number, id: number, date: readonly number[], names: RowNames): { valid: boolean; text: string } {
  const dashes = exe.cString(n >= 100 ? 0x474110 : 0x47415c);
  if (!file) return { valid: false, text: dashes };
  let block: Uint8Array;
  try {
    block = decodeSaveFile(file);
  } catch {
    return { valid: false, text: dashes };
  }
  const v = new DataView(block.buffer, block.byteOffset, block.byteLength);
  const i = (o: number) => v.getInt32(o, true);
  if (v.getUint32(0, true) !== id >>> 0) return { valid: false, text: dashes };
  const master = (side: number) => names.masters[i(0x18 + side * 0xc0 + 0x9c)];
  const map = names.maps[i(0x2d4)];
  if (master(0) === undefined || master(1) === undefined || (n >= 100 && map === undefined)) return { valid: false, text: dashes };
  const scenario = i(0x8) !== 0;
  const name = String.fromCharCode(...block.subarray(0x18, 0x2c)).split('\0')[0]; // 바이트 그대로(브라우저 latin1은 windows-1252라 CP949 0x80~0x9f가 바뀜)
  const content = scenario
    ? n >= 100
      ? formatC(exe.cString(0x474194), name, i(0x18 + 0xa0) + 1, master(0), map)
      : formatC(exe.cString(0x4741c8), name, i(0x18 + 0xa0) + 1, master(0))
    : n >= 100
      ? formatC(exe.cString(0x4741ac), master(0), master(1), map)
      : formatC(exe.cString(0x4741dc), master(0), master(1));
  const kind = i(0x10) !== 0 ? 'N ' : !scenario ? 'F ' : i(0xc) === 0 ? 'SE' : i(0xc) === 1 ? 'SN' : 'E ';
  const [year, month, day, hour, minute] = date;
  return { valid: true, text: formatC(exe.cString(0x474208), kind, content, year, month, day, hour, minute).slice(0, ROW_BYTES) };
}

/** MSVC rand(0x452ed9): 상태 × 0x343fd + 0x269ec3, (상태 >> 16) & 0x7fff */
export function msvcRand(state: number): { value: number; state: number } {
  const next = (Math.imul(state, 0x343fd) + 0x269ec3) >>> 0;
  return { value: (next >>> 16) & 0x7fff, state: next };
}

/** vmv2.exe 0x00442098: 슬롯 식별값 = rand(), 2보다 작으면 + 2 */
export function newSlotId(state: number): { id: number; state: number } {
  const r = msvcRand(state);
  return { id: r.value < 2 ? r.value + 2 : r.value, state: r.state };
}

/** 처음 실행(System Flags 없음): srand 전이라 시드 1에서 8개(0x44ea80) */
export function firstSlotIds(): number[] {
  let state = 1;
  return Array.from({ length: SLOTS }, () => {
    const r = newSlotId(state);
    state = r.state;
    return r.id;
  });
}

export type SlotMode = 'save' | 'load';

/**
 * 슬롯 대화 상자 0x76(0x441199·0x44112c·0x41ba4d): OK(Enter)는 고른 칸이 없거나 읽기 모드의 빈 칸이면 소리 3, 아니면 소리 1과 닫기.
 * 두 번 누름은 저장 모드에서 무시, 읽기 모드에서 유효한 칸이면 OK와 같고 빈 칸이면 소리 3. Cancel은 소리 2와 닫기
 */
export function slotCommand(mode: SlotMode, valid: boolean | null, action: 'ok' | 'double' | 'cancel'): { readonly sound: number | null; readonly close: 'ok' | 'cancel' | null } {
  if (action === 'cancel') return { sound: 2, close: 'cancel' };
  if (action === 'double' && mode === 'save') return { sound: null, close: null };
  if (valid === null || (mode === 'load' && !valid)) return { sound: 3, close: null };
  return { sound: 1, close: 'ok' };
}

/** 되살린 블록이 이미 차례 시작 지형 효과를 받았는가(+0x2dc = 1). 0x40546d는 그러면 지형 효과와 자동 저장을 건너뛴다 */
export const resumedMidTurn = (block: Uint8Array | null): boolean => block !== null && decodeState(block).turnStarted === 1;
