// 프리 모드 게임 데이터(SV000~SV079, 식별값 0): 월드 장면의 설정과 창 자리. 저장 0x441aea(Save GameData), 읽기 0x44198d → 0x4510b6. 해독 메모 notes_options.md §4
import { freeModeBlock } from '../../engine/battleStart.ts';
import { readScenario, writeScenario } from '../../engine/scenario.ts';
import { decodeState, encodeState } from '../../engine/state.ts';
import type { ExeImage } from '../../formats/exeImage.ts';
import type { WorldSettings } from '../world/WorldScene.tsx';
import { continueRow, readMasterClassNames, readWindows, type WindowPlaces, writeWindows } from './continueData.ts';
import { localDate, readSave } from './saveStore.ts';

export const GAME_DATA_SLOTS = 80;

/** vmv2.exe 0x0044161a(i, 0) × 80: 마스터 종류 이름 둘과 파일 시각(맵 이름은 읽지 않음) */
export function gameDataRows(exe: ExeImage): { valid: boolean; text: string }[] {
  const names = { maps: [], masters: readMasterClassNames(exe) };
  return Array.from({ length: GAME_DATA_SLOTS }, (_, i) => {
    const file = readSave(i);
    return continueRow(exe, file?.bytes ?? null, i, 0, localDate(file?.time ?? 0), names);
  });
}

/**
 * vmv2.exe 0x00441aea: 월드 장면 블록(모드 칸·진영 레코드·조종·시간 제한·맵 플래그·고른 맵)에 창 구간(0x441960)을 적고 +0 = 0.
 * 원작은 마지막 전투의 나머지 칸(유닛·통계)도 담지만 읽는 쪽이 쓰지 않아 빈 블록에서 시작한다
 */
export function gameDataBlock(settings: WorldSettings, places: WindowPlaces): Uint8Array<ArrayBuffer> {
  const blank = decodeState(freeModeBlock(settings.selected));
  const block = encodeState({
    ...blank,
    timeLimit: settings.timeLimit,
    sides: [settings.sides[0], settings.sides[1]],
    sideStates: [0, 1].map((s) => ({ ...blank.sideStates[s], controller: settings.controllers[s] })) as unknown as typeof blank.sideStates,
  });
  if (settings.scenario) writeScenario(block, settings.scenario);
  writeWindows(block, places);
  new DataView(block.buffer).setUint32(0, 0, true);
  return block;
}

/** 저장할 창 구간(0x441960·0x407334): 창 켬은 지금 값(프리 배틀은 채팅 없음), 확대는 전장 자리가 있을 때만 그 값이고 없으면 −1(아직 전투 전) */
export function savedPlaces(places: WindowPlaces, panes: { readonly help: boolean; readonly status: boolean; readonly view: boolean; readonly zoom: number }): WindowPlaces {
  return { ...places, flags: { help: panes.help, chat: false, status: panes.status, view: panes.view }, zoom: places.battle ? panes.zoom : -1 };
}

/** vmv2.exe 0x004510b6: 읽은 블록의 월드 설정과 창 자리. 확대 −1이면 전장·정보 창·미니맵 자리는 없다(다음 전투 0x40e392가 배치) */
export function worldFromGameData(block: Uint8Array): { settings: WorldSettings; places: WindowPlaces } {
  const s = decodeState(block);
  const w = readWindows(block);
  const selected = new DataView(block.buffer, block.byteOffset, block.byteLength).getInt32(0x2d4, true);
  const places: WindowPlaces = w.zoom === -1 ? { world: w.world, mapInfo: w.mapInfo, masterInfo: w.masterInfo, help: w.help, chat: w.chat, flags: w.flags, zoom: w.zoom } : w;
  return {
    settings: { sides: [s.sides[0], s.sides[1]], controllers: [s.sideStates[0].controller, s.sideStates[1].controller], timeLimit: s.timeLimit, selected, scenario: readScenario(block) },
    places,
  };
}
