import { existsSync, readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { detectOrigin, originalBytes, originalUrl } from '../../src/originals/source.ts';
import { idbStore, memoryStore } from '../../src/originals/store.ts';
import { RecordingDevice } from '../../src/ui/sound/recordingPlayer.ts';
import { readBgmTable } from '../../src/ui/sound/bgm.ts';
import { exe } from '../ui/screenCases.ts';

const EXE = new URL('../../original/VMO_WIN/vmv2.exe', import.meta.url);
afterEach(() => (vi.unstubAllGlobals(), vi.unstubAllEnvs()));
const serve = (body: BodyInit, status = 200) => vi.stubGlobal('fetch', async () => new Response(body, { status }));

it.skipIf(!existsSync(EXE))('출처: 서버가 준 vmv2.exe 해시가 영문판이면 server, 없는 경로에 index.html을 200으로 줘도 서버가 아님 → 저장소에 있으면 stored, 없으면 none', async () => {
  const store = memoryStore();
  serve(new Uint8Array(readFileSync(EXE)));
  expect(await detectOrigin(store)).toBe('server');
  serve('<!doctype html><html></html>');
  expect(await detectOrigin(store)).toBe('none');
  serve('', 404);
  await store.replace([], new Map([['VMO_WIN/vmv2.exe', new Blob(['exe'])]]));
  expect(await detectOrigin(store)).toBe('stored');
});

it('하위 경로 배포(BASE_URL ./, GitHub Pages): 서버 원본을 찾고 주는 주소가 BASE_URL 아래', async () => {
  vi.stubEnv('BASE_URL', './');
  const asked: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => (asked.push(url), new Response('', { status: 404 })));
  expect(await detectOrigin(memoryStore())).toBe('none');
  expect(asked).toEqual(['./VMO_WIN/vmv2.exe']);
  expect(await originalUrl('CDDA/TRACK02.mp3')).toBe('./CDDA/TRACK02.mp3');
});

it('저장소 출처: 원본은 저장소에서(바이트·object URL), 없는 경로는 저장소에 없다는 오류·URL 없음', async () => {
  serve('', 404);
  const store = memoryStore();
  await store.replace([], new Map([['VMO_WIN/vmv2.exe', new Blob(['exe'])], ['VMO_WIN/DATA00.DAT', new Blob([Uint8Array.of(1, 2)])]]));
  vi.stubGlobal('URL', Object.assign(class extends URL {}, { createObjectURL: () => 'blob:stored', revokeObjectURL: () => {} }));
  expect(await detectOrigin(store)).toBe('stored');
  expect([...(await originalBytes('VMO_WIN/DATA00.DAT'))]).toEqual([1, 2]);
  await expect(originalBytes('KO/Vmv2.exe')).rejects.toThrow('Vmv2.exe이(가) 저장소에 없습니다');
  expect([await originalUrl('VMO_WIN/DATA00.DAT'), await originalUrl('CDDA/TRACK02.mp3')]).toEqual(['blob:stored', null]);
});

it('저장소 replace: 접두사 묶음만 바꾸고 다른 묶음은 둔다', async () => {
  const store = memoryStore();
  await store.replace([], new Map([['KO/a', new Blob(['1'])], ['CDDA/TRACK02.mp3', new Blob(['2'])], ['VMO_WIN/x', new Blob(['3'])]]));
  await store.replace(['KO/', 'CDDA/'], new Map([['KO/b', new Blob(['4'])]]));
  expect((await store.paths()).sort()).toEqual(['KO/b', 'VMO_WIN/x']);
});

it('CD 음악: 저장소에 그 트랙이 없으면 재생 실패(onFailed), 있으면 그 object URL을 튼다', async () => {
  serve('', 404);
  const store = memoryStore();
  await store.replace([], new Map([['VMO_WIN/vmv2.exe', new Blob(['exe'])], ['CDDA/TRACK15.mp3', new Blob(['mp3'])]]));
  vi.stubGlobal('URL', Object.assign(class extends URL {}, { createObjectURL: () => 'blob:track15', revokeObjectURL: () => {} }));
  await detectOrigin(store);
  const log: string[] = [];
  const audio = { src: '', currentTime: 0, volume: 1, play: () => (log.push(`play ${audio.src}`), Promise.resolve()), pause: () => void log.push('pause'), addEventListener: () => {} };
  const d = new RecordingDevice(readBgmTable(exe), 'CDDA', () => audio);
  const failed: number[] = [];
  d.onFailed = (t) => failed.push(t);
  const settle = () => new Promise((r) => setTimeout(r));
  d.play(8); // 타이틀 = CD 트랙 15
  await settle();
  d.play(10); // 전투 = CD 트랙 3(없음)
  await settle();
  expect([log, failed]).toEqual([['play blob:track15', 'pause'], [10]]); // 없는 트랙: 앞 곡을 멈춘다(파일이 없는 것과 같다)
});

it('저장소 replace: put 요청이 오류를 내면 그 요청의 오류로 거절한다(트랜잭션 onerror 때 tx.error는 아직 null)', async () => {
  const quota = new DOMException('가득 참', 'QuotaExceededError');
  const later = (f: () => void) => void setTimeout(f);
  const ok = (result?: unknown) => {
    const r: { result?: unknown; onsuccess?: () => void } = { result };
    later(() => r.onsuccess?.());
    return r;
  };
  const tx: { error: DOMException | null; onerror?: (e: { target: unknown }) => void; objectStore?: () => unknown } = { error: null };
  const files = { transaction: tx, getAllKeys: () => ok([]), delete: () => ok(), put: () => { const r = { error: quota }; later(() => tx.onerror?.({ target: r })); return r; } };
  tx.objectStore = () => files;
  vi.stubGlobal('indexedDB', { open: () => ok({ transaction: () => tx }) });
  await expect(idbStore().replace(['CDDA/'], new Map([['CDDA/TRACK02.mp3', new Blob(['mp3'])]]))).rejects.toBe(quota);
});
