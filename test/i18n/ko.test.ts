import { existsSync, readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { readDialog } from '../../src/formats/dialogs.ts';
import { koreanExe, openExeImage } from '../../src/formats/exeImage.ts';
import { readMenu } from '../../src/formats/menus.ts';
import { datFileName, openVmDat, type VmDat } from '../../src/formats/vmFiles.ts';
import { cp949, htmlText, koreanLayout, setHangul } from '../../src/i18n/hangul.ts';
import { byteKey, ko, type KoTable, translator, uiKey } from '../../src/i18n/ko.ts';
import table from '../../src/i18n/ko.json';
import { sha16 } from '../../src/i18n/koFixes.ts';
import koStrings from '../../src/i18n/koStrings.json';
import { allSources, type Edition, type Source, type SourceKind, sourceKey } from '../../src/i18n/sources.ts';
import { elapsedColumns } from '../../src/ui/battle/resultWindow.ts';
import { koreanRead, type Original, textRead, translated } from '../../src/ui/battle/original.ts';
import { exe, read } from '../ui/screenCases.ts';

// 한국어판 원본(pnpm import-korean)이 있을 때만 도는 시험은 한국어판 글을 해시·비교로만 본다
const KO = new URL('../../original/KO/', import.meta.url);
const koExe = existsSync(new URL('Vmv2.exe', KO)) ? openExeImage(new Uint8Array(readFileSync(new URL('Vmv2.exe', KO)))) : null;
const koDat = (n: number): VmDat => openVmDat(n, new Uint8Array(readFileSync(new URL(datFileName(n), KO))));
const field = (b: Uint8Array, at: number) => {
  const end = b.indexOf(0, at);
  return String.fromCharCode(...b.subarray(at, end < 0 ? b.length : end));
};
afterEach(() => setHangul(null));

it('translator: 바이트 글은 표의 값을 CP949로, 리소스 글은 값 그대로, 표에 없으면 원문', () => {
  const t = translator({ [byteKey('Bird')]: '바드', [uiKey('&Game')]: '게임(&G)' });
  expect([t.text('Bird'), t.ui('&Game'), t.text('Zero'), t.ui('Zero')]).toEqual([cp949('바드'), '게임(&G)', 'Zero', 'Zero']);
  expect(uiKey('A')).toBe(sha16(Uint8Array.of(0x41, 0)));
});

it('translator: 리소스 글은 자리 키(where)가 표에 있으면 그것이 이긴다(같은 원문을 자리마다 다르게)', () => {
  const t = translator({ [uiKey('Magic')]: '마법', 'dialog:0x6f:21': '마방' });
  expect([t.ui('Magic', 'dialog:0x6f:21'), t.ui('Magic', 'dialog:0x6f:38'), t.ui('Magic')]).toEqual(['마방', '마법', '마법']);
  const d = readDialog({ ...exe, uiText: t.ui }, 0x6f);
  expect([d.controls[21].text, d.controls[38].text]).toEqual(['마방', '마법']);
});

it('readDialog·readMenu는 exe.uiText로 제목·컨트롤·메뉴 글을 바꾸고 배치는 그대로', () => {
  const d = readDialog(exe, 0x7d);
  const t = readDialog({ ...exe, uiText: (s) => `[${s}]` }, 0x7d);
  expect(t.controls.map((c) => [c.x, c.y, c.w, c.h])).toEqual(d.controls.map((c) => [c.x, c.y, c.w, c.h]));
  expect([t.title, t.controls.find((c) => c.text)!.text]).toEqual([`[${d.title}]`, `[${d.controls.find((c) => c.text)!.text}]`]);
  expect(readMenu({ ...exe, uiText: () => 'x' }, 0x66)[0].text).toBe('x');
});

it('textRead: 맵 설명(+0x1a0) 칸 끝은 마정석 표 앞 0x2c8, 넘치는 번역은 쓰지 않는다', () => {
  const at = (i: number, o: number) => field(read((10 << 16) | i), o);
  const long = (s: string) => (s === at(0, 0x1a0) ? 'x'.repeat(0x2c8 - 0x1a0 - 1) : s === at(0, 0) ? 'x'.repeat(0x18) : s);
  const r = textRead(read, long);
  expect([field(r((10 << 16) | 0), 0x1a0).length, field(r((10 << 16) | 0), 0), r((10 << 16) | 0).subarray(0x2c8)]).toEqual([0x2c8 - 0x1a0 - 1, at(0, 0), read((10 << 16) | 0).subarray(0x2c8)]);
});

it('translated: exe 글·DATA10·장면 fix에 번역, korean은 false', () => {
  const label = exe.cString(0x45f0fc);
  const name = field(read((10 << 16) | 0), 0);
  const t = translator({ [byteKey(label)]: '가', [byteKey(name)]: '나', [byteKey('%M')]: '다', [uiKey(readDialog(exe, 0x7d).title)]: '라' });
  const o = translated({ exe, read, korean: false, fix: (s: string) => s } as unknown as Original, t);
  expect([o.exe.cString(0x45f0fc), field(o.read((10 << 16) | 0), 0), o.fix('%M'), readDialog(o.exe, 0x7d).title, o.korean]).toEqual([cp949('가'), cp949('나'), cp949('다'), '라', false]);
});

it('setHangul(g, false): 한글 글리프와 HTML 풀기는 켜고 한국어판 자리는 영문판', () => {
  setHangul(() => new Uint8Array(32), false);
  expect([koreanLayout(), elapsedColumns(), htmlText(cp949('가'))]).toEqual([false, [143, 215, 242], '가']);
  setHangul(() => new Uint8Array(32));
  expect([koreanLayout(), elapsedColumns()]).toEqual([true, [128, 160, 184]]);
});

// ── 지킴 시험(설계 §5·§7): 번역 Task마다 TRANSLATED에 그 종류를 더한다 ──
const TRANSLATED: readonly SourceKind[] = ['exe', 'dialog', 'menu', 'map', 'mas', 'scene', 'ending'];
const all = allSources({ exe, read });
const byKey = new Map<string, Source[]>();
for (const s of all) byKey.set(sourceKey(s), [...(byKey.get(sourceKey(s)) ?? []), s]);
const entries = Object.entries(table as KoTable);
// 표의 키는 원문 해시이거나 자리 키(where, 같은 원문을 자리마다 다르게 옮긴 것)
const srcOf = (key: string) => byKey.get(key)?.[0] ?? all.find((s) => s.where === key);
const cp949Decoder = new TextDecoder('euc-kr');
const decode = (s: string) => cp949Decoder.decode(Uint8Array.from(s, (c) => c.charCodeAt(0)));
const FORMAT = /%(?:[-+ 0#]*\d*(?:\.\d+)?[a-zA-Z]|%)/g;

it('완전성: TRANSLATED 종류의 글은 모두 번역이 있다', () => {
  expect(all.filter((s) => TRANSLATED.includes(s.kind) && !(sourceKey(s) in table)).map((s) => s.where)).toEqual([]);
});

it('표의 모든 키가 지금 원문 글 하나 이상과 맞는다(낡은 키 없음)', () => {
  expect(entries.filter(([k]) => !srcOf(k)).map(([k]) => k)).toEqual([]);
});

it('바이트 자리 번역은 CP949로 되돌아온다(못 쓰는 글자 없음)', () => {
  expect(entries.filter(([k, v]) => !srcOf(k)?.wide && decode(cp949(v)) !== v).map(([k, v]) => `${k} ${v}`)).toEqual([]);
});

// %M 바로 뒤에 한글이 오면 받침과 상관없는 것(에·의·도·만·께·한테·처럼·보다·부터·까지·조차·마저·뿐·님·씨)만 허용한다
const BATCHIM_BOUND = /%M(?=[가-힣])(?!에|의|도|만|께|한테|처럼|보다|부터|까지|조차|마저|뿐|님|씨)/;

it('%M 뒤에 받침에 따라 바뀌는 조사·서술격 조사가 붙지 않는다(은·는·이·가·을·를·으로·로·라는·였다·면 등)', () => {
  expect(entries.map(([, v]) => v).filter((v) => BATCHIM_BOUND.test(v))).toEqual([]);
  expect(['%M이로구나', '%M로서', '%M다.', '%M라는', '%M였다', '%M면', '%M 씨', '%M의', '%M님', '%M.', '%M에게는', '%M》'].map((v) => BATCHIM_BOUND.test(v))).toEqual([true, true, true, true, true, true, false, false, false, false, false, false]);
});

it('서식(%M·%%·%d 등)이 원문과 같다', () => {
  // printf 인자(%s·%d 등)는 차례까지 같아야 하고, 엔진이 푸는 %M·%%는 자리가 옮겨도 되므로 수만 같으면 된다
  const tokens = (s: string) => {
    const all = s.match(FORMAT) ?? [];
    const free = all.filter((t) => t === '%M' || t === '%%');
    return `${all.filter((t) => !free.includes(t)).join(' ')} | ${free.sort().join(' ')}`;
  };
  expect(tokens('%s 쪽 %d') === tokens('%d 쪽 %s')).toBe(false); // printf 인자 차례가 바뀌면 실행 때 글이 망가진다
  expect(entries.filter(([k, v]) => tokens(srcOf(k)!.text) !== tokens(v)).map(([k, v]) => `${srcOf(k)!.where} ${v}`)).toEqual([]);
});

it('줄바꿈 꼴이 원문과 같다(줄 수는 달라도 됨): 원문이 한 줄이면 한 줄, \\r\\n이면 \\r\\n만, \\n이면 \\r 없음, 끝 줄바꿈 여부도 같음', () => {
  const wrong = entries.filter(([k, v]) => {
    const s = srcOf(k)!.text;
    if (!/[\r\n]/.test(s)) return /[\r\n]/.test(v);
    const crlf = s.includes('\r');
    return (crlf ? /(?<!\r)\n|\r(?!\n)/.test(v) : v.includes('\r')) || /\n$/.test(s) !== /\n$/.test(v);
  });
  expect(wrong.map(([k]) => srcOf(k)!.where)).toEqual([]);
});

it('검수에서 고른 낱말로 통일했다(유닛·비행 유닛·비행 네이티얼·시전자·반각 &, 메일은 현상금 사냥꾼)', () => {
  const OLD = /유니트|나는 유닛|날아다니는 네이티얼|거는 이|＆|\(IQ |메일이라는 현상 수배범/;
  expect(entries.filter(([, v]) => OLD.test(v)).map(([k]) => srcOf(k)!.where)).toEqual([]);
  expect(entries.filter(([, v]) => /유닛(는|가|를|와|로|나)/.test(v)).map(([k]) => srcOf(k)!.where)).toEqual([]); // 받침에 맞는 조사
});

it('메뉴·대화 상자의 단축 글자 &(&&가 아닌 것) 수가 원문과 같다', () => {
  const amps = (s: string) => s.replaceAll('&&', '').split('&').length - 1;
  expect(entries.filter(([k, v]) => srcOf(k)!.wide && amps(srcOf(k)!.text) !== amps(v)).map(([k]) => srcOf(k)!.where)).toEqual([]);
});

it('장면·엔딩 줄은 max(60, 원문 바이트) 이하', () => {
  const lines = all.filter((s) => (s.kind === 'scene' || s.kind === 'ending') && sourceKey(s) in table);
  expect(lines.filter((s) => cp949(table[sourceKey(s) as keyof typeof table]).length > Math.max(60, s.text.length)).map((s) => s.where)).toEqual([]);
});

it('DATA10 번역 칸은 칸 안에 들어간다(textRead 결과에 번역이 실제로 쓰였다)', () => {
  const r = textRead(read, ko.text);
  const fields = all.filter((s) => (s.kind === 'map' || s.kind === 'mas') && sourceKey(s) in table);
  expect(fields.filter((s) => field(r((10 << 16) | Number(s.where.split(':')[1])), Number(s.where.split(':')[2])) !== ko.text(s.text)).map((s) => s.where)).toEqual([]);
});

// 누가 옮겨도 같아질 평범한 문장과 명칭은 막지 않는다(사용자 결정 2026-11-09: 같다는 이유로 어색하게 바꾸지 않는다). 이보다 긴 글이 똑같으면 옮겨 적은 것으로 본다
const COPIED_BYTES = 41;

describe.skipIf(!koExe)('정발판 글을 옮겨 적지 않았다', () => {
  it(`글 전체나 어느 한 줄이 ${COPIED_BYTES}바이트 이상 정발판 글·줄과 똑같지 않다(원문 그대로인 글은 뺌)`, () => {
    const pairs = new Map(Object.entries(koStrings).map(([e, k]) => [Number(e), Number(k)]));
    const dats = new Map([8, 9, 10].map((n) => [n, koDat(n)]));
    const kr: Edition = { exe: koreanExe(exe, koExe!, pairs), read: koreanRead(read, (id) => dats.get(id >>> 16)!.read(id & 0xffff)) };
    const texts = allSources(kr).map((s) => (s.wide ? s.text : decode(s.text)));
    const official = new Set(texts.flatMap((text) => [text, ...text.split('\n').map((l) => l.trim())]));
    const copied = entries.flatMap(([k, v]) => {
      if (v === srcOf(k)!.text) return []; // 서식 글 등, 정발판도 원문 그대로
      return [v, ...v.split('\n').map((l) => l.trim())].filter((l) => cp949(l).length >= COPIED_BYTES && official.has(l)).map((l) => `${srcOf(k)!.where} ${l}`);
    });
    expect(copied).toEqual([]);
  });
});

it('모든 종류를 번역했다(loadOriginal이 우리 번역 모드를 켜는 조건)', () => {
  expect([...TRANSLATED].sort()).toEqual(['dialog', 'ending', 'exe', 'map', 'mas', 'menu', 'scene']);
});
