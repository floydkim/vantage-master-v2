// 우리 한국어 번역(설계 docs/superpowers/specs/2026-11-07-our-korean-translation-design.md). 표의 키는 원문 글 바이트의 sha16이고 값은 우리 글이다.
// 원문 글은 저장소에 넣지 않는다. 표에 없는 글은 원문 그대로다
import { cp949 } from './hangul.ts';
import table from './ko.json';
import { sha16 } from './koFixes.ts';

export type KoTable = Readonly<Record<string, string>>;

export interface Translator {
  /** 바이트 문자열(글자 = 바이트: exe 글·DATA 글·장면 글) → CP949 바이트 문자열 */
  readonly text: (s: string) => string;
  /** 리소스 글(UTF-16: 대화 상자·메뉴) → 유니코드 글. 자리(where, sources.ts의 자리 이름)가 표에 있으면 그것이 이긴다(같은 원문을 자리마다 다르게) */
  readonly ui: (s: string, where?: string) => string;
}

/** 바이트 문자열의 키 */
export const byteKey = (s: string): string => sha16(Uint8Array.from(s, (c) => c.charCodeAt(0)));

/** UTF-16 글의 키(UTF-16LE 바이트) */
export const uiKey = (s: string): string => sha16(new Uint8Array(Uint16Array.from(s, (c) => c.charCodeAt(0)).buffer));

export function translator(t: KoTable): Translator {
  return {
    text: (s) => {
      const v = t[byteKey(s)];
      return v === undefined ? s : cp949(v);
    },
    ui: (s, where) => (where === undefined ? undefined : t[where]) ?? t[uiKey(s)] ?? s,
  };
}

export const ko: Translator = translator(table);
