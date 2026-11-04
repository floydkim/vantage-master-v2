// 설치 마법사가 고른 파일을 실행 때 읽는 논리 경로로 모으고 판본을 확인한다. 논리 경로는 개발 서버의 original/ 경로와 같다:
// VMO_WIN/<이름>(영문판), KO/<이름>(한국어판), CDDA/TRACKnn.mp3·SC88/TRACKnn.mp3(CD 음악, 한국어판 wav도 이 이름 — 오디오 요소가 내용으로 형식을 안다)
import { datFileName, dirFileName } from '../formats/vmFiles.ts';
import { readLha } from './lha.ts';
import { sha256Hex } from './sha256.ts';

/** 폴더 고르기·끌어다 놓기로 받은 파일: 고른 것 기준 상대 경로 */
export interface Picked {
  readonly path: string;
  readonly blob: Blob;
}

export type Collected = { readonly ok: true; readonly files: ReadonlyMap<string, Blob>; readonly note: string } | { readonly ok: false; readonly reason: string };

export const GAME_EXE_SHA256 = 'daa647ff03cc1437fe5ade458f6a43a7138e8bfb820a86fb1b661ca75895819f'; // 팔콤 VM Online(V2 영문판) vmv2.exe
const KO_EXE = 'bfdbd88a994b1e505acf0bc4a7c05d2020ef7c09a3b894d01569a511b28693c5'; // 한국어판(src/i18n/koStrings.json을 만든 빌드)
const GAME_FILES = [...[0, 1, 2, 3, 4, 7, 8, 9, 10, 11, 12, 13].map(datFileName), ...[0, 9, 10].map(dirFileName)];
const KO_FILES = [0, 8, 9, 10].map(datFileName);
const MAX_EXE = 64 * 2 ** 20; // VMOnline.exe는 약 21MB: 이보다 큰 exe는 읽지 않는다
const NO_CRYPTO = '이 주소(http)에서는 파일을 확인할 수 없습니다. https 주소나 localhost로 여세요';

const norm = (p: string) => p.replaceAll('\\', '/').toLowerCase();
const pad = (n: number) => String(n).padStart(2, '0');

/** exe 이름(소문자)이 든 폴더를 뿌리로 상대 경로(대소문자 무시)로 찾는다 */
function rooted(picked: readonly Picked[], exe: string) {
  const at = picked.find((f) => norm(f.path) === exe || norm(f.path).endsWith(`/${exe}`));
  if (!at) return null;
  const root = norm(at.path).slice(0, -exe.length);
  const byPath = new Map(picked.map((f) => [norm(f.path), f]));
  return { exe: at.blob, root, get: (rel: string) => byPath.get(root + norm(rel)), under: (dir: string) => picked.filter((f) => norm(f.path).startsWith(root + norm(dir))) };
}

async function checkExe(blob: Blob, want: string): Promise<string | null> {
  const hash = await sha256Hex(new Uint8Array(await blob.arrayBuffer()));
  return hash === null ? NO_CRYPTO : hash === want ? null : '다른 판본';
}

/** 게임 파일(필수): VMOnline.exe 하나(안의 LHA를 푼다) 또는 영문판 게임 폴더 */
export async function collectGame(picked: readonly Picked[]): Promise<Collected> {
  let files = picked;
  if (picked.length === 1 && norm(picked[0].path).endsWith('.exe') && !norm(picked[0].path).endsWith('vmv2.exe')) {
    if (picked[0].blob.size > MAX_EXE) return { ok: false, reason: '팔콤 VM Online 설치 파일(VMOnline.exe, 약 21MB)이 아닙니다' };
    try {
      files = readLha(new Uint8Array(await picked[0].blob.arrayBuffer())).map((e) => ({ path: e.path, blob: new Blob([e.data as Uint8Array<ArrayBuffer>]) }));
    } catch {
      return { ok: false, reason: '팔콤 VM Online 설치 파일(VMOnline.exe)이 아니거나 깨졌습니다' };
    }
  }
  const game = rooted(files, 'vmv2.exe');
  if (!game) return { ok: false, reason: 'vmv2.exe가 없습니다. VMOnline.exe나 영문판 게임 폴더를 고르세요' };
  const bad = await checkExe(game.exe, GAME_EXE_SHA256);
  if (bad) return { ok: false, reason: bad === NO_CRYPTO ? bad : 'vmv2.exe가 다른 판본입니다. 팔콤 VM Online(V2 영문판)의 파일이 필요합니다' };
  const missing = GAME_FILES.filter((n) => !game.get(n));
  if (missing.length) return { ok: false, reason: `빠진 파일: ${missing.join(', ')}` };
  const out = new Map<string, Blob>([['VMO_WIN/vmv2.exe', game.exe], ...GAME_FILES.map((n) => [`VMO_WIN/${n}`, game.get(n)!.blob] as const)]);
  const midi = game.under('midi/').filter((f) => norm(f.path).endsWith('.mid'));
  for (const f of midi) out.set(`VMO_WIN/MIDI/${f.path.split(/[\\/]/).pop()!.toUpperCase()}`, f.blob);
  const avi = game.get('FALCOM.AVI');
  if (avi) out.set('VMO_WIN/FALCOM.AVI', avi.blob);
  return { ok: true, files: out, note: `영문판 V2(vmv2.exe·DAT ${GAME_FILES.length - 3}개·MIDI ${midi.length}곡${avi ? '·오프닝' : ''})` };
}

/** CD 음원 대역(_inmm) 목록: 줄마다 파일 하나, k번째 줄 = CD 트랙 k + 1(트랙 1은 데이터) */
export function inmmTracks(text: string): Map<number, string> {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  return new Map(lines.map((l, k) => [k + 2, l.trim().replaceAll('\\', '/')]));
}

/** 한국어판(선택): Vmv2.exe(대응표를 만든 빌드)·DATA00·08·09·10, 폴더에 CD 음악 목록이 있으면 음악(mp3 목록 먼저, 없으면 bgm wav) */
export async function collectKorean(picked: readonly Picked[]): Promise<Collected & { readonly tracks?: number }> {
  const ko = rooted(picked, 'vmv2.exe');
  if (!ko) return { ok: false, reason: 'Vmv2.exe가 없습니다. 한국어판 게임 폴더를 고르세요' };
  const bad = await checkExe(ko.exe, KO_EXE);
  if (bad) return { ok: false, reason: bad === NO_CRYPTO ? bad : 'Vmv2.exe가 다른 판본입니다(이 리메이크가 맞춘 한국어판이 아님)' };
  const missing = KO_FILES.filter((n) => !ko.get(n));
  if (missing.length) return { ok: false, reason: `빠진 파일: ${missing.join(', ')}` };
  const out = new Map<string, Blob>([['KO/Vmv2.exe', ko.exe], ...KO_FILES.map((n) => [`KO/${n}`, ko.get(n)!.blob] as const)]);
  let tracks = 0;
  for (const list of ['mp3/_inmm.ini', '_inmm.ini']) {
    const ini = ko.get(list);
    if (!ini) continue;
    const found = [...inmmTracks(await ini.blob.text())].flatMap(([t, rel]) => {
      const f = ko.get(rel);
      return f ? [[`CDDA/TRACK${pad(t)}.mp3`, f.blob] as const] : [];
    });
    if (!found.length) continue;
    for (const [k, b] of found) out.set(k, b);
    tracks = found.length;
    break;
  }
  return { ok: true, files: out, note: `한국어판${tracks ? `·CD 음악 ${tracks}곡` : ''}`, tracks };
}

/** 음악 안내: 든 쪽만('CD 음악 N곡'·'SC-88 N곡') */
export const musicNote = (cd: number, sc88: number): string => [cd ? `CD 음악 ${cd}곡` : '', sc88 ? `SC-88 ${sc88}곡` : ''].filter(Boolean).join('·');

/** CD 음악 앨범(선택): 'CD Audio/NN_….mp3'(오디오 트랙 차례: 01~18 → CD 트랙 NN + 1, 20 → 20), 'SC-88/NN_….mp3'(21~38 → NN − 19, 40 → 20). tools/import-cd-audio.sh와 같은 규칙 */
export async function collectAlbum(picked: readonly Picked[]): Promise<Collected> {
  const out = new Map<string, Blob>();
  for (const f of picked) {
    const parts = norm(f.path).split('/');
    const m = /^(\d{2})_.*\.mp3$/.exec(parts.at(-1)!);
    if (!m) continue;
    const n = Number(m[1]);
    if (parts.at(-2) === 'cd audio' && (n <= 18 || n === 20)) out.set(`CDDA/TRACK${pad(n === 20 ? 20 : n + 1)}.mp3`, f.blob);
    else if (parts.at(-2) === 'sc-88' && ((n >= 21 && n <= 38) || n === 40)) out.set(`SC88/TRACK${pad(n === 40 ? 20 : n - 19)}.mp3`, f.blob);
  }
  if (!out.size) return { ok: false, reason: "'CD Audio'·'SC-88' 폴더에서 'NN_제목.mp3' 파일을 찾지 못했습니다" };
  const count = (dir: string) => [...out.keys()].filter((k) => k.startsWith(dir)).length;
  return { ok: true, files: out, note: musicNote(count('CDDA/'), count('SC88/')) };
}
