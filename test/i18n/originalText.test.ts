import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { allSources } from '../../src/i18n/sources.ts';
import { exe, read } from '../ui/screenCases.ts';

// 공개 저장소로 내보내는 경로(tools/publish.sh의 ALLOW와 같게)
const PUBLIC = ['src', 'test', 'tools', 're/*.md', 'index.html', 'package.json', 'tsconfig.json', 'vite.config.ts', '.gitignore', 'README.md', '.github'];

// 원작 영문 문장: 25자 이상이고 마침표·물음표·느낌표로 끝나거나 다섯 낱말 이상. 짧은 UI 낱말(OK, Free Battle)·창 이름·서식 글은 둔다(사용자 결정 2026-11-10)
const sentences = [...new Set(allSources({ exe, read }).flatMap((s) => s.text.split('\n').map((l) => l.trim())))].filter(
  (t) => t.length >= 25 && /^[\x20-\x7e]+$/.test(t) && (/[.?!]$/.test(t) || t.split(/\s+/).length >= 5),
);

it('공개 파일에 원작 영문 문장이 없다(그대로도, 16진으로도)', () => {
  expect(sentences.length).toBeGreaterThan(1000);
  const files = execFileSync('git', ['ls-files', '-z', '--', ...PUBLIC], { encoding: 'utf8' }).split('\0').filter((f) => f && !f.endsWith('.woff2'));
  const hex = sentences.map((t) => [t, Buffer.from(t, 'latin1').toString('hex')] as const);
  const found = files.flatMap((f) => {
    const c = readFileSync(f, 'utf8');
    return [...sentences.filter((t) => c.includes(t)), ...hex.filter(([, h]) => c.includes(h)).map(([t]) => `(16진) ${t}`)].map((t) => `${f}: ${t}`);
  });
  expect(found).toEqual([]);
}, 30_000); // 공개 파일 약 20MB를 문장마다 훑는다
