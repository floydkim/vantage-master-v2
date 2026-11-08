import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { collectAlbum, collectGame, collectKorean, inmmTracks, musicNote, type Picked } from '../../src/originals/collect.ts';
import { readBgmTable } from '../../src/ui/sound/bgm.ts';
import { exe } from '../ui/screenCases.ts';

const ORIGINAL = new URL('../../original/', import.meta.url);
const has = (p: string) => existsSync(new URL(p, ORIGINAL));
const file = (rel: string, as = rel): Picked => ({ path: as, blob: new Blob([readFileSync(new URL(rel, ORIGINAL))]) });
const fake = (path: string, text = path): Picked => ({ path, blob: new Blob([text]) });
const text = async (b: Blob | undefined) => (b ? await b.text() : undefined);
const GAME = ['vmv2.exe', ...['00', '01', '02', '03', '04', '07', '08', '09', '10', '11', '12', '13'].map((n) => `DATA${n}.DAT`), 'DATA00.DIR', 'DATA09.DIR', 'DATA10.DIR', 'FALCOM.AVI'];
const midis = has('VMO_WIN/MIDI') ? readdirSync(new URL('VMO_WIN/MIDI', ORIGINAL)) : [];
const folder = (prefix: string, lower = false) => [...GAME, ...midis.map((m) => `MIDI/${m}`)].map((n) => file(`VMO_WIN/${n}`, `${prefix}${lower ? n.toLowerCase() : n}`));

it.skipIf(!has('VMO_WIN/vmv2.exe'))('게임: 폴더(대소문자 무시·한 단계 위 폴더 포함) → VMO_WIN 논리 경로 전부, 다른 판본·빠진 DAT는 까닭', async () => {
  const keys = [...GAME.map((n) => `VMO_WIN/${n}`), ...midis.map((m) => `VMO_WIN/MIDI/${m}`)].sort();
  for (const picked of [folder('VMO_WIN/'), folder('Games/VMO_WIN/', true)]) {
    const r = await collectGame(picked);
    expect(r.ok && [...r.files.keys()].sort()).toEqual(keys);
  }
  const wrong = folder('VMO_WIN/').map((p) => (p.path.endsWith('vmv2.exe') ? fake(p.path, 'not the exe') : p));
  expect(await collectGame(wrong)).toMatchObject({ ok: false, reason: expect.stringContaining('다른 판본') });
  const missing = folder('VMO_WIN/').filter((p) => !p.path.endsWith('DATA07.DAT'));
  expect(await collectGame(missing)).toMatchObject({ ok: false, reason: expect.stringContaining('DATA07.DAT') });
  expect(await collectGame([fake('readme.txt')])).toMatchObject({ ok: false });
});

it.skipIf(!has('VMOnline.exe') || !has('VMO_WIN/vmv2.exe'))('게임: VMOnline.exe 하나를 풀어 같은 파일들(내용도 같음)', async () => {
  const r = await collectGame([file('VMOnline.exe', 'Downloads/VMOnline.exe')]);
  if (!r.ok) throw new Error(r.reason);
  expect(r.files.has('VMO_WIN/DATA13.DAT') && r.files.has('VMO_WIN/FALCOM.AVI')).toBe(true);
  expect(Buffer.from(await r.files.get('VMO_WIN/vmv2.exe')!.arrayBuffer()).equals(readFileSync(new URL('VMO_WIN/vmv2.exe', ORIGINAL)))).toBe(true);
}, 30_000);

it('_inmm 목록: 줄 k → CD 트랙 k + 1(트랙 1은 데이터), CRLF·빈 줄 무시, \\ → /', () => {
  expect(inmmTracks('mp3\\01.mp3\r\nmp3\\02.mp3\r\n\r\n\r\n')).toEqual(new Map([[2, 'mp3/01.mp3'], [3, 'mp3/02.mp3']]));
});

const KO = ['Vmv2.exe', 'DATA00.DAT', 'DATA08.DAT', 'DATA09.DAT', 'DATA10.DAT', 'DATA13.DAT'].map((n) => file(`KO/${n}`, `vm2/${n}`));
const list = (dir: string, first: number, ext: string) => Array.from({ length: 19 }, (_, k) => `${dir}\\${String(first + k).padStart(2, '0')}.${ext}`).join('\r\n') + '\r\n\r\n';

it.skipIf(!has('KO/Vmv2.exe'))('한국어판: Vmv2.exe 해시·DAT 다섯(DATA13 더빙 음성 포함), 음악은 mp3 목록이 있으면 mp3, 없으면 bgm wav, 없으면 0곡', async () => {
  const mp3 = [fake('vm2/mp3/_inmm.ini', list('mp3', 1, 'mp3')), ...Array.from({ length: 19 }, (_, k) => fake(`vm2/mp3/${String(k + 1).padStart(2, '0')}.mp3`))];
  const wav = [fake('vm2/_inmm.ini', list('bgm', 2, 'wav')), ...Array.from({ length: 19 }, (_, k) => fake(`vm2/bgm/${String(k + 2).padStart(2, '0')}.wav`))];
  const both = await collectKorean([...KO, ...mp3, ...wav]);
  if (!both.ok) throw new Error(both.reason);
  expect([both.tracks, both.files.has('KO/Vmv2.exe') && both.files.has('KO/DATA13.DAT'), await text(both.files.get('CDDA/TRACK02.mp3')), await text(both.files.get('CDDA/TRACK20.mp3'))]).toEqual([19, true, 'vm2/mp3/01.mp3', 'vm2/mp3/19.mp3']);
  const wavOnly = await collectKorean([...KO, ...wav]);
  expect(wavOnly.ok && [wavOnly.tracks, await text(wavOnly.files.get('CDDA/TRACK02.mp3'))]).toEqual([19, 'vm2/bgm/02.wav']);
  expect(await collectKorean(KO)).toMatchObject({ ok: true, tracks: 0 });
  const tracks = new Set([...both.files.keys()].flatMap((k) => (k.startsWith('CDDA/') ? [Number(k.slice(10, 12))] : [])));
  for (const t of readBgmTable(exe)) expect(t.cd === 0 || tracks.has(t.cd), `곡 표 CD 트랙 ${t.cd}`).toBe(true);
  expect(await collectKorean(KO.filter((p) => !p.path.endsWith('DATA09.DAT')))).toMatchObject({ ok: false, reason: expect.stringContaining('DATA09.DAT') });
  expect(await collectKorean(KO.filter((p) => !p.path.endsWith('DATA13.DAT')))).toMatchObject({ ok: false, reason: expect.stringContaining('DATA13.DAT') });
  expect(await collectKorean([fake('vm2/Vmv2.exe', 'x'), ...KO.slice(1)])).toMatchObject({ ok: false, reason: expect.stringContaining('다른 판본') });
});

it('CD 음악 앨범: CD Audio NN 01~18 → 트랙 NN + 1, 20 → 20, SC-88 21~38 → 트랙 NN − 19, 40 → 20(import-cd-audio 규칙), 하나도 없으면 까닭', async () => {
  const n2 = (n: number) => String(n).padStart(2, '0');
  const picked = [
    ...[...Array.from({ length: 18 }, (_, k) => k + 1), 20].map((n) => fake(`Album/CD Audio/${n2(n)}_Track.mp3`)),
    ...[...Array.from({ length: 18 }, (_, k) => k + 21), 40].map((n) => fake(`Album/SC-88/${n2(n)}_Track.mp3`)),
    fake('Album/cover.jpg'),
  ];
  const r = await collectAlbum(picked);
  if (!r.ok) throw new Error(r.reason);
  const tracks = [...Array.from({ length: 18 }, (_, k) => k + 2), 20].map(n2);
  expect([...r.files.keys()].sort()).toEqual([...tracks.map((t) => `CDDA/TRACK${t}.mp3`), ...tracks.map((t) => `SC88/TRACK${t}.mp3`)].sort());
  expect([await text(r.files.get('CDDA/TRACK02.mp3')), await text(r.files.get('SC88/TRACK02.mp3')), await text(r.files.get('SC88/TRACK20.mp3'))]).toEqual(['Album/CD Audio/01_Track.mp3', 'Album/SC-88/21_Track.mp3', 'Album/SC-88/40_Track.mp3']);
  expect(await collectAlbum([fake('Album/cover.jpg')])).toMatchObject({ ok: false });
});

it('.exe 하나가 64MB를 넘으면 읽지 않고 까닭(엉뚱한 큰 설치 파일을 통째로 메모리에 올리지 않는다)', async () => {
  let read = false;
  const big = { size: 65 * 2 ** 20, arrayBuffer: async () => ((read = true), new ArrayBuffer(0)) } as unknown as Blob;
  expect(await collectGame([{ path: 'setup.exe', blob: big }])).toMatchObject({ ok: false });
  expect(read).toBe(false);
});

it('음악 안내는 든 쪽만: CD 음악·SC-88', () => {
  expect([musicNote(19, 0), musicNote(0, 19), musicNote(19, 19)]).toEqual(['CD 음악 19곡', 'SC-88 19곡', 'CD 음악 19곡·SC-88 19곡']);
});
