// 내 번역 작업 파일(TSV: where<TAB>한국어, \n·\r·\t·\\는 풀어 씀, =where는 원문 대신 그 자리를 키로)을 src/i18n/ko.json에 합친다. where → 키는 내려받기(pnpm i18n-dump)의
// original/i18n-work/sources.json에서 찾는다. 실행: pnpm i18n-merge [--replace] original/i18n-work/<종류>.tsv (--replace: 검수 반영, 표에 있는 번역을 바꾼다)
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

type Table = Record<string, string>;

const unescape = (s: string) => s.replace(/\\([nrt\\])/g, (_, c: string) => ({ n: '\n', r: '\r', t: '\t', '\\': '\\' })[c]!);

/** 표에 TSV를 합친 새 표(키 정렬). 없는 where, 같은 키에 다른 번역(TSV 안이나 이미 표에 있는 것)은 오류이고 오류가 있으면 표는 그대로 */
export function mergeKo(table: Readonly<Table>, sources: readonly { readonly where: string; readonly key: string }[], tsv: string, options: { readonly replace?: boolean } = {}): { table: Table; added: number; errors: string[] } {
  const keyOf = new Map(sources.map((s) => [s.where, s.key]));
  const next: Table = { ...table };
  const errors: string[] = [];
  const inFile = new Map<string, string>();
  let added = 0;
  tsv.split('\n').forEach((line, n) => {
    if (line.trim() === '') return;
    const tab = line.indexOf('\t');
    const at = line.startsWith('=');
    const where = (tab < 0 ? line : line.slice(0, tab)).slice(at ? 1 : 0);
    const key = at ? (keyOf.has(where) ? where : undefined) : keyOf.get(where);
    if (tab < 0 || key === undefined) return errors.push(`${n + 1}줄: ${tab < 0 ? '탭 없음' : `없는 자리 ${where}`}`);
    const value = unescape(line.slice(tab + 1));
    const earlier = inFile.get(key);
    inFile.set(key, value);
    if (earlier !== undefined ? earlier !== value : !options.replace && next[key] !== undefined && next[key] !== value) errors.push(`${n + 1}줄: ${where}의 키 ${key}에 다른 번역이 있음`);
    else if (next[key] !== value) {
      next[key] = value;
      added++;
    }
  });
  const sorted = Object.fromEntries(Object.keys(next).sort().map((k) => [k, next[k]]));
  return { table: errors.length ? { ...table } : sorted, added: errors.length ? 0 : added, errors };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const replace = args[0] === '--replace';
  const file = args[replace ? 1 : 0];
  if (!file) throw new Error('사용법: pnpm i18n-merge [--replace] <tsv>');
  const out = 'src/i18n/ko.json';
  const sources = JSON.parse(readFileSync('original/i18n-work/sources.json', 'utf8')) as { where: string; key: string }[];
  const r = mergeKo(JSON.parse(readFileSync(out, 'utf8')) as Table, sources, readFileSync(file, 'utf8'), { replace });
  if (r.errors.length) {
    console.error(r.errors.join('\n'));
    process.exit(1);
  }
  writeFileSync(out, `${JSON.stringify(r.table, null, 2)}\n`);
  console.log(`${r.added}개 넣음`);
}
