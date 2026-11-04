import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { startFreeBattle } from '../../src/engine/battleStart.ts';
import { startTurn } from '../../src/engine/turn.ts';
import { readFreeModeNames, readMasterTable } from '../../src/formats/masterTable.ts';
import { decodeSaveFile, encodeSaveFile } from '../../src/formats/saveFile.ts';
import { AUTOSAVE_FILE, AUTOSAVE_ID, CONTINUE_FILE, continueBlock, newSlotId, resumedMidTurn } from '../../src/ui/battle/continueData.ts';
import { autosaveBlock, continueRows, deleteSave, loadContinue, readSave, readSlotIds, writeSave } from '../../src/ui/battle/saveStore.ts';
import { engineData } from './engineData.ts';
import { exe, mapOf, read } from './screenCases.ts';

// 브라우저 저장소 흉내(원작 SAVE 폴더·레지스트리 System Flags 자리)
beforeEach(() => {
  const items = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => void items.set(k, v), removeItem: (k: string) => void items.delete(k) });
});
afterEach(() => vi.unstubAllGlobals());

const saved = (id: number) => {
  const map = mapOf(3);
  const data = engineData(map);
  const t = startTurn(data, startFreeBattle({ masters: readMasterTable(exe), oa: data.oa, names: readFreeModeNames(exe) }, map));
  if ('winner' in t) throw new Error('첫 차례에 전투가 끝났습니다');
  return encodeSaveFile(continueBlock(t.state, { battle: { left: 0, top: 0, right: 400, bottom: 300 }, status: { x: 0, y: 0 }, view: { x: 0, y: 0 }, help: { x: 0, y: 0 } }, id));
};

it('파일은 바이트와 마지막 쓴 시각 그대로 읽히고(0x44131a), 지우면 없다(0x44206d)', () => {
  const bytes = saved(5);
  expect(writeSave(CONTINUE_FILE + 3, bytes, 1234)).toBe(true);
  expect(readSave(CONTINUE_FILE + 3)).toEqual({ bytes, time: 1234 });
  deleteSave(CONTINUE_FILE + 3);
  expect(readSave(CONTINUE_FILE + 3)).toBeNull();
});

it('자동 저장(SV080)은 블록 +0 식별값이 1일 때만 되살릴 거리(0x441fd3)', () => {
  expect(autosaveBlock()).toBeNull();
  writeSave(AUTOSAVE_FILE, saved(AUTOSAVE_ID));
  expect(autosaveBlock()).not.toBeNull();
  writeSave(AUTOSAVE_FILE, saved(7));
  expect(autosaveBlock()).toBeNull();
});

it('Load Data(0x441cb3): 읽으면 그 슬롯 식별값이 새 난수라 그 줄은 빈 칸(0x442098). 되살리기가 실패하면 식별값을 바꾸지 않는다(원작은 0x401899 성공 뒤 0x44eb07)', () => {
  const slot = 2;
  const ids = readSlotIds();
  writeSave(CONTINUE_FILE + slot, saved(ids[slot]));
  expect(continueRows(exe, read)[slot].valid).toBe(true);
  expect(loadContinue(slot, 99, () => {
    throw new Error('되살리기 실패');
  })).toBe(false);
  expect(readSlotIds()).toEqual(ids);
  expect(continueRows(exe, read)[slot].valid).toBe(true);
  const resumed: [Uint8Array, number][] = [];
  expect(loadContinue(slot, 99, (block, seed) => resumed.push([block, seed]))).toBe(true);
  expect(resumed.map(([b, s]) => [new DataView(b.buffer, b.byteOffset).getUint32(0, true), s])).toEqual([[ids[slot], newSlotId(99).state]]);
  expect(readSlotIds()).toEqual(ids.map((id, i) => (i === slot ? newSlotId(99).id : id)));
  expect(continueRows(exe, read)[slot].valid).toBe(false);
  expect(loadContinue(5, 99, () => {})).toBe(false); // 빈 칸은 못 푼다
});

it('되살린 첫 차례는 블록 +0x2dc가 1(이미 지형 효과를 줌)일 때만 자동 저장을 건너뛴다(0x40546d). 0이면 지형 효과를 주고 저장한다', () => {
  const block = decodeSaveFile(saved(9));
  const v = new DataView(block.buffer, block.byteOffset);
  expect(v.getInt32(0x2dc, true)).toBe(1);
  expect(resumedMidTurn(block)).toBe(true);
  v.setInt32(0x2dc, 0, true);
  expect(resumedMidTurn(block)).toBe(false);
  expect(resumedMidTurn(null)).toBe(false);
});
