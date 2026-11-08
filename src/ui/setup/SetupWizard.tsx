import { type DragEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { type Collected, collectAlbum, collectGame, collectKorean, musicNote, type Picked } from '../../originals/collect.ts';
import type { FileStore } from '../../originals/store.ts';
import { amounts, canNext, changes, koreanTracks, optionalButton, PARTS, type Part, type Picks, removal, type Stored, storedOf } from './wizard.ts';
import './setup.css';

const VM_ONLINE = 'https://www.falcom.co.jp/vantage/download/VMOnline.exe'; // 팔콤 공식 무료 배포판(V2 영문판)
const STEPS = 5;
type Kind = 'game' | 'korean' | 'album';
const COLLECT: Record<Kind, (p: readonly Picked[]) => Promise<Collected>> = { game: collectGame, korean: collectKorean, album: collectAlbum };

/** 끌어다 놓은 파일·폴더(하위까지)를 놓은 것 기준 상대 경로로. 항목은 drop 이벤트 안에서 바로 꺼내야 한다 */
function dropped(e: DragEvent): Promise<Picked[]> {
  const entries = [...e.dataTransfer.items].map((i) => i.webkitGetAsEntry()).filter((x): x is FileSystemEntry => x !== null);
  const out: Picked[] = [];
  const walk = async (entry: FileSystemEntry): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((ok, fail) => (entry as FileSystemFileEntry).file(ok, fail));
      out.push({ path: entry.fullPath.replace(/^\//, ''), blob: file });
      return;
    }
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((ok, fail) => reader.readEntries(ok, fail));
      if (!batch.length) return;
      for (const child of batch) await walk(child);
    }
  };
  return (async () => {
    for (const entry of entries) await walk(entry);
    return out;
  })();
}

const fromInput = (files: FileList | null): Picked[] => [...(files ?? [])].map((f) => ({ path: f.webkitRelativePath || f.name, blob: f }));

/** 끌어다 놓기 칸과 [파일…]·[폴더…] */
function Source({ file, onPick }: { readonly file?: boolean; readonly onPick: (p: Picked[] | Promise<Picked[]>) => void }) {
  const [over, setOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const dirInput = useRef<HTMLInputElement>(null);
  return (
    <>
      <div
        className={`setup-drop${over ? ' over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          onPick(dropped(e)); // 읽기 실패도 pick이 까닭으로 보인다
        }}
      >
        여기로 끌어다 놓기
      </div>
      <div className="setup-row">
        {file && (
          <button type="button" className="w98-push" onClick={() => fileInput.current?.click()}>
            파일…
          </button>
        )}
        <button type="button" className="w98-push" onClick={() => dirInput.current?.click()}>
          폴더…
        </button>
        <input ref={fileInput} type="file" accept=".exe" hidden onChange={(e) => (onPick(fromInput(e.target.files)), (e.target.value = ''))} />
        <input ref={dirInput} type="file" hidden {...{ webkitdirectory: '' }} onChange={(e) => (onPick(fromInput(e.target.files)), (e.target.value = ''))} />
      </div>
    </>
  );
}

const Result = ({ r, empty }: { readonly r?: Collected; readonly empty: ReactNode }) =>
  !r ? <div className="setup-dim">{empty}</div> : r.ok ? <div className="setup-ok">✓ {r.note}</div> : <div className="setup-bad">✗ {r.reason}</div>;

/** 마법사·제거 화면의 Win98 설치 프로그램 창(왼쪽 띠, 아래 단추 줄) */
function Window({ title, foot, children }: { readonly title: string; readonly foot: ReactNode; readonly children: ReactNode }) {
  return (
    <div className="setup-backdrop">
      <div className="w98-window w98-dialog setup" role="dialog" aria-modal="true" aria-label={title}>
        <div className="w98-caption">
          <span className="title">{title}</span>
        </div>
        <div className="setup-body">
          <div className="setup-side" />
          <div className="setup-main">{children}</div>
        </div>
        <div className="setup-foot">{foot}</div>
      </div>
    </div>
  );
}

/** 이 앱이 localStorage에 둔 키(세이브·설정). 저장소를 막았으면 없음 */
function localKeys(): string[] {
  try {
    return Object.keys(localStorage).filter((k) => k.startsWith('vmv2'));
  } catch {
    return [];
  }
}

const PART_LABEL: Record<Part, string> = { game: '게임 파일', korean: '한국어판', music: '음악', saves: '세이브 데이터', settings: '설정(옵션·BGM 장치·화면 크기·언어)' };
const mb = (bytes: number) => `${(bytes / 2 ** 20).toFixed(1)}MB`;

/** 제거: 이 브라우저에 둔 원본·세이브·설정을 골라 지운다(원본은 한 트랜잭션). 원본은 처음에 켜고 세이브·설정은 끈다 */
function Remove({ store, paths, keys, onDone, onBack }: { readonly store: FileStore; readonly paths: readonly string[]; readonly keys: readonly string[]; readonly onDone: () => void; readonly onBack: () => void }) {
  const [sizes, setSizes] = useState<Map<string, number> | null>(null);
  const [parts, setParts] = useState<ReadonlySet<Part>>(new Set(['game', 'korean', 'music']));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => cancel.current?.focus(), []); // 지우는 화면이라 처음 초점은 [취소]
  useEffect(() => {
    // Blob 크기는 내용을 읽지 않고 안다
    Promise.all(paths.map(async (p) => [p, (await store.get(p))?.size ?? 0] as const)).then((e) => setSizes(new Map(e)), () => {}); // 못 읽으면 크기만 '…'
  }, [store, paths]);
  const a = amounts(paths, sizes ?? new Map(), keys);
  const stored = storedOf(paths);
  const size = (p: Part) => (sizes ? mb(a[p].bytes) : '…');
  const detail: Record<Part, string> = { game: size('game'), korean: size('korean'), music: `${musicNote(stored.music, stored.sc88)}, ${size('music')}`, saves: '', settings: '' };
  const chosen = PARTS.filter((p) => parts.has(p) && a[p].n > 0);
  const remove = async () => {
    const r = removal(new Set(chosen), localKeys()); // 화면을 연 뒤 생긴 키(첫 화면 크기·자동 저장)도
    setBusy(true);
    setError(null);
    try {
      if (r.prefixes.length) await store.replace(r.prefixes, new Map());
      for (const k of r.keys) localStorage.removeItem(k);
    } catch (e) {
      setBusy(false);
      setError(`지우지 못했습니다(${e instanceof Error ? e.message : e}).`);
      return;
    }
    onDone();
  };
  const foot = (
    <>
      <button type="button" className="w98-push default" disabled={busy || !chosen.length} onClick={() => void remove()}>
        제거
      </button>
      <button ref={cancel} type="button" className="w98-push" disabled={busy} onClick={onBack}>
        취소
      </button>
    </>
  );
  return (
    <Window title="Vantage Master V2 제거" foot={foot}>
      <h2>제거</h2>
      <p>고른 것을 이 브라우저에서 지웁니다. 되돌릴 수 없습니다.</p>
      {PARTS.map((p) => {
        const has = a[p].n > 0;
        const on = has && parts.has(p);
        return (
          <label key={p} className={`w98-check setup-part${has ? '' : ' grayed'}`}>
            <input
              type="checkbox"
              checked={on}
              disabled={!has || busy}
              onChange={(e) => {
                const checked = e.target.checked;
                setParts((prev) => {
                  const next = new Set(prev);
                  if (checked) next.add(p);
                  else next.delete(p);
                  return next;
                });
              }}
            />
            <span className={`box${on ? ' on' : ''}`} />
            <span>
              {PART_LABEL[p]}
              {!has ? ' — 없음' : detail[p] ? ` — ${detail[p]}` : ''}
            </span>
          </label>
        );
      })}
      {busy && <div className="setup-dim">지우는 중…</div>}
      {error && <div className="setup-bad">{error}</div>}
    </Window>
  );
}

/**
 * 원본 파일 설치 마법사(스펙 2026-11-02 §3, Win98 설치 마법사 모양 5단계). 고른 파일은 collect*가 확인하고, 마침에 바뀐 묶음만 저장소에 한 번에 넣는다.
 * onDone 뒤 부르는 쪽이 페이지를 다시 읽는다. onCancel이 있으면(이미 원본이 있어 다시 연 경우) [취소]. problem은 저장된 원본을 읽지 못한 까닭(1단계에 보임)
 */
export function SetupWizard({ store, onDone, onCancel, problem }: { readonly store: FileStore; readonly onDone: () => void; readonly onCancel?: () => void; readonly problem?: string }) {
  const [step, setStep] = useState(1);
  const [stored, setStored] = useState<Stored>(storedOf([], problem !== undefined));
  const [picks, setPicks] = useState<Picks>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paths, setPaths] = useState<string[]>([]);
  const [keys] = useState(localKeys);
  const [removing, setRemoving] = useState(false);
  const next = useRef<HTMLButtonElement>(null);
  useEffect(() => next.current?.focus(), [removing, step === STEPS]); // 처음·제거에서 돌아올 때·[마침]으로 바뀔 때 기본 단추에
  useEffect(() => {
    store.paths().then((p) => {
      setPaths(p);
      setStored(storedOf(p, problem !== undefined));
    }, () => {});
  }, [store, problem]);

  const pick = async (kind: Kind, picked: Picked[] | Promise<Picked[]>) => {
    setBusy('파일을 확인하는 중…'); // 빈 폴더도 collect가 까닭을 낸다
    const r = await Promise.resolve(picked).then(COLLECT[kind]).catch((e: unknown): Collected => ({ ok: false, reason: `읽지 못했습니다(${e instanceof Error ? e.message : e})` }));
    setBusy(null);
    setPicks((p) => ({ ...p, [kind]: r, ...(kind === 'korean' ? { clearKorean: false } : kind === 'album' ? { clearMusic: false } : {}) }));
  };
  const finish = async () => {
    const { prefixes, files } = changes(picks, stored);
    setBusy('저장하는 중…');
    setError(null);
    try {
      if (prefixes.length) await store.replace(prefixes, files);
      await navigator.storage?.persist?.().catch(() => false); // 브라우저가 저장 공간을 비울 때 지우지 않게 청한다
    } catch (e) {
      setBusy(null);
      setError(`저장하지 못했습니다. 브라우저 저장 공간이 모자라거나 이 사이트의 저장을 막았을 수 있습니다. 공간이 모자라면 [뒤로] 가서 한국어판·CD 음악을 [빼기]로 빼고 다시 해 보세요(${e instanceof Error ? e.message : e}).`);
      return;
    }
    onDone();
  };

  const korean = picks.korean?.ok ? picks.korean : undefined;
  const music = koreanTracks(picks, stored); // 한국어판에서 CD 음악으로 넣을 곡 수
  const koreanButton = optionalButton(picks.korean !== undefined, stored.korean, picks.clearKorean === true);
  const albumButton = optionalButton(picks.album !== undefined, stored.music + stored.sc88 > 0, picks.clearMusic === true);
  const kept = musicNote(stored.music, stored.sc88); // 저장된 음악
  const page = [
    <>
      <h2>시작하기 전에</h2>
      <p>이 리메이크는 원작 게임 데이터를 포함하지 않습니다. 원작 파일을 한 번 넣으면 이 브라우저에 저장되어 다음부터 바로 시작합니다.</p>
      <div className="setup-notice">
        Vantage Master © 1998 Nihon Falcom.
        <br />
        비공식 팬 리메이크입니다.
      </div>
      {(paths.length > 0 || keys.length > 0) && (
        <div className="setup-row setup-remove">
          <span>이 브라우저에 저장된 것을 지우려면</span>
          <button type="button" className="w98-push" onClick={() => setRemoving(true)}>
            제거…
          </button>
        </div>
      )}
      {problem && <div className="setup-bad" style={{ marginTop: 8 }}>저장된 원본을 읽지 못했습니다({problem}). 게임 파일과, 쓰던 한국어판을 다시 넣으세요.</div>}
    </>,
    <>
      <h2>게임 파일 (필수)</h2>
      <p>
        팔콤 공식 무료 배포판{' '}
        <a href={VM_ONLINE} target="_blank" rel="noreferrer">
          VM Online
        </a>
        의 VMOnline.exe(21MB)를 받아 넣으세요. 설치된 영문판 게임 폴더가 있으면 그 폴더를 골라도 됩니다.
      </p>
      <Source file onPick={(p) => void pick('game', p)} />
      <Result r={picks.game} empty={stored.game ? '저장된 게임 파일을 그대로 씁니다' : '아직 넣지 않았습니다'} />
    </>,
    <>
      <h2>한국어판 (선택)</h2>
      <p>한국어판 게임 폴더가 있으면 고르세요. 공식 한국어 글과 더빙 음성으로 볼 수 있습니다. 없으면 새로 번역한 한국어로 나옵니다. 한국어판 폴더에 CD 음악(bgm·mp3)이 들어 있으면 함께 씁니다.</p>
      <Source onPick={(p) => void pick('korean', p)} />
      <Result r={picks.korean} empty={picks.clearKorean ? '비웁니다(새 번역으로)' : stored.korean ? '저장된 한국어판을 그대로 씁니다' : '건너뛰면 새로 번역한 한국어로'} />
      {koreanButton && (
        <div className="setup-row">
          <button type="button" className="w98-push" onClick={() => setPicks((p) => ({ ...p, korean: undefined, clearKorean: koreanButton === '비우기' || p.clearKorean }))}>
            {koreanButton}
          </button>
        </div>
      )}
    </>,
    <>
      <h2>CD 음악 (선택)</h2>
      <p>원작 CD 음악(CD Audio·SC-88) mp3가 든 앨범 폴더를 고르세요.</p>
      {music ? <p className="setup-ok">한국어판에서 {music}곡을 찾았습니다. 앨범을 고르면 앨범을 씁니다.</p> : null}
      <Source onPick={(p) => void pick('album', p)} />
      <Result r={picks.album} empty={music ? '' : picks.clearMusic ? '비웁니다(MIDI로)' : kept ? `저장된 ${kept}을 그대로 씁니다` : '건너뛰면 MIDI로 연주'} />
      {albumButton && (
        <div className="setup-row">
          <button type="button" className="w98-push" onClick={() => setPicks((p) => ({ ...p, album: undefined, clearMusic: albumButton === '비우기' || p.clearMusic }))}>
            {albumButton}
          </button>
        </div>
      )}
    </>,
    <>
      <h2>준비 완료</h2>
      <div className="setup-ok">✓ 게임: {picks.game?.ok ? picks.game.note : '저장된 것'}</div>
      <div className={korean || (stored.korean && !picks.clearKorean) ? 'setup-ok' : 'setup-dim'}>
        {korean ? `✓ ${music ? korean.note : '한국어판'}` : stored.korean && !picks.clearKorean ? '✓ 한국어판: 저장된 것' : '– 한국어판: 없음(새 번역)'}
      </div>
      <div className={picks.album?.ok || music || (kept && !picks.clearMusic) ? 'setup-ok' : 'setup-dim'}>
        {picks.album?.ok ? `✓ ${picks.album.note}` : music ? `✓ CD 음악: 한국어판 ${music}곡` : kept && !picks.clearMusic ? `✓ 저장된 ${kept}` : '– CD 음악: 없음(MIDI)'}
      </div>
      <p style={{ marginTop: 8 }}>나중에 화면 위 [원본 파일…]에서 바꿀 수 있습니다.</p>
      {error && <div className="setup-bad">{error}</div>}
    </>,
  ][step - 1];
  if (removing) return <Remove store={store} paths={paths} keys={keys} onDone={onDone} onBack={() => setRemoving(false)} />;
  const foot = (
    <>
      <button type="button" className="w98-push" disabled={step === 1 || busy !== null} onClick={() => setStep(step - 1)}>
        &lt; 뒤로
      </button>
      {step < STEPS ? (
        <button ref={next} type="button" className="w98-push default" disabled={busy !== null || !canNext(step, picks, stored)} onClick={() => setStep(step + 1)}>
          다음 &gt;
        </button>
      ) : (
        <button ref={next} type="button" className="w98-push default" disabled={busy !== null} onClick={() => void finish()}>
          마침
        </button>
      )}
      {onCancel && (
        <button type="button" className="w98-push" disabled={busy !== null} onClick={onCancel}>
          취소
        </button>
      )}
    </>
  );
  return (
    <Window title={`Vantage Master V2 설정 — ${step}/${STEPS}`} foot={foot}>
      {page}
      {busy && <div className="setup-dim">{busy}</div>}
    </Window>
  );
}
