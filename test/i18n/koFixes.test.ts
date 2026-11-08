import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { koreanExe, openExeImage } from '../../src/formats/exeImage.ts';
import { datFileName, openVmDat, type VmDat } from '../../src/formats/vmFiles.ts';
import { cp949 } from '../../src/i18n/hangul.ts';
import { fixLine, sha16 } from '../../src/i18n/koFixes.ts';
import table from '../../src/i18n/koFixes.json';
import ko from '../../src/i18n/koStrings.json';
import { fixedExe, fixedRead, koreanRead } from '../../src/ui/battle/original.ts';
import { sceneText } from '../../src/ui/scene/engine.ts';
import { exe, read } from '../ui/screenCases.ts';

// 한국어판 원본(pnpm import-korean)이 있을 때만 도는 시험은 한국어판 글을 해시·조각으로만 본다
const KO = new URL('../../original/KO/', import.meta.url);
const koExe = existsSync(new URL('Vmv2.exe', KO)) ? openExeImage(new Uint8Array(readFileSync(new URL('Vmv2.exe', KO)))) : null;
const koDat = (n: number): VmDat => openVmDat(n, new Uint8Array(readFileSync(new URL(datFileName(n), KO))));
const text = (b: Uint8Array) => String.fromCharCode(...b);
const field = (b: Uint8Array, at: number) => {
  const end = b.indexOf(0, at);
  return text(b.subarray(at, end < 0 ? b.length : end));
};
/** DATA10 글 칸: 맵(0~51) +0·+0x78·+0x1a0, 적 마스터 MAS(52~89) +0·+0x1c */
const dat10Fields = (entry: (i: number) => Uint8Array) => Array.from({ length: 90 }, (_, i) => (i < 52 ? [0, 0x78, 0x1a0] : [0, 0x1c]).map((at) => field(entry(i), at))).flat();
const count = (s: string, part: string) => s.split(part).length - 1;

it('sha16은 SHA-256 16진 앞 16자(node:crypto와 같음)', () => {
  for (const b of [new Uint8Array(0), new TextEncoder().encode('abc'), new Uint8Array(randomBytes(1000))]) {
    expect(sha16(b)).toBe(createHash('sha256').update(b).digest('hex').slice(0, 16));
  }
});

it('표에 없는 글과 영문판 글(exe 대응 글, DATA10 글 칸)은 fixLine이 바꾸지 않는다', () => {
  expect(fixLine('Plain')).toBe('Plain');
  const en = [...Object.keys(ko).map((va) => exe.cString(Number(va))), ...dat10Fields((i) => read((10 << 16) | i))];
  expect(en.filter((s) => fixLine(s) !== s)).toEqual([]);
});

describe.skipIf(!koExe)('한국어판 보정 표(설계 §6, 닫힌 목록)', () => {
  const d8 = koExe && koDat(8);
  const d9 = koExe && koDat(9);
  const d10 = koExe && koDat(10);
  const exeLines = koExe ? [...new Set(Object.values(ko).map((va) => koExe.cString(Number(va))))] : [];
  const scenes = koExe ? [...Array.from({ length: 6 }, (_, i) => d8!.read(i)), ...Array.from({ length: 27 }, (_, i) => d9!.read(i))] : [];
  // 장면·엔딩 글 명령 0x29: 명령 4바이트 뒤부터 0까지. 0x29인 바이트마다 후보로 둔다(엔진이 그리는 줄을 모두 포함)
  const sceneLines = scenes.flatMap((b) => [...b.keys()].filter((p) => b[p] === 0x29).map((p) => field(b, p + 4)));
  const lines = [...exeLines, ...(koExe ? dat10Fields((i) => d10!.read(i)) : []), ...sceneLines];
  const shas = new Set(table.map((f) => f.sha));
  const fixed = lines.filter((s) => shas.has(sha16(Uint8Array.from(s, (c) => c.charCodeAt(0)))));

  it('모든 항목의 해시가 한국어판 글 하나 이상과 맞고, 조각 항목은 그 글에 조각이 있다', () => {
    const missing = table.filter((f) => {
      const hit = lines.filter((s) => sha16(Uint8Array.from(s, (c) => c.charCodeAt(0))) === f.sha);
      return hit.length === 0 || ('from' in f && !hit.every((s) => s.includes(cp949(f.from!))));
    });
    expect(missing).toEqual([]);
  });

  it('나쁜 조각은 한국어판 자료 전체에서 해시가 맞은 글 안에만 있고, 고친 뒤에는 남지 않는다', () => {
    const BAD = ['버드', '상금수', '상금모으기', '상금 모으기', '진수로', '《진수》', '신기한 짐승', '레인지그랜드', '기아·블로', '온비불', '레그나', '콘쥬레이트', '기드칸', '수정석', '스피릿트', '바메이드', '마법사용자', '커다란 소용돌이', '사명은 뭘까요', '기대되는군요', '간략에', '지금 이 남자는', '자신만이', '칭찬할까', '아저씨게는', '보답한 것이지', '심한가요', '밥통', '능숙한가', '당신 것을', '엉덩이에 털', '깃들면 좋다고', '의식의 간격', '길을 알아내는', '그리나', '고동', '연망치', '피프넬를', '지레이트', '당신의 손에', '불리워', '받아 드리', '갑자스럽게', '고마왔', '죄값', '꺽지', 'ⅴ', 'ı', '소환한고', '들린 덕분', '왠일', '꺼야', '학인', '놀랬다', '쌓인 요새', '라세cm', '니다.0', '할 말한', '고우 니케'];
    const raw = [...exeLines, ...[...scenes, ...Array.from({ length: 90 }, (_, i) => d10!.read(i))].map(text)];
    const wrong = BAD.flatMap((w) => {
      const b = cp949(w);
      const all = raw.reduce((n, s) => n + count(s, b), 0);
      const inFixed = fixed.reduce((n, s) => n + count(s, b), 0);
      const left = fixed.filter((s) => fixLine(s).includes(b)).length;
      return all === inFixed && all > 0 && left === 0 ? [] : [`${w}: 자료 ${all}, 고칠 글 ${inFixed}, 남음 ${left}`];
    });
    expect(wrong).toEqual([]);
  });

  it('해시가 맞은 모든 줄: fixLine은 글자 단위로 바꾼다(2바이트 글자 경계를 넘지 않음) — 풀어서 from → to를 바꾼 것과 같다', () => {
    const decode = (t: string) => new TextDecoder('euc-kr').decode(Uint8Array.from(t, (c) => c.charCodeAt(0)));
    const wrong = fixed.filter((s) => {
      const want = table.filter((f) => f.sha === sha16(Uint8Array.from(s, (c) => c.charCodeAt(0)))).reduce((t, f) => ('from' in f ? t.replaceAll(f.from!, f.to) : f.to), decode(s));
      return decode(fixLine(s)) !== want;
    });
    expect(wrong.map((s) => sha16(Uint8Array.from(s, (c) => c.charCodeAt(0))))).toEqual([]);
  });

  it('표본: 마스터 종류 9 → 바드, 장 사이 장면 3 → 재앙, MM 결과 19 → 현상 수배범으로', () => {
    const master9 = koExe!.cString(Number(ko[`0x${exe.read(0x469014 + 9 * 4, 4).reduce((v, b, i) => v + b * 256 ** i, 0).toString(16)}` as keyof typeof ko]));
    expect(fixLine(master9)).toBe(cp949('바드'));
    const scene3 = sceneLines.find((s) => s.includes(cp949('소용돌이')))!;
    expect(fixLine(scene3)).toBe(cp949('머지않아 커다란 재앙을 불러오게 됩니다.'));
    expect(exeLines.filter((s) => s.includes(cp949('상금수로'))).map(fixLine).every((s) => s.includes(cp949('현상 수배범으로')))).toBe(true);
    // 메일은 현상금 사냥꾼이다(공식 사이트 クラス：賞金稼ぎ). 현상 수배범은 아레스
    expect(fixLine(sceneLines.find((s) => s.includes(cp949('메일이라는')))!)).toBe(cp949('메일이라는 현상금 사냥꾼이 말이야,'));
  });

  it('고친 장면·엔딩 줄은 60바이트(정발판 가장 긴 줄) 이하', () => {
    expect(fixed.filter((s) => sceneLines.includes(s) && fixLine(s).length > 60)).toEqual([]);
  });
});

describe.skipIf(!koExe)('보정 적용(exe 글·DATA10 글 칸·장면 글)', () => {
  const pairs = new Map(Object.entries(ko).map(([e, k]) => [Number(e), Number(k)]));
  const dats = koExe ? new Map([8, 9, 10].map((n) => [n, koDat(n)])) : new Map<number, VmDat>();
  const r = koreanRead(read, (id) => dats.get(id >>> 16)!.read(id & 0xffff));
  const u32 = (va: number) => new DataView(exe.read(va, 4).buffer).getUint32(0, true);
  const name = (b: Uint8Array) => field(b, 0);

  it('fixedExe: 마스터 종류 9 → 바드, 표에 없는 글은 그대로', () => {
    const k = koreanExe(exe, koExe!, pairs);
    const f = fixedExe(k);
    expect(f.cString(u32(0x469014 + 9 * 4))).toBe(cp949('바드'));
    expect(f.cString(u32(0x469014))).toBe(k.cString(u32(0x469014)));
  });

  it('fixedRead: 적 마스터 84 이름 → 라세츠, 맵 29 +0x78에 기드·칸, 표의 DATA10 글은 모두 칸 안에 들어가 바뀌고 나머지 항목은 바이트 그대로', () => {
    const f = fixedRead(r);
    expect(name(f((10 << 16) | 84))).toBe(cp949('라세츠'));
    expect(field(f((10 << 16) | 29), 0x78)).toContain(cp949('기드·칸'));
    const changed = Array.from({ length: 90 }, (_, i) => i).filter((i) => {
      const at = i < 52 ? [0, 0x78, 0x1a0] : [0, 0x1c];
      const before = r((10 << 16) | i);
      const after = f((10 << 16) | i);
      expect(at.map((o) => field(after, o)), `DATA10 ${i}`).toEqual(at.map((o) => fixLine(field(before, o))));
      return after.join() !== before.join();
    });
    expect(changed).toEqual([16, 19, 20, 29, 33, 37, 64, 69, 83, 84]);
    expect(f((9 << 16) | 0)).toEqual(r((9 << 16) | 0));
  });

  it('sceneText: 글 명령 바이트를 fix로 고친 뒤 %M·%%를 푼다', () => {
    const raw = dats.get(8)!.read(3);
    const at = [...raw.keys()].find((p) => raw[p] === 0x29 && field(raw, p + 4).includes(cp949('소용돌이')))!;
    const line = raw.subarray(at + 4, raw.indexOf(0, at + 4));
    expect(sceneText(line, 'A', fixLine)).toBe(cp949('머지않아 커다란 재앙을 불러오게 됩니다.'));
    expect(sceneText(line, 'A', (s) => s)).toBe(text(line));
    expect(sceneText(Uint8Array.from('%M%%', (c) => c.charCodeAt(0)), 'Bob', fixLine)).toBe('Bob%');
  });
});
