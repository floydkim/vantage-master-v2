import { existsSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { koreanExe, openExeImage } from '../../src/formats/exeImage.ts';
import { datFileName, openVmDat, type VmDat } from '../../src/formats/vmFiles.ts';
import ko from '../../src/i18n/koStrings.json';
import { allSources, type Edition, pairedText, sceneLines, textAt } from '../../src/i18n/sources.ts';
import { koreanRead } from '../../src/ui/battle/original.ts';
import { mergeKo } from '../../tools/i18n/merge-ko.ts';
import { exe, read } from '../ui/screenCases.ts';

const KO = new URL('../../original/KO/', import.meta.url);
const koExe = existsSync(new URL('Vmv2.exe', KO)) ? openExeImage(new Uint8Array(readFileSync(new URL('Vmv2.exe', KO)))) : null;
const koDat = (n: number): VmDat => openVmDat(n, new Uint8Array(readFileSync(new URL(datFileName(n), KO))));
const en: Edition = { exe, read };

it('sceneLines: 명령표(re/scene.md)대로 처음부터 훑으면 DATA08·09 33편 모두 스크립트 끝에서 딱 끝나고, 장면 줄 수는 8·8·7·9·10·10', () => {
  expect(Array.from({ length: 6 }, (_, i) => sceneLines(read((8 << 16) | i)).length)).toEqual([8, 8, 7, 9, 10, 10]);
  for (let i = 0; i < 27; i++) expect(() => sceneLines(read((9 << 16) | i))).not.toThrow();
  expect(() => sceneLines(Uint8Array.of(0xff, 0, 0, 0))).toThrow(RangeError); // 모르는 명령
  expect(() => sceneLines(Uint8Array.of(0x22, 0, 0, 0))).toThrow(RangeError); // 인자가 끝을 넘음
});

it('allSources: 종류마다 글이 있고 where는 겹치지 않으며 textAt이 같은 글을 돌려준다', () => {
  const all = allSources(en);
  expect(new Set(all.map((s) => s.kind))).toEqual(new Set(['exe', 'dialog', 'menu', 'map', 'mas', 'scene', 'ending']));
  expect(new Set(all.map((s) => s.where)).size).toBe(all.length);
  expect(all.filter((s) => textAt(s.where, en) !== s.text).map((s) => s.where)).toEqual([]);
  expect(all.filter((s) => s.kind === 'scene').length).toBe(52);
  expect(new Set(all.filter((s) => s.kind === 'dialog').map((s) => s.where.split(':')[1])).size).toBeGreaterThanOrEqual(25);
  expect(all.filter((s) => s.text === 'Spin1' || s.where.startsWith('dialog:0x71:'))).toEqual([]); // 숫자 조절 단추의 창 이름, 디버그 창은 화면에 나오지 않음
});

it.skipIf(!koExe)('pairedText: 줄 수가 같은 편은 정발판 줄, 다른 편(엔딩 5)은 null, 대응이 없는 exe 글은 null', () => {
  const pairs = new Map(Object.entries(ko).map(([e, k]) => [Number(e), Number(k)]));
  const dats = new Map([8, 9, 10].map((n) => [n, koDat(n)]));
  const kr: Edition = { exe: koreanExe(exe, koExe!, pairs), read: koreanRead(read, (id) => dats.get(id >>> 16)!.read(id & 0xffff)) };
  expect(pairedText('ending:5:0', en, kr)).toBeNull();
  expect(pairedText('scene:3:0', en, kr)).toBe(sceneLines(dats.get(8)!.read(3))[0]);
  expect(pairedText('ending:7:0', en, kr)).toBe(sceneLines(dats.get(9)!.read(7))[0]);
  const exeWhere = `exe:0x${Number(Object.keys(ko)[0]).toString(16)}`;
  expect(pairedText(exeWhere, en, kr)).not.toBe(textAt(exeWhere, en));
  expect(pairedText('exe:0x45f0fc', en, { exe, read })).toBeNull(); // 영문판끼리면 같은 글 → 짝 없음
});

it('mergeKo: where로 키를 찾아 넣고 \\n·\\\\를 풀며, 없는 where·같은 키 다른 번역은 오류', () => {
  const sources = [
    { where: 'exe:0x1', key: 'k1' },
    { where: 'exe:0x2', key: 'k1' },
    { where: 'map:0:0', key: 'k2' },
  ];
  const r = mergeKo({ k0: '영' }, sources, 'exe:0x1\t가\\n나\n\nmap:0:0\t역\\\\\n');
  expect(r).toEqual({ table: { k0: '영', k1: '가\n나', k2: '역\\' }, added: 2, errors: [] });
  expect(Object.keys(mergeKo({ k9: 'a' }, sources, 'map:0:0\tb').table)).toEqual(['k2', 'k9']);
  expect(mergeKo({}, sources, 'exe:0x9\t가').errors).toHaveLength(1);
  expect(mergeKo({}, sources, 'exe:0x1\t가\nexe:0x2\t나').errors).toHaveLength(1);
  expect(mergeKo({ k1: '다' }, sources, 'exe:0x1\t가').errors).toHaveLength(1);
  expect(mergeKo({ k1: '가' }, sources, 'exe:0x1\t가')).toEqual({ table: { k1: '가' }, added: 0, errors: [] });
  expect(mergeKo({}, sources, '=map:0:0\t자리')).toEqual({ table: { 'map:0:0': '자리' }, added: 1, errors: [] }); // = 뒤는 자리 키
  expect(mergeKo({}, sources, '=exe:0x9\t자리').errors).toHaveLength(1);
  // 검수 반영: replace면 표에 있는 번역을 바꾼다. 같은 TSV 안에서 같은 키에 다른 번역을 주면 그래도 오류
  expect(mergeKo({ k1: '다', k2: '역' }, sources, 'exe:0x1\t가', { replace: true })).toEqual({ table: { k1: '가', k2: '역' }, added: 1, errors: [] });
  expect(mergeKo({ k1: '다' }, sources, 'exe:0x1\t가\nexe:0x2\t나', { replace: true }).errors).toHaveLength(1);
  expect(mergeKo({ k1: '가' }, sources, 'exe:0x1\t가', { replace: true }).added).toBe(0);
});
