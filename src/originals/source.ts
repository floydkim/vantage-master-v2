// 원본의 출처: 서버(개발 서버의 original/, vmv2.exe 해시로 판정) 먼저, 없으면 설치 마법사가 넣은 브라우저 저장소. 실행 때 원본은 모두
// 논리 경로(VMO_WIN/DATA00.DAT, KO/Vmv2.exe, CDDA/TRACK02.mp3 …)로 여기서 읽는다
import { GAME_EXE_SHA256 } from './collect.ts';
import { sha256Hex } from './sha256.ts';
import { type FileStore, idbStore } from './store.ts';

export type Origin = 'server' | 'stored' | 'none';

let origin: Origin | null = null; // 정하기 전(자료 보기·시험)에는 서버
let store: FileStore | null = null;
const urls = new Map<string, string>();

const served = (path: string) => `${import.meta.env.BASE_URL}${path}`; // 하위 경로 배포(GitHub Pages, base './')면 그 아래
const fromServer = (path: string) => fetch(served(path), { headers: { Accept: 'application/octet-stream' } }); // Accept: Vite가 없는 파일에 index.html을 주지 않게

/** 서버가 준 vmv2.exe가 영문판이면 'server'(없는 경로에 index.html을 주는 호스트도 내용으로 거름), 저장소에 있으면 'stored', 둘 다 없으면 'none' */
export async function detectOrigin(s: FileStore = idbStore()): Promise<Origin> {
  store = s;
  urls.clear();
  try {
    const res = await fromServer('VMO_WIN/vmv2.exe');
    if (res.ok) {
      const bytes = new Uint8Array(await res.arrayBuffer());
      const hash = await sha256Hex(bytes);
      if (hash === null ? bytes[0] === 0x4d && bytes[1] === 0x5a : hash === GAME_EXE_SHA256) return (origin = 'server'); // http(해시 못 셈)면 exe 머리 'MZ'로
    }
  } catch {
    // 서버에 없음
  }
  try {
    origin = (await s.get('VMO_WIN/vmv2.exe')) ? 'stored' : 'none';
  } catch {
    origin = 'none'; // 저장소를 못 씀(사생활 모드 등)
  }
  return origin;
}

/** 원본 바이트. 없으면 받는 방법을 알리는 오류 */
export async function originalBytes(path: string): Promise<Uint8Array> {
  const name = path.split('/').pop();
  if (origin === 'stored' && store) {
    const blob = await store.get(path);
    if (!blob) throw new Error(`${name}이(가) 저장소에 없습니다`); // Play가 이 까닭과 함께 마법사를 연다
    return new Uint8Array(await blob.arrayBuffer());
  }
  const res = await fromServer(path);
  if (!res.ok) {
    const how = path.startsWith('KO/') ? '`pnpm import-korean <한국어판 폴더>`를' : '`pnpm fetch-original`을';
    throw new Error(`${name}을(를) 불러오지 못했습니다(HTTP ${res.status}). ${how} 실행했는지 확인하세요.`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

/** 오디오 요소 등에 줄 주소: 서버면 그 경로, 저장소면 object URL(경로마다 하나), 저장소에 없으면 null */
export async function originalUrl(path: string): Promise<string | null> {
  if (origin !== 'stored' || !store) return served(path);
  const known = urls.get(path);
  if (known) return known;
  const blob = await store.get(path);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  urls.set(path, url);
  return url;
}
