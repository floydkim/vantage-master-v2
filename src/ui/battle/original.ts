// 브라우저에서 게임이 쓰는 원본(vmv2.exe와 DAT)을 읽는다. 원본이 없으면 asset viewer처럼 받는 방법을 알리는 오류를 낸다.
// 언어가 한국어이고 한국어판 원본(original/KO, pnpm import-korean)이 있으면 글·대화 상자·메뉴와 바뀐 DAT 항목은 한국어판에서 읽는다.
import { koreanExe, openExeImage, type ExeImage } from '../../formats/exeImage.ts';
import { datFileName, openVmDat, type VmDat } from '../../formats/vmFiles.ts';
import { sha256Hex } from '../../originals/sha256.ts';
import { canvasGlyphs, hangulGlyphs, JAPANESE_FONT, setHangul, setWideGlyphs } from '../../i18n/hangul.ts';
import koStrings from '../../i18n/koStrings.json';
import { fetchBytes, loadDat } from '../assetViewer/loadDat.ts';
import type { ReadAny } from './sheet.ts';

// 0 공통 그림·팔레트, 1 유닛 그림·마스터 소멸, 2 공격 그림, 3 시전·대상 칸 효과 그림, 4 투사체 그림, 7 타이틀·오프닝 그림, 8 장 사이 장면, 9 엔딩·보고서,
// 10 맵·맵 AI, 11 맵 그림·하늘, 12 연출 스크립트, 13 효과음 WAV
const DATS = [0, 1, 2, 3, 4, 7, 8, 9, 10, 11, 12, 13];
// 한국어판에서 바뀐 DAT 항목(번호 → 첫·끝 항목): 장 사이 장면, 마스터 엔딩, 맵·MAS(글 자리만 다르고 수치는 같음).
// DATA00 26 안내 그림(GUIDE._BM)도 다르지만 같은 그림의 오른쪽을 잘라 도움창 폭을 624 → 528로 줄인 것뿐이라 영문판 그대로 둔다
const KOREAN = new Map([
  [8, [0, 5]],
  [9, [0, 26]],
  [10, [0, 89]],
]);
const LANGUAGE = 'vmv2.language';
// 대응표(koStrings.json)를 만든 한국어판 Vmv2.exe. 다른 빌드는 주소가 달라 읽지 않는다
const KO_EXE_SHA256 = 'bfdbd88a994b1e505acf0bc4a7c05d2020ef7c09a3b894d01569a511b28693c5';

export type Language = 'ko' | 'original';

/** 저장한 언어(처음은 한국어: 한국어판 원본이 없으면 원문으로 읽는다) */
export function language(): Language {
  try {
    return localStorage.getItem(LANGUAGE) === 'original' ? 'original' : 'ko';
  } catch {
    return 'ko';
  }
}

/** 언어를 바꾸고 다시 연다 */
export function setLanguage(value: Language): void {
  try {
    localStorage.setItem(LANGUAGE, value);
  } catch {
    // 저장소를 못 쓰면 바꿀 수 없다
  }
  location.reload();
}

/** 바뀐 DAT 항목만 한국어판에서 읽는다 */
export function koreanRead(en: ReadAny, ko: ReadAny): ReadAny {
  return (id) => {
    const range = KOREAN.get(id >>> 16);
    const i = id & 0xffff;
    return range && i >= range[0] && i <= range[1] ? ko(id) : en(id);
  };
}

/** 대응표를 만든 한국어판 exe이면 연다. 다른 빌드나 exe가 아닌 것(없는 파일 대신 온 index.html 등)이면 null */
export async function koreanImage(bytes: Uint8Array): Promise<ExeImage | null> {
  return (await sha256Hex(bytes)) === KO_EXE_SHA256 ? openExeImage(bytes) : null; // 확인할 수 없거나(http) 다르면 원문으로 연다
}

export interface Original {
  readonly exe: ExeImage;
  readonly read: ReadAny;
  readonly dat10: VmDat;
  readonly dat13: VmDat;
  /** 한국어판으로 읽었는가(언어가 한국어라도 자료가 없거나 다른 빌드면 false) */
  readonly korean: boolean;
}

let loading: Promise<Original> | null = null;

export function loadOriginal(): Promise<Original> {
  loading ??= (async () => {
    // 함께 받는다(하나씩 기다리면 요청 지연이 파일 수만큼 쌓임). 한국어판 exe는 없으면 null(원문으로)
    const koExe = language() === 'ko' ? fetchBytes('Vmv2.exe', 'KO').catch(() => null) : null;
    const [exeBytes, loaded, bytes] = await Promise.all([fetchBytes('vmv2.exe'), Promise.all(DATS.map(loadDat)), koExe]);
    const exe = openExeImage(exeBytes);
    const dats = new Map(DATS.map((n, i) => [n, loaded[i].dat]));
    const read = (id: number): Uint8Array => {
      const dat = dats.get(id >>> 16);
      if (!dat) throw new Error(`DATA${String(id >>> 16).padStart(2, '0')}.DAT을 미리 읽지 않았습니다`);
      return dat.read(id & 0xffff);
    };
    const original = { exe, read, dat10: dats.get(10)!, dat13: dats.get(13)!, korean: false };
    const ko = bytes && (await koreanImage(bytes));
    if (!ko) {
      setWideGlyphs(canvasGlyphs(new TextDecoder('shift_jis'), JAPANESE_FONT)); // 영문판의 장 사이 장면 글(일본어)
      return original;
    }
    const koDats = new Map(await Promise.all([...KOREAN.keys()].map(async (n) => [n, openVmDat(n, await fetchBytes(datFileName(n), 'KO'))] as const)));
    const pairs = new Map(Object.entries(koStrings).map(([e, k]) => [Number(e), Number(k)]));
    const korean = { ...original, korean: true, exe: koreanExe(exe, ko, pairs), read: koreanRead(read, (id) => koDats.get(id >>> 16)!.read(id & 0xffff)) };
    setHangul(await hangulGlyphs()); // 한국어 원본을 다 읽은 뒤에만 켠다
    return korean;
  })();
  loading.catch(() => (loading = null));
  return loading;
}
