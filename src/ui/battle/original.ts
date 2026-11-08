// 브라우저에서 게임이 쓰는 원본(vmv2.exe와 DAT)을 읽는다. 원본이 없으면 asset viewer처럼 받는 방법을 알리는 오류를 낸다.
// 언어가 한국어이고 한국어판 원본(original/KO, pnpm import-korean)이 있으면 글·대화 상자·메뉴와 바뀐 DAT 항목은 한국어판에서 읽는다.
// 한국어판이 없거나 다른 빌드면 영문판 글을 우리 번역(src/i18n/ko.json)으로 바꿔 보인다.
// 효과음·음성(DATA13)도 한국어판 것(한국어 더빙 14개)이 있으면 그것을, 없거나 열 수 없으면 영문판 것을 쓴다(DATA13 없이 들인 한국어판).
import { koreanExe, openExeImage, type ExeImage } from '../../formats/exeImage.ts';
import { datFileName, openVmDat, type VmDat } from '../../formats/vmFiles.ts';
import { sha256Hex } from '../../originals/sha256.ts';
import { canvasGlyphs, hangulGlyphs, JAPANESE_FONT, setHangul, setWideGlyphs } from '../../i18n/hangul.ts';
import { ko, type Translator } from '../../i18n/ko.ts';
import { fixLine } from '../../i18n/koFixes.ts';
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
const FIXES = 'vmv2.koFix';
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

/** 오역 보정(설계 2026-11-05-korean-fixes): 한국어판으로 읽을 때만, 처음은 꺼짐 */
export function fixesOn(): boolean {
  try {
    return localStorage.getItem(FIXES) === '1';
  } catch {
    return false;
  }
}

/** 오역 보정을 바꾸고 다시 연다(보정은 원본을 읽을 때 적용) */
export function setFixesOn(on: boolean): void {
  try {
    localStorage.setItem(FIXES, on ? '1' : '0');
  } catch {
    // 저장소를 못 쓰면 바꿀 수 없다
  }
  location.reload();
}

/** exe 글(cString)을 line으로, 있으면 리소스 글을 ui로 바꿔 읽는다 */
export function textExe(exe: ExeImage, line: (s: string) => string, ui?: (s: string) => string): ExeImage {
  const texts = new Map<number, string>();
  return {
    ...exe,
    cString(va) {
      let s = texts.get(va);
      if (s === undefined) texts.set(va, (s = line(exe.cString(va))));
      return s;
    },
    ...(ui && { uiText: ui }),
  };
}

/** exe 글(cString)만 보정 표를 거친다 */
export const fixedExe = (exe: ExeImage): ExeImage => textExe(exe, fixLine);

/**
 * DATA10 글 칸(맵 0~51: +0·+0x78·+0x1a0, 적 마스터 MAS 52~89: +0·+0x1c)을 line으로 바꾼다. 바꾼 글 + 0이 칸 끝 안이고 늘어난 자리가 비어 있을 때만 쓴다.
 * 맵 설명(+0x1a0)의 칸 끝은 마정석 표(+0x2c8) 앞이다
 */
export function textRead(read: ReadAny, line: (s: string) => string): ReadAny {
  return (id) => {
    const bytes = read(id);
    const i = id & 0xffff;
    if (id >>> 16 !== 10 || i > 89) return bytes;
    const fields = i < 52 ? [[0, 0x18], [0x78, 0x1a0], [0x1a0, 0x2c8]] : [[0, 0x14], [0x1c, 0x144]];
    let out = bytes;
    for (const [at, end] of fields) {
      const stop = bytes.indexOf(0, at);
      const s = String.fromCharCode(...bytes.subarray(at, stop < 0 ? bytes.length : stop));
      const fixed = line(s);
      const free = bytes.subarray(at + s.length, at + fixed.length + 1).every((b) => b === 0);
      if (fixed === s || at + fixed.length + 1 > end || !free) continue;
      if (out === bytes) out = bytes.slice();
      out.set(Uint8Array.from(fixed + '\0', (c) => c.charCodeAt(0)), at);
    }
    return out;
  };
}

/** DATA10 글 칸에 보정 표 */
export const fixedRead = (read: ReadAny): ReadAny => textRead(read, fixLine);

/** 우리 번역(한국어판 없이 한국어): exe 글·리소스 글·DATA10 글 칸·장면 글을 번역기로. 한국어판으로 읽은 것은 아니다(korean 그대로) */
export function translated(original: Original, t: Translator = ko): Original {
  return { ...original, exe: textExe(original.exe, t.text, t.ui), read: textRead(original.read, t.text), fix: t.text };
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
  /** 장면 글(바이트 문자열)의 보정: 한국어판이고 보정이 켜져 있으면 fixLine, 아니면 그대로 */
  readonly fix: (s: string) => string;
}

let loading: Promise<Original> | null = null;

export function loadOriginal(): Promise<Original> {
  loading ??= (async () => {
    // 함께 받는다(하나씩 기다리면 요청 지연이 파일 수만큼 쌓임). 한국어판 exe는 없으면 null(우리 번역으로)
    const koExe = language() === 'ko' ? fetchBytes('Vmv2.exe', 'KO').catch(() => null) : null;
    const [exeBytes, loaded, bytes] = await Promise.all([fetchBytes('vmv2.exe'), Promise.all(DATS.map(loadDat)), koExe]);
    const exe = openExeImage(exeBytes);
    const dats = new Map(DATS.map((n, i) => [n, loaded[i].dat]));
    const read = (id: number): Uint8Array => {
      const dat = dats.get(id >>> 16);
      if (!dat) throw new Error(`DATA${String(id >>> 16).padStart(2, '0')}.DAT을 미리 읽지 않았습니다`);
      return dat.read(id & 0xffff);
    };
    const original = { exe, read, dat10: dats.get(10)!, dat13: dats.get(13)!, korean: false, fix: (s: string) => s };
    const ko = bytes && (await koreanImage(bytes));
    if (!ko) {
      if (language() === 'ko') {
        // 한국어판이 없거나 다른 빌드: 우리 번역(설계 2026-11-07). 한글 글리프는 켜되 그리기 자리는 영문판 exe의 것
        setHangul(await hangulGlyphs(), false);
        return translated(original);
      }
      setWideGlyphs(canvasGlyphs(new TextDecoder('shift_jis'), JAPANESE_FONT)); // 영문판의 장 사이 장면 글(일본어)
      return original;
    }
    const koSounds = fetchBytes(datFileName(13), 'KO').then((b) => openVmDat(13, b)).catch(() => null); // 없거나 LB DAT가 아니면(index.html 등) 영문판 소리
    const koDats = new Map(await Promise.all([...KOREAN.keys()].map(async (n) => [n, openVmDat(n, await fetchBytes(datFileName(n), 'KO'))] as const)));
    const pairs = new Map(Object.entries(koStrings).map(([e, k]) => [Number(e), Number(k)]));
    const dat13 = (await koSounds) ?? original.dat13;
    const koExeImage = koreanExe(exe, ko, pairs);
    const koRead = koreanRead(read, (id) => koDats.get(id >>> 16)!.read(id & 0xffff));
    const fixes = fixesOn();
    const korean = { ...original, korean: true, dat13, exe: fixes ? fixedExe(koExeImage) : koExeImage, read: fixes ? fixedRead(koRead) : koRead, fix: fixes ? fixLine : original.fix };
    setHangul(await hangulGlyphs()); // 한국어 원본을 다 읽은 뒤에만 켠다
    return korean;
  })();
  loading.catch(() => (loading = null));
  return loading;
}
