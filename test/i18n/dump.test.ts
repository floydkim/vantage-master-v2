// 번역 작업용 내려받기(pnpm i18n-dump): VM_I18N_DUMP가 있을 때만 original/i18n-work/sources.json(git 밖)에 번역할 글을 쓴다.
// 항목: where, kind, key, src(사람이 읽는 원문: 장면은 Shift-JIS를 풂), ko(정발판 같은 자리, 한국어판이 없거나 짝이 없으면 null), done(번역 표에 있음), bytes
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { koreanExe, openExeImage } from '../../src/formats/exeImage.ts';
import { datFileName, openVmDat } from '../../src/formats/vmFiles.ts';
import table from '../../src/i18n/ko.json';
import koStrings from '../../src/i18n/koStrings.json';
import { allSources, type Edition, pairedText, sourceKey } from '../../src/i18n/sources.ts';
import { koreanRead } from '../../src/ui/battle/original.ts';
import { exe, read } from '../ui/screenCases.ts';

it.skipIf(!process.env.VM_I18N_DUMP)('번역할 글을 original/i18n-work/sources.json에 쓴다', () => {
  const KO = new URL('../../original/KO/', import.meta.url);
  const en: Edition = { exe, read };
  let kr: Edition | null = null;
  if (existsSync(new URL('Vmv2.exe', KO))) {
    const dats = new Map([8, 9, 10].map((n) => [n, openVmDat(n, new Uint8Array(readFileSync(new URL(datFileName(n), KO))))]));
    const pairs = new Map(Object.entries(koStrings).map(([e, k]) => [Number(e), Number(k)]));
    kr = { exe: koreanExe(exe, openExeImage(new Uint8Array(readFileSync(new URL('Vmv2.exe', KO)))), pairs), read: koreanRead(read, (id) => dats.get(id >>> 16)!.read(id & 0xffff)) };
  }
  const bytes = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
  const sjis = new TextDecoder('shift_jis');
  const cp949 = new TextDecoder('euc-kr');
  const out = allSources(en).map((s) => {
    const k = kr && pairedText(s.where, en, kr);
    const key = sourceKey(s);
    return {
      where: s.where,
      kind: s.kind,
      key,
      src: s.kind === 'scene' ? sjis.decode(bytes(s.text)) : s.text,
      ko: k === null ? null : s.wide ? k : cp949.decode(bytes(k)),
      done: key in table,
      bytes: s.text.length,
    };
  });
  const dir = new URL('../../original/i18n-work/', import.meta.url);
  mkdirSync(dir, { recursive: true });
  writeFileSync(new URL('sources.json', dir), `${JSON.stringify(out, null, 1)}\n`);
});
