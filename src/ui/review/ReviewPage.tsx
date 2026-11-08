// 우리 번역 검수 페이지(개발 서버 #review, 설계 2026-11-07 §6): 왼쪽 목록, 오른쪽 상세. 답은 누를 때마다 개발 서버가 파일에 합쳐 저장한다.
// 원문·정발판 글은 열 때마다 원본 파일에서 읽는다(저장소에 넣지 않음)
import { useEffect, useMemo, useState } from 'react';
import { koreanExe, openExeImage } from '../../formats/exeImage.ts';
import { datFileName, openVmDat } from '../../formats/vmFiles.ts';
import table from '../../i18n/ko.json';
import koStrings from '../../i18n/koStrings.json';
import { allSources, type Edition, pairedText, type Source, sourceKey } from '../../i18n/sources.ts';
import { fetchBytes, loadDat } from '../assetViewer/loadDat.ts';
import { koreanImage, koreanRead } from '../battle/original.ts';
import type { Answer, Answers, ReviewItem } from './answers.ts';
import { checkText, context, filterItems, placeLabel, type ReviewStatus, statusOf } from './review.ts';

interface Loaded {
  readonly items: readonly ReviewItem[];
  readonly answers: Answers;
  readonly en: Edition;
  readonly kr: Edition | null;
  readonly sources: readonly Source[];
}

/** 저장하지 않은 칸(항목별). 다른 항목으로 가거나 새로 고쳐도 남게 브라우저 저장소에도 둔다 */
interface Draft {
  readonly choice: number;
  readonly proposal: string;
  readonly memo: string;
}
const DRAFTS = 'vmv2.reviewDrafts';
const storedDrafts = (): Record<string, Draft> => {
  try {
    return JSON.parse(localStorage.getItem(DRAFTS) ?? '{}') as Record<string, Draft>;
  } catch {
    return {};
  }
};

const ICON: Record<ReviewStatus, string> = { '안 봄': '○', 좋음: '✓', 제안함: '✎', '다시 확인': '↺' };
const STATUSES: readonly ReviewStatus[] = ['안 봄', '좋음', '제안함', '다시 확인'];
const mine = (item: ReviewItem): string => (table as Readonly<Record<string, string>>)[item.key] ?? '';
const bytes = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const sjis = new TextDecoder('shift_jis');
const euckr = new TextDecoder('euc-kr');
/** 사람이 읽는 원문: 장면은 Shift-JIS, 리소스 글은 그대로, 나머지는 바이트 그대로(영어) */
const readable = (s: Source) => (s.kind === 'scene' ? sjis.decode(bytes(s.text)) : s.text);

async function load(): Promise<Loaded> {
  const [items, answers, exeBytes, ...dats] = await Promise.all([
    fetch('/i18n-review/items.json').then((r) => (r.ok ? (r.json() as Promise<ReviewItem[]>) : Promise.reject(new Error('검수 목록이 없습니다(original/i18n-review/items.json)')))),
    fetch('/__review/answers').then((r) => r.json() as Promise<Answers>),
    fetchBytes('vmv2.exe'),
    ...[8, 9, 10].map(loadDat),
  ]);
  const exe = openExeImage(exeBytes as Uint8Array);
  const byDat = new Map([8, 9, 10].map((n, i) => [n, (dats[i] as Awaited<ReturnType<typeof loadDat>>).dat]));
  const read = (id: number) => byDat.get(id >>> 16)!.read(id & 0xffff);
  const en: Edition = { exe, read };
  let kr: Edition | null = null;
  try {
    const ko = await koreanImage(await fetchBytes('Vmv2.exe', 'KO'));
    if (ko) {
      const koDats = new Map(await Promise.all([8, 9, 10].map(async (n) => [n, openVmDat(n, await fetchBytes(datFileName(n), 'KO'))] as const)));
      const pairs = new Map(Object.entries(koStrings).map(([e, k]) => [Number(e), Number(k)]));
      kr = { exe: koreanExe(exe, ko, pairs), read: koreanRead(read, (id) => koDats.get(id >>> 16)!.read(id & 0xffff)) };
    }
  } catch {
    // 한국어판이 없으면 정발판 글을 보이지 않는다
  }
  return { items: items as ReviewItem[], answers: answers as Answers, en, kr, sources: allSources(en) };
}

export function ReviewPage() {
  const [data, setData] = useState<Loaded | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Answers>({});
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState<ReviewStatus | ''>('');
  const [query, setQuery] = useState('');
  const [where, setWhere] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>(storedDrafts);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    load().then(
      (d) => {
        setData(d);
        setAnswers(d.answers);
        setWhere(d.items[0]?.where ?? null);
      },
      (e: unknown) => setProblem(e instanceof Error ? e.message : String(e)),
    );
  }, []);
  const at = useMemo(() => new Map(data?.sources.map((s) => [s.where, s]) ?? []), [data]);
  const item = data?.items.find((i) => i.where === where) ?? null;
  const saved = item ? answers[item.key] : undefined;
  // 칸: 저장하지 않은 초안이 있으면 그것, 없으면 저장된 답
  const { choice, proposal, memo } = (where && drafts[where]) || { choice: saved?.choice ?? 0, proposal: saved?.proposal ?? '', memo: saved?.memo ?? '' };
  const keepDrafts = (next: Record<string, Draft>) => {
    setDrafts(next);
    try {
      localStorage.setItem(DRAFTS, JSON.stringify(next));
    } catch {
      // 저장소를 못 쓰면 이 탭에서만 남는다
    }
  };
  const edit = (change: Partial<Draft>) => where && keepDrafts({ ...drafts, [where]: { choice, proposal, memo, ...change } });
  const go = (next: string) => {
    setWhere(next);
    setSaveError(null);
  };

  if (problem) return <p style={{ color: 'crimson', padding: 16 }}>{problem}</p>;
  if (!data) return <p style={{ padding: 16 }}>원본을 읽는 중…</p>;
  const shown = filterItems(data.items, answers, { kind, status: status || undefined, query }, (i) => {
    const s = at.get(i.where);
    return `${s ? readable(s) : ''}\n${mine(i)}`;
  });
  const done = data.items.filter((i) => answers[i.key]).length;
  const recheck = data.items.filter((i) => statusOf(i, answers[i.key]) === '다시 확인').length;
  const source = item ? at.get(item.where) : undefined;
  const options = item ? [mine(item), ...item.candidates] : [];
  const target = proposal || options[choice] || '';
  const check = item && source ? checkText(item.where, target, source.text) : null;
  const official = item && data.kr ? pairedText(item.where, data.en, data.kr) : null;
  const changed = item && source && item.key !== item.where && sourceKey(source) !== item.key;

  const save = async (s: Answer['status']) => {
    if (!item) return;
    if (s === 'proposed' && !proposal && choice === 0) return setSaveError('후보를 고르거나 직접 제안을 적어 주세요.');
    if (s === 'ok' && (proposal || choice !== 0)) return setSaveError('후보를 골랐거나 직접 제안을 적었습니다. 제안 저장을 누르거나, 제 번역을 고르고 제안 칸을 비운 뒤 다시 누르세요.');
    const answer: Answer = { status: s, at: new Date().toISOString(), ...(memo && { memo }), ...(s === 'proposed' && (proposal ? { proposal } : { choice })) };
    try {
      const r = await fetch('/__review/answers', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: item.key, answer }) });
      if (!r.ok) throw new Error(`서버 ${r.status}`);
      setAnswers((all) => ({ ...all, [item.key]: answer }));
      const { [item.where]: _, ...rest } = drafts; // 초안은 답이 되었다
      keepDrafts(rest);
      setSaveError(null);
    } catch (e) {
      setSaveError(`저장하지 못했습니다(${e instanceof Error ? e.message : e}). 적은 글은 그대로 있습니다.`);
    }
  };
  const nextOpen = () => {
    const i = shown.findIndex((x) => x.where === where);
    const next = [...shown.slice(i + 1), ...shown.slice(0, i + 1)].find((x) => ['안 봄', '다시 확인'].includes(statusOf(x, answers[x.key])));
    if (next) go(next.where);
  };

  const box: React.CSSProperties = { border: '1px solid #ccc', borderRadius: 6, padding: '8px 10px', marginBottom: 8, background: '#fafafa', whiteSpace: 'pre-wrap' };
  return (
    <div style={{ font: '14px/1.55 system-ui, sans-serif', padding: 12, color: '#222', background: '#fff', minHeight: '100vh', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <b>번역 검수</b>
        <span>
          확인 {done} / {data.items.length} · 다시 확인 {recheck}
        </span>
        <select aria-label="종류" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">종류: 전체</option>
          {[...new Set(data.items.map((i) => i.where.split(':')[0]))].map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
        <select aria-label="상태" value={status} onChange={(e) => setStatus(e.target.value as ReviewStatus | '')}>
          <option value="">상태: 전체</option>
          {STATUSES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <input aria-label="찾기" placeholder="찾기…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, flex: '0 0 32%', maxHeight: '85vh', overflow: 'auto', borderRight: '1px solid #ddd' }}>
          {shown.map((i) => (
            <li key={i.where}>
              <button type="button" onClick={() => go(i.where)} style={{ all: 'unset', cursor: 'pointer', display: 'block', width: '100%', padding: '4px 6px', boxSizing: 'border-box', background: i.where === where ? '#e8eefc' : undefined }}>
                {ICON[statusOf(i, answers[i.key])]} {placeLabel(i.where)}
                {i.speaker ? ` · ${i.speaker}` : ''}
                <small style={{ color: '#777' }}> {mine(i).replace(/\s+/g, ' ').slice(0, 18)}</small>
              </button>
            </li>
          ))}
        </ul>
        {item && source && (
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ marginBottom: 6 }}>
              <b>{placeLabel(item.where)}</b> <small style={{ color: '#777' }}>{item.where}</small>
              {item.speaker ? ` · 화자: ${item.speaker}` : ''}
              {changed ? <span style={{ color: 'crimson' }}> · 원문이 다름(목록을 만든 뒤 원문이 바뀜)</span> : null}
            </div>
            <div style={box}>
              <small>원문</small>
              <br />
              {readable(source)}
            </div>
            <details style={box}>
              <summary>앞뒤 글(번역문)</summary>
              {context(data.sources, item.where).map((s) => (
                <div key={s.where} style={{ fontWeight: s.where === item.where ? 700 : 400 }}>
                  {s.where === item.where ? '▶ ' : ''}
                  {(table as Readonly<Record<string, string>>)[s.where] ?? (table as Readonly<Record<string, string>>)[sourceKey(s)] ?? readable(s)}
                </div>
              ))}
            </details>
            <div style={{ ...box, background: '#fff4e0' }}>
              <small>확인 이유</small>
              <br />
              {item.reason}
            </div>
            <div style={box}>
              <small>정발판(참고)</small>
              <br />
              {official === null ? '—' : source.wide ? official : euckr.decode(bytes(official))}
            </div>
            <div style={box}>
              {options.map((o, k) => (
                <label key={k} style={{ display: 'block' }}>
                  <input type="radio" name="choice" checked={choice === k} onChange={() => edit({ choice: k })} /> {k === 0 ? '(제 번역) ' : `(후보 ${k}) `}
                  {o}
                </label>
              ))}
              <textarea aria-label="직접 제안" placeholder="직접 제안…" value={proposal} onChange={(e) => edit({ proposal: e.target.value })} rows={3} style={{ width: '100%', marginTop: 6 }} />
              <textarea aria-label="메모" placeholder="메모…" value={memo} onChange={(e) => edit({ memo: e.target.value })} rows={2} style={{ width: '100%' }} />
              {check && (
                <small style={{ color: check.fits ? '#555' : 'crimson' }}>
                  {check.bytes}
                  {check.limit === null ? '바이트(칸 한도는 시험으로 확인)' : ` / ${check.limit}바이트`}
                  {check.badChars.length ? ` · CP949로 못 쓰는 글자: ${check.badChars.join(' ')}` : ''}
                  {check.fits ? '' : ' · 칸에 들어가지 않음'}
                </small>
              )}
            </div>
            <button type="button" onClick={() => void save('ok')}>
              이대로 좋음
            </button>{' '}
            <button type="button" onClick={() => void save('proposed')}>
              제안 저장
            </button>{' '}
            <button type="button" onClick={nextOpen}>
              다음 안 본 것
            </button>
            {saveError && <p style={{ color: 'crimson' }}>{saveError}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
