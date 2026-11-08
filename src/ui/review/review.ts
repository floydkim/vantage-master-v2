// 검수 페이지의 계산: 상태, 거르기, 글 검사(설계 2026-11-07 §5·§6), 앞뒤 글
import { cp949 } from '../../i18n/hangul.ts';
import type { Source } from '../../i18n/sources.ts';
import type { Answer, Answers, ReviewItem } from './answers.ts';

export type ReviewStatus = '안 봄' | '좋음' | '제안함' | '다시 확인';

export const statusOf = (item: ReviewItem, answer?: Answer): ReviewStatus =>
  answer ? (answer.status === 'ok' ? '좋음' : '제안함') : item.recheck ? '다시 확인' : '안 봄';

export interface ReviewFilter {
  readonly kind?: string;
  readonly status?: ReviewStatus;
  readonly query?: string;
}

/** 종류(where 앞부분)·상태·찾기(text(item)와 이유·후보에서)로 거른다 */
export function filterItems(items: readonly ReviewItem[], answers: Answers, f: ReviewFilter, text: (item: ReviewItem) => string): ReviewItem[] {
  return items.filter(
    (i) =>
      (!f.kind || i.where.startsWith(`${f.kind}:`)) &&
      (!f.status || statusOf(i, answers[i.key]) === f.status) &&
      (!f.query || [text(i), i.reason, ...i.candidates].join('\n').includes(f.query)),
  );
}

export interface TextCheck {
  /** 바이트 수(한글 2바이트) */
  readonly bytes: number;
  /** 칸 한도(바이트), 시험만 아는 칸은 null */
  readonly limit: number | null;
  readonly fits: boolean;
  /** 바이트 자리에서 CP949로 못 쓰는 글자(cp949()가 빼 버림) */
  readonly badChars: readonly string[];
}

const HELP_LINES = 6;
const HELP_LINE_BYTES = 62; // 도움창 글 자리 x 0x7f부터 폭 624
const DESCRIPTION = 0x127; // DATA10 설명 칸(+0x78·+0x1a0·MAS +0x1c) 바이트, 끝 0 제외

/** 번역 글 검사. source는 그 자리 원문(바이트 문자열): 장면·엔딩 줄 한도는 max(60, 원문 바이트) */
export function checkText(where: string, text: string, source: string): TextCheck {
  const [kind, , at] = where.split(':');
  if (kind === 'dialog' || kind === 'menu') return { bytes: [...text].reduce((n, c) => n + (c < '\x80' ? 1 : 2), 0), limit: null, fits: true, badChars: [] };
  const badChars = [...text].filter((c) => c >= '\x80' && cp949(c) === '');
  const bytes = cp949(text).length;
  let limit: number | null = null;
  let lines = true;
  if ((kind === 'map' || kind === 'mas') && at === '0x0') limit = kind === 'map' ? 0x17 : 0x13;
  else if (kind === 'map' || kind === 'mas') {
    limit = DESCRIPTION;
    const ls = text.replace(/\n$/, '').split('\n');
    lines = ls.length <= HELP_LINES && ls.every((l) => cp949(l).length <= HELP_LINE_BYTES);
  } else if (kind === 'scene' || kind === 'ending') limit = Math.max(60, source.length);
  return { bytes, limit, fits: badChars.length === 0 && (limit === null || bytes <= limit) && lines, badChars };
}

const group = (where: string) => where.slice(0, where.lastIndexOf(':'));

/** 같은 무리(where의 마지막 : 앞이 같은 것: 같은 장면·엔딩 편, 같은 대화 상자, 같은 맵, exe는 exe끼리)에서 앞뒤 n개(자기 포함) */
export function context(sources: readonly Source[], where: string, n = 3): Source[] {
  const same = sources.filter((s) => group(s.where) === group(where));
  const i = same.findIndex((s) => s.where === where);
  return i < 0 ? [] : same.slice(Math.max(0, i - n), i + n + 1);
}

const FIELD: Readonly<Record<string, string>> = { '0x0': '이름', '0x78': '시나리오 설명', '0x1a0': '설명', '0x1c': '소개' };

/** 목록에 보일 사람이 읽는 자리 이름(줄은 1부터) */
export function placeLabel(where: string): string {
  const [kind, a, b] = where.split(':');
  switch (kind) {
    case 'ending':
    case 'scene':
      return `${kind === 'ending' ? '엔딩' : '장면'} ${a} · ${Number(b) + 1}줄`;
    case 'map':
      return `맵 ${a} ${FIELD[b]}`;
    case 'mas':
      return `적 마스터 ${a} ${FIELD[b]}`;
    case 'dialog':
      return `대화 상자 ${a} ${b === 't' ? '제목' : `글 ${b}`}`;
    case 'menu':
      return `메뉴 ${b}`;
    default:
      return `게임 글 ${a}`;
  }
}
