import { expect, it } from 'vitest';
import type { Collected } from '../../src/originals/collect.ts';
import { amounts, canNext, changes, koreanTracks, optionalButton, removal, storedOf } from '../../src/ui/setup/wizard.ts';

const ok = (paths: string[], extra = {}): Collected => ({ ok: true, files: new Map(paths.map((p) => [p, new Blob([p])])), note: '', ...extra });
const bad: Collected = { ok: false, reason: '다른 판본' };
const none = storedOf([]);

it('저장된 것: 게임(VMO_WIN/vmv2.exe)·한국어판(KO/Vmv2.exe)·CD 음악·SC-88 곡 수', () => {
  expect(storedOf(['VMO_WIN/vmv2.exe', 'VMO_WIN/DATA00.DAT', 'KO/Vmv2.exe', 'CDDA/TRACK02.mp3', 'CDDA/TRACK03.mp3', 'SC88/TRACK02.mp3'])).toEqual({ game: true, korean: true, music: 2, sc88: 1, broken: false });
  expect(none).toEqual({ game: false, korean: false, music: 0, sc88: 0, broken: false });
});

it('다음: 2단계(게임)는 맞는 게임을 골랐거나 이미 저장돼 있을 때만, 1·3·4단계는 언제나(선택 단계는 건너뛸 수 있다)', () => {
  expect([1, 2, 3, 4].map((s) => canNext(s, {}, none))).toEqual([true, false, true, true]);
  expect(canNext(2, { game: ok(['VMO_WIN/vmv2.exe']) }, none)).toBe(true);
  expect(canNext(2, { game: bad }, none)).toBe(false);
  expect(canNext(2, { game: bad }, { ...none, game: true })).toBe(true); // 잘못 고르면 저장된 것을 그대로 쓴다
});

it('마침에 바꿀 것(한 번에): 고른 묶음만 바꾸고 건너뛴 묶음은 그대로, [비우기]는 그 묶음을 지움, 앨범을 고르면 한국어판 음악 대신 앨범', () => {
  expect(changes({}, none)).toEqual({ prefixes: [], files: new Map() });
  expect(changes({ game: ok(['VMO_WIN/vmv2.exe']), korean: bad }, none).prefixes).toEqual(['VMO_WIN/']);
  const korean = ok(['KO/Vmv2.exe', 'CDDA/TRACK02.mp3', 'CDDA/TRACK20.mp3'], { tracks: 2 });
  expect(changes({ korean }, none).prefixes).toEqual(['KO/', 'CDDA/']);
  const both = changes({ korean, album: ok(['CDDA/TRACK03.mp3', 'SC88/TRACK03.mp3']) }, none);
  expect([both.prefixes, [...both.files.keys()].sort()]).toEqual([['KO/', 'CDDA/', 'SC88/'], ['CDDA/TRACK03.mp3', 'KO/Vmv2.exe', 'SC88/TRACK03.mp3']]);
  expect(changes({ clearKorean: true, clearMusic: true }, none)).toEqual({ prefixes: ['KO/', 'CDDA/', 'SC88/'], files: new Map() });
});

it('[원본 파일…]로 한국어판만 더 넣으면 저장된 CD 음악은 그대로: 한국어판 음악은 저장된 음악이 없거나 [비우기]했을 때만', () => {
  const korean = ok(['KO/Vmv2.exe', 'CDDA/TRACK02.mp3', 'CDDA/TRACK20.mp3'], { tracks: 2 });
  const album = { ...none, game: true, music: 19, sc88: 19 };
  const r = changes({ korean }, album);
  expect([r.prefixes, [...r.files.keys()]]).toEqual([['KO/'], ['KO/Vmv2.exe']]);
  expect([koreanTracks({ korean }, album), koreanTracks({ korean, clearMusic: true }, album), koreanTracks({ korean }, none)]).toEqual([0, 2, 2]);
  expect(koreanTracks({ korean, album: ok(['CDDA/TRACK02.mp3']) }, none)).toBe(0);
  expect(changes({ korean, clearMusic: true }, album).prefixes).toEqual(['KO/', 'CDDA/', 'SC88/']);
});

it('선택 단계 단추: 이번에 고른 것이 있으면 [빼기](저장 공간이 모자랄 때 선택을 빼게), 없고 저장된 것이 있으면 [비우기]', () => {
  expect(optionalButton(true, false, false)).toBe('빼기');
  expect(optionalButton(true, true, false)).toBe('빼기');
  expect(optionalButton(false, true, false)).toBe('비우기');
  expect(optionalButton(false, true, true)).toBe(null);
  expect(optionalButton(false, false, false)).toBe(null);
});

it('한쪽만 든 앨범은 그쪽 음악만 바꾼다: SC-88만이면 CD 음악(한국어판 것 포함)은 그대로, CD Audio만이면 SC-88은 그대로', () => {
  const korean = ok(['KO/Vmv2.exe', 'CDDA/TRACK02.mp3'], { tracks: 1 });
  const sc88 = ok(['SC88/TRACK02.mp3']);
  const r = changes({ korean, album: sc88 }, none);
  expect([r.prefixes, [...r.files.keys()].sort()]).toEqual([['KO/', 'CDDA/', 'SC88/'], ['CDDA/TRACK02.mp3', 'KO/Vmv2.exe', 'SC88/TRACK02.mp3']]);
  expect(koreanTracks({ korean, album: sc88 }, none)).toBe(1);
  expect(changes({ album: sc88 }, none).prefixes).toEqual(['SC88/']);
  expect(changes({ album: ok(['CDDA/TRACK02.mp3']) }, none).prefixes).toEqual(['CDDA/']);
});

it('저장된 원본이 깨졌으면(읽기 오류로 연 마법사) 게임·한국어판은 없는 것으로: 게임을 다시 골라야 다음, 마침에 둘 다 지우고 고른 것만, 음악은 그대로', () => {
  const broken = storedOf(['VMO_WIN/vmv2.exe', 'KO/Vmv2.exe', 'CDDA/TRACK02.mp3'], true);
  expect(broken).toEqual({ game: false, korean: false, music: 1, sc88: 0, broken: true });
  expect(canNext(2, {}, broken)).toBe(false);
  const r = changes({ game: ok(['VMO_WIN/vmv2.exe']) }, broken);
  expect([r.prefixes, [...r.files.keys()]]).toEqual([['VMO_WIN/', 'KO/'], ['VMO_WIN/vmv2.exe']]);
});

const KEYS = ['vmv2/SAVE/SV000.DAT', 'vmv2/SAVE/SV080.DAT', 'vmv2/System Flags', 'vmv2/SaveDataKey', 'vmv2/BGM Device', 'vmv2.screen', 'vmv2.language', 'other-app'];

it('제거: 고른 것만 — 원본은 묶음 접두사, 세이브는 vmv2/SAVE/·System Flags, 설정은 그 밖의 vmv2 키(다른 키는 두지 않음)', () => {
  expect(removal(new Set(['game', 'music', 'saves'] as const), KEYS)).toEqual({ prefixes: ['VMO_WIN/', 'CDDA/', 'SC88/'], keys: ['vmv2/SAVE/SV000.DAT', 'vmv2/SAVE/SV080.DAT', 'vmv2/System Flags'] });
  expect(removal(new Set(['korean', 'settings'] as const), KEYS)).toEqual({ prefixes: ['KO/'], keys: ['vmv2/SaveDataKey', 'vmv2/BGM Device', 'vmv2.screen', 'vmv2.language'] });
  expect(removal(new Set(), KEYS)).toEqual({ prefixes: [], keys: [] });
});

it('제거 목록: 항목마다 개수(원본은 저장된 경로, 세이브·설정은 키)·바이트, 없는 항목은 0', () => {
  const sizes = new Map([['VMO_WIN/vmv2.exe', 100], ['VMO_WIN/DATA00.DAT', 50], ['CDDA/TRACK02.mp3', 7], ['SC88/TRACK02.mp3', 9]]);
  expect(amounts([...sizes.keys()], sizes, KEYS)).toEqual({ game: { n: 2, bytes: 150 }, korean: { n: 0, bytes: 0 }, music: { n: 2, bytes: 16 }, saves: { n: 3, bytes: 0 }, settings: { n: 4, bytes: 0 } });
});

it('제거 목록: 크기를 못 읽어도 저장된 원본은 있음(지울 수 있음), System Flags만 있어도 세이브는 있음', () => {
  const a = amounts(['VMO_WIN/vmv2.exe', 'KO/Vmv2.exe'], new Map(), ['vmv2/System Flags']);
  expect([a.game, a.korean, a.saves]).toEqual([{ n: 1, bytes: 0 }, { n: 1, bytes: 0 }, { n: 1, bytes: 0 }]);
});
