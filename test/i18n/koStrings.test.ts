import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { type ExeImage, openExeImage } from '../../src/formats/exeImage.ts';
import ko from '../../src/i18n/koStrings.json';
import { exe } from '../ui/screenCases.ts';

// 영문판 문자열 주소 → 한국어판 주소(tools/i18n/map_strings.py). 한국어판 exe가 있으면(pnpm import-korean) 글도 견준다
const pairs = new Map(Object.entries(ko).map(([e, k]) => [Number(e), Number(k)]));
const KO_EXE = new URL('../../original/KO/Vmv2.exe', import.meta.url);
const koExe = existsSync(KO_EXE) ? openExeImage(new Uint8Array(readFileSync(KO_EXE))) : null;
// src의 상수 중 글처럼 보이지만 수치 표인 것
const NOT_TEXT = new Set([0x45e244, 0x45e298, 0x45f2ac, 0x45f2e0, 0x45f304, 0x45f8d0, 0x473388]);

const bytes = (x: ExeImage, va: number) => {
  let n = 0;
  while (x.read(va + n, 1)[0] !== 0) n++;
  return x.read(va, n);
};
const koText = (va: number) => new TextDecoder('euc-kr').decode(bytes(koExe!, pairs.get(va)!));
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 16); // 한국어판 글은 저장소에 두지 않고 해시로 비교
const u32 = (x: ExeImage, va: number) => new DataView(x.read(va, 4).buffer).getUint32(0, true);
const isText = (va: number) => {
  try {
    if (exe.read(va - 1, 1)[0] !== 0) return false;
    const b = bytes(exe, va);
    const v = u32(exe, va);
    return b.length >= 2 && !(v >= 0x450000 && v < 0x4e0000) && b.every((c) => (c >= 0x20 && c < 0x7f) || c === 0x0a || c === 0xa1);
  } catch {
    return false;
  }
};
// 한국어판에서 이름과 설명 첫머리의 표기가 다른 칸(VARIANTS)
const VARIANTS = new Set(['네이티얼 4', '마스터 18', '마스터 20', '마스터 26', '지형 7', '지형 8', '지형 9']);
const specs = (s: string) => s.match(/%[-+ #0]*(\*|\d+)?(\.\d+)?[a-zA-Z%]/g) ?? [];

describe('한국어판 문자열 주소 대응', () => {
  it('리메이크가 읽는 영문 문자열 주소(src의 0x45xxxx~0x47xxxx 상수 중 글)마다 한국어판 주소가 있다', () => {
    const used = new Set<number>();
    for (const f of readdirSync('src', { recursive: true }) as string[]) {
      if (!/\.tsx?$/.test(f) || f.startsWith('i18n')) continue;
      for (const m of readFileSync(`src/${f}`, 'utf8').matchAll(/0x4[5-7][0-9a-f]{4}\b/gi)) used.add(Number(m[0]));
    }
    const missing = [...used].filter((va) => !NOT_TEXT.has(va) && isText(va) && !pairs.has(va)).map((va) => `0x${va.toString(16)} ${exe.cString(va)}`);
    expect(missing).toEqual([]);
  });

  it.skipIf(!koExe)('서식(%s·%d·%*d…) 자리가 같다', () => {
    const wrong = [...pairs.keys()].filter((va) => specs(exe.cString(va)).join() !== specs(koText(va)).join()).map((va) => `0x${va.toString(16)} ${exe.cString(va)} | ${koText(va)}`);
    expect(wrong).toEqual([]);
  });

  it.skipIf(!koExe)('몇 개 맞춤: Master making, Scenario Mode (Easy), 이김 문구, 설명은 《이름》으로 시작(네이티얼 1~24, 마스터 27, 지형 17)', () => {
    expect([sha(koText(0x468b40)), koText(0x475d28), sha(koText(0x45e458))]).toEqual(['b878a01c3d7b0ecc', ' Scenario Mode (Easy)', 'd69e15938b040a7a']);
    const starts = (desc: number, name: number) => koText(desc).startsWith(`《${koText(name).trim()}》`);
    const wrong = [
      ...Array.from({ length: 24 }, (_, i) => i + 1).filter((k) => !starts(u32(exe, 0x46226c + k * 4), u32(exe, 0x4749d8 + k * 0x58 + 0x50))).map((k) => `네이티얼 ${k}`),
      ...Array.from({ length: 27 }, (_, k) => k).filter((k) => !starts(u32(exe, 0x4622d0 + k * 4), u32(exe, 0x469014 + k * 4))).map((k) => `마스터 ${k}`),
      ...Array.from({ length: 17 }, (_, k) => k).filter((k) => !starts(u32(exe, 0x46222c + k * 4), u32(exe, 0x45f210 + k * 4))).map((k) => `지형 ${k}`),
    ];
    expect(wrong.filter((w) => !VARIANTS.has(w))).toEqual([]);
  });
});
