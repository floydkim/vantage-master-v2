// 검수 목록(original/i18n-review/items.json, git 밖)이 있을 때만: 자리·키·이유·후보의 꼴
import { existsSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import table from '../../src/i18n/ko.json';
import { allSources, sourceKey } from '../../src/i18n/sources.ts';
import type { ReviewItem } from '../../src/ui/review/answers.ts';
import { exe, read } from '../ui/screenCases.ts';

const FILE = new URL('../../original/i18n-review/items.json', import.meta.url);

it.skipIf(!existsSync(FILE))('검수 목록: 자리가 번역할 글에 있고, 키가 그 자리 번역의 키이며, 이유·후보가 있고, 자리가 겹치지 않는다', () => {
  const items = JSON.parse(readFileSync(FILE, 'utf8')) as ReviewItem[];
  const t = table as Readonly<Record<string, string>>;
  const at = new Map(allSources({ exe, read }).map((s) => [s.where, s]));
  const wrong = items.flatMap((item) => {
    const s = at.get(item.where);
    const key = s && (item.where in t ? item.where : sourceKey(s));
    const mine = key === undefined ? undefined : t[key];
    const bad = [
      !s && '없는 자리',
      s && item.key !== key && `키 ${item.key} ≠ ${key}`,
      mine === undefined && '번역 없음',
      !item.reason.trim() && '이유 없음',
      item.candidates.some((c) => !c || c === mine) && '빈 후보 또는 내 번역과 같은 후보',
    ].filter(Boolean);
    return bad.length ? [`${item.where}: ${bad.join(', ')}`] : [];
  });
  expect(wrong).toEqual([]);
  expect(new Set(items.map((i) => i.where)).size).toBe(items.length);
});
