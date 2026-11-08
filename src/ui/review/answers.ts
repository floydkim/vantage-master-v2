// 우리 번역 검수(설계 2026-11-07 §6): 검수 목록 항목과 사용자의 답. 다른 모듈을 가져오지 않는다(vite.config.ts도 쓴다)

/** 검수 목록 항목(original/i18n-review/items.json, git 밖) */
export interface ReviewItem {
  /** 번역할 글의 자리(src/i18n/sources.ts) */
  readonly where: string;
  /** 그 자리 번역이 든 표의 키(원문 해시, 자리 키가 있으면 where) */
  readonly key: string;
  readonly speaker?: string;
  readonly reason: string;
  /** 내 번역 말고 다른 후보 */
  readonly candidates: readonly string[];
  /** 제안을 반영하며 내가 고친 것: 답이 없으면 '다시 확인' */
  readonly recheck?: boolean;
}

/** 사용자의 답. choice는 [내 번역, ...candidates]의 차례. '이대로 좋음'은 ok, '제안 저장'은 proposed(proposal이 있으면 choice보다 앞선다) */
export interface Answer {
  readonly status: 'ok' | 'proposed';
  readonly choice?: number;
  readonly proposal?: string;
  readonly memo?: string;
  readonly at: string;
}

/** 키(ReviewItem.key) → 답(original/i18n-review/answers.json) */
export type Answers = Readonly<Record<string, Answer>>;

/** 한 항목의 답만 바꾼 새 답 모음(다른 항목은 그대로: 두 탭이 함께 저장해도 서로 지우지 않게 서버가 항목 하나씩 합친다) */
export const mergeAnswer = (all: Answers, key: string, answer: Answer): Answers => ({ ...all, [key]: answer });

/** 서버가 받는 답의 꼴 */
export function isAnswer(v: unknown): v is Answer {
  if (typeof v !== 'object' || v === null) return false;
  const a = v as Record<string, unknown>;
  const opt = (k: string, type: string) => a[k] === undefined || typeof a[k] === type;
  return (a.status === 'ok' || a.status === 'proposed') && typeof a.at === 'string' && opt('choice', 'number') && opt('proposal', 'string') && opt('memo', 'string');
}
