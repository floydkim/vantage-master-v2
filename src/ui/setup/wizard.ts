// 설치 마법사의 단계 규칙(화면은 SetupWizard.tsx)
import type { Collected } from '../../originals/collect.ts';
import { FILES as SAVE_FILES, FLAGS as SYSTEM_FLAGS } from '../battle/saveStore.ts';

/** 브라우저 저장소에 이미 든 것 */
export interface Stored {
  readonly game: boolean;
  readonly korean: boolean;
  readonly music: number;
  readonly sc88: number;
  /** 저장된 원본을 읽지 못해 연 마법사: 게임·한국어판은 없는 것으로 보고 마침에 둘 다 지운다(음악은 읽기에 쓰이지 않아 그대로) */
  readonly broken: boolean;
}

/** 이번에 고른 것(고르지 않은 단계는 없음), [비우기] */
export interface Picks {
  readonly game?: Collected;
  readonly korean?: Collected & { readonly tracks?: number };
  readonly album?: Collected;
  readonly clearKorean?: boolean;
  readonly clearMusic?: boolean;
}

export const storedOf = (paths: readonly string[], broken = false): Stored => ({
  game: !broken && paths.includes('VMO_WIN/vmv2.exe'),
  korean: !broken && paths.includes('KO/Vmv2.exe'),
  music: paths.filter((p) => p.startsWith('CDDA/')).length,
  sc88: paths.filter((p) => p.startsWith('SC88/')).length,
  broken,
});

/** 2단계(게임)는 맞는 게임을 골랐거나 이미 저장돼 있을 때만, 나머지는 언제나(선택 단계는 건너뛴다) */
export const canNext = (step: number, picks: Picks, stored: Stored): boolean => step !== 2 || picks.game?.ok === true || stored.game;

const has = (c: Collected | undefined, prefix: string) => c?.ok === true && [...c.files.keys()].some((k) => k.startsWith(prefix));

/** 한국어판에서 CD 음악으로 넣을 곡 수: 고른 앨범에 CD 음악(CDDA)이 없고, 저장된 CD 음악이 없거나 [비우기]했을 때만(건너뛴 음악 단계는 저장된 것을 그대로) */
export const koreanTracks = (picks: Picks, stored: Stored): number =>
  picks.korean?.ok && !has(picks.album, 'CDDA/') && (!stored.music || picks.clearMusic) ? (picks.korean.tracks ?? 0) : 0;

/** 선택 단계(한국어판·CD 음악)의 단추: 이번에 고른 것이 있으면 [빼기](고르기 전으로 — 저장 공간이 모자랄 때 선택을 빼게), 없고 저장된 것이 있으면 [비우기] */
export const optionalButton = (picked: boolean, stored: boolean, cleared: boolean): '빼기' | '비우기' | null => (picked ? '빼기' : stored && !cleared ? '비우기' : null);

/** 마침에 저장소를 한 번에 바꿀 것: 고른(맞는) 묶음과 [비우기]한 묶음만. 앨범은 든 쪽(CD Audio·SC-88) 음악만 앨범 것으로 */
export function changes(picks: Picks, stored: Stored): { prefixes: string[]; files: Map<string, Blob> } {
  const prefixes: string[] = [];
  const files = new Map<string, Blob>();
  const take = (p: string[], c?: Collected, keep: (k: string) => boolean = () => true) => {
    for (const x of p) if (!prefixes.includes(x)) prefixes.push(x);
    if (c?.ok) for (const [k, b] of c.files) if (keep(k)) files.set(k, b);
  };
  if (stored.broken) take(['VMO_WIN/', 'KO/']);
  if (picks.game?.ok) take(['VMO_WIN/'], picks.game);
  if (picks.clearKorean) take(['KO/']);
  const album = picks.album?.ok ? picks.album : undefined;
  const music = koreanTracks(picks, stored) > 0;
  if (picks.korean?.ok) take(music ? ['KO/', 'CDDA/'] : ['KO/'], picks.korean, (k) => music || !k.startsWith('CDDA/'));
  if (picks.clearMusic) take(['CDDA/', 'SC88/']);
  if (album) take(['CDDA/', 'SC88/'].filter((p) => has(album, p)), album);
  return { prefixes, files };
}

/** 제거 화면의 항목 */
export type Part = 'game' | 'korean' | 'music' | 'saves' | 'settings';
export const PARTS: readonly Part[] = ['game', 'korean', 'music', 'saves', 'settings'];
const STORE_PARTS: Partial<Record<Part, readonly string[]>> = { game: ['VMO_WIN/'], korean: ['KO/'], music: ['CDDA/', 'SC88/'] };
const isSave = (k: string) => k.startsWith(SAVE_FILES) || k === SYSTEM_FLAGS;
const isSetting = (k: string) => k.startsWith('vmv2') && !isSave(k); // 옵션·BGM 장치·화면 크기·언어(이 앱의 vmv2 키만)
const LOCAL: Partial<Record<Part, (k: string) => boolean>> = { saves: isSave, settings: isSetting };

/** 고른 항목을 지울 것: 원본 저장소 접두사(한 트랜잭션으로)와 localStorage 키 */
export function removal(parts: ReadonlySet<Part>, keys: readonly string[]): { prefixes: string[]; keys: string[] } {
  const chosen = PARTS.filter((p) => parts.has(p));
  return { prefixes: chosen.flatMap((p) => STORE_PARTS[p] ?? []), keys: keys.filter((k) => chosen.some((p) => LOCAL[p]?.(k))) };
}

/** 제거 화면에 보일 항목별 개수·바이트. 있는지는 저장된 경로(paths)와 키로(크기를 못 읽어도 지울 수 있게), 바이트는 sizes(경로 → 바이트)에서 */
export function amounts(paths: readonly string[], sizes: ReadonlyMap<string, number>, keys: readonly string[]): Record<Part, { n: number; bytes: number }> {
  const files = (p: Part) => paths.filter((k) => STORE_PARTS[p]?.some((x) => k.startsWith(x)));
  const of = (p: Part) => ({
    n: LOCAL[p] ? keys.filter(LOCAL[p]).length : files(p).length,
    bytes: files(p).reduce((sum, k) => sum + (sizes.get(k) ?? 0), 0),
  });
  return { game: of('game'), korean: of('korean'), music: of('music'), saves: of('saves'), settings: of('settings') };
}
