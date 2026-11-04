// 원작 SAVE 폴더와 레지스트리 System Flags를 브라우저 저장소에: 파일은 원작 바이트 그대로(encodeSaveFile) base64와 마지막 쓴 시각.
// 저장소를 못 쓰면(사생활 모드·용량) 읽기는 없음, 쓰기는 실패("Writing failed.")로 다룬다
import type { ExeImage } from '../../formats/exeImage.ts';
import { loadMap, MAP_COUNT, type ReadResource } from '../../formats/mapData.ts';
import { decodeSaveFile } from '../../formats/saveFile.ts';
import { AUTOSAVE_FILE, AUTOSAVE_ID, CONTINUE_FILE, continueRow, firstSlotIds, newSlotId, readMasterClassNames, type RowNames, SLOTS } from './continueData.ts';

export const FILES = 'vmv2/SAVE/';
export const FLAGS = 'vmv2/System Flags';

export const saveFileName = (n: number): string => `SV${String(n).padStart(3, '0')}.DAT`;

/** 파일 바이트와 마지막 쓴 시각(ms). 없으면 null */
export function readSave(n: number): { readonly bytes: Uint8Array; readonly time: number } | null {
  try {
    const v = JSON.parse(localStorage.getItem(FILES + saveFileName(n)) ?? 'null') as { bytes: string; time: number } | null;
    if (!v) return null;
    return { bytes: Uint8Array.from(atob(v.bytes), (c) => c.charCodeAt(0)), time: v.time };
  } catch {
    return null;
  }
}

/** vmv2.exe 0x0044131a·0x00441401: 쓰기. 실패하면 false */
export function writeSave(n: number, bytes: Uint8Array, time = Date.now()): boolean {
  try {
    localStorage.setItem(FILES + saveFileName(n), JSON.stringify({ bytes: btoa(String.fromCharCode(...bytes)), time }));
    return true;
  } catch {
    return false;
  }
}

/** vmv2.exe 0x0044206d */
export function deleteSave(n: number): void {
  try {
    localStorage.removeItem(FILES + saveFileName(n));
  } catch {
    // 저장소를 못 쓰면 지울 것도 없다
  }
}

/** System Flags(0x44ea80): 이어 하기 슬롯 식별값 8개. 없으면 처음 값을 만들어 둔다 */
export function readSlotIds(): number[] {
  try {
    const v = JSON.parse(localStorage.getItem(FLAGS) ?? 'null') as number[] | null;
    if (Array.isArray(v) && v.length === SLOTS) return v;
  } catch {
    // 아래에서 새로
  }
  const ids = firstSlotIds();
  writeSlotIds(ids);
  return ids;
}

/** vmv2.exe 0x0044eb07 */
export function writeSlotIds(ids: readonly number[]): void {
  try {
    localStorage.setItem(FLAGS, JSON.stringify(ids));
  } catch {
    // 원작은 "An error has occurred on the hard disk…" 상자. 브라우저는 다음 실행에 처음 값으로
  }
}

/** 파일 시각 → 지역 [년, 월, 일, 시, 분](GetFileTime → FileTimeToLocalFileTime → FileTimeToSystemTime) */
export function localDate(time: number): number[] {
  const d = new Date(time);
  return [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()];
}

const names = new WeakMap<ExeImage, RowNames>();

/** 이어 하기 슬롯 8칸의 목록 줄(0x44161a × 8) */
export function continueRows(exe: ExeImage, read: ReadResource): { valid: boolean; text: string }[] {
  let n = names.get(exe);
  if (!n) names.set(exe, (n = { maps: Array.from({ length: MAP_COUNT }, (_, i) => loadMap(exe, read, i).header.name), masters: readMasterClassNames(exe) }));
  const ids = readSlotIds();
  return ids.map((id, i) => {
    const file = readSave(CONTINUE_FILE + i);
    return continueRow(exe, file?.bytes ?? null, CONTINUE_FILE + i, id, localDate(file?.time ?? 0), n);
  });
}

/** SV080이 자동 저장(+0 = 1, 체크섬 맞음)이면 그 블록(0x441fd3) */
export function autosaveBlock(): Uint8Array | null {
  const file = readSave(AUTOSAVE_FILE);
  if (!file) return null;
  try {
    const block = decodeSaveFile(file.bytes);
    return new DataView(block.buffer).getUint32(0, true) === AUTOSAVE_ID ? block : null;
  } catch {
    return null;
  }
}

/**
 * vmv2.exe 0x00441cb3: 고른 칸을 읽어 되살리고(resume), 되살렸으면 그 슬롯 식별값을 새 난수로(0x442098 = 읽으면 지워짐, 0x401899 성공 뒤 0x44eb07).
 * 파일을 못 풀거나 되살리기가 실패하면 식별값은 그대로 두고 false
 */
export function loadContinue(slot: number, seed: number, resume: (block: Uint8Array, seed: number) => void): boolean {
  const next = newSlotId(seed);
  try {
    resume(decodeSaveFile(readSave(CONTINUE_FILE + slot)!.bytes), next.state);
  } catch {
    return false;
  }
  const ids = readSlotIds();
  ids[slot] = next.id;
  writeSlotIds(ids);
  return true;
}
