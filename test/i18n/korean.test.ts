import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readDialog } from '../../src/formats/dialogs.ts';
import { koreanExe, openExeImage } from '../../src/formats/exeImage.ts';
import { loadMap, mapScriptId } from '../../src/formats/mapData.ts';
import { readMasterTable } from '../../src/formats/masterTable.ts';
import { readMenu } from '../../src/formats/menus.ts';
import { datFileName, openVmDat } from '../../src/formats/vmFiles.ts';
import ko from '../../src/i18n/koStrings.json';
import { fetchBytes } from '../../src/ui/assetViewer/loadDat.ts';
import { koreanImage, koreanRead } from '../../src/ui/battle/original.ts';
import { wavBytes } from '../../src/ui/battle/sound.ts';
import { mapDescription } from '../../src/ui/world/worldArt.ts';
import { exe, read } from '../ui/screenCases.ts';
import { browserLatin1 } from './browserDecoder.ts';

// 한국어판 원본(pnpm import-korean)이 있을 때만 돈다
const KO = new URL('../../original/KO/', import.meta.url);
const koExe = existsSync(new URL('Vmv2.exe', KO)) ? openExeImage(new Uint8Array(readFileSync(new URL('Vmv2.exe', KO)))) : null;
const pairs = new Map(Object.entries(ko).map(([e, k]) => [Number(e), Number(k)]));
const dats = new Map([0, 8, 9, 10].map((n) => [n, koExe && openVmDat(n, new Uint8Array(readFileSync(new URL(datFileName(n), KO))))]));
const koRead = (id: number) => dats.get(id >>> 16)!.read(id & 0xffff);
const bytes = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
afterEach(() => vi.unstubAllGlobals()); // 시험이 실패해도 흉내(TextDecoder·crypto·fetch)가 남지 않게
const text = (s: string) => new TextDecoder('euc-kr').decode(bytes(s));
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 16); // 한국어판 글은 저장소에 두지 않고 해시로 비교
const cBytes = (va: number) => {
  let n = 0;
  while (koExe!.read(va + n, 1)[0] !== 0) n++;
  return koExe!.read(va, n);
};

describe.skipIf(!koExe)('한국어 원본 읽기', () => {
  it('한국어 exe: cString은 대응 주소의 바이트, 표는 영문판', () => {
    const k = koreanExe(exe, koExe!, pairs);
    expect(sha(text(k.cString(0x468b40)))).toBe('b878a01c3d7b0ecc');
    expect(k.cString(0x45efc8)).toBe('Vantage Master Tactics V2');
    expect(k.cString(0x45efc9)).toBe(exe.cString(0x45efc9));
    const changed = [...pairs].filter(([e, kva]) => bytes(k.cString(e)).join() !== cBytes(kva).join()).map(([e]) => `0x${e.toString(16)}`);
    expect(changed).toEqual([]);
    expect(k.read(0x4749d8, 0x58 * 25)).toEqual(exe.read(0x4749d8, 0x58 * 25));
    expect(readMasterTable(k)).toEqual(readMasterTable(exe));
  });

  it('바뀐 DAT 항목만 한국어판에서(DATA08 0~5, 09 0~26, 10 0~89; DATA00 26 안내 그림은 같은 그림의 폭만 줄인 것이라 영문판)', () => {
    const r = koreanRead(read, koRead);
    expect([koRead(0x1a).length, read(0x1a).length]).toEqual([528 * 136, 624 * 136]);
    expect(r(0x1a)).toEqual(read(0x1a));
    expect(r(0x19)).toEqual(read(0x19));
    expect(r(0x80005)).toEqual(koRead(0x80005));
    expect(r(0x80006)).toEqual(read(0x80006));
    expect(r(0x9001a)).toEqual(koRead(0x9001a));
    expect(r(0x9001b)).toEqual(read(0x9001b));
    expect(r(0xa0059)).toEqual(koRead(0xa0059));
    expect(r(0xa005a)).toEqual(read(0xa005a));
    expect(r(0xb0000)).toEqual(read(0xb0000));
    const en = loadMap(exe, read, 0);
    const map = loadMap(exe, r, 0);
    expect(sha(text(map.header.name))).toBe('6f00abb72e0b639d');
    expect({ ...map, header: { ...map.header, name: '' }, struct: null }).toEqual({ ...en, header: { ...en.header, name: '' }, struct: null });
    // 이름·설명(+0x1a0)은 바이트 그대로(CP949 0x80~0x9f도, 브라우저 TextDecoder로도)
    browserLatin1();
    const raw = (m: Uint8Array) => m.subarray(0, m.indexOf(0)).join();
    const wrong = Array.from({ length: 52 }, (_, i) => i).filter((i) => {
      const m = loadMap(exe, r, i);
      return bytes(m.header.name).join() !== raw(m.struct) || bytes(mapDescription(m, false)).join() !== raw(m.struct.subarray(0x1a0));
    });
    expect(wrong).toEqual([]);
  });

  it('한국어판 exe는 대응표를 만든 빌드(SHA-256)일 때만 연다: 다른 빌드·영문판·없는 파일 대신 온 index.html이면 null(원문으로 읽음)', async () => {
    const bytes = new Uint8Array(readFileSync(new URL('Vmv2.exe', KO)));
    expect((await koreanImage(bytes))?.cString(0x459ebc)).toBe('Vantage Master Tactics V2');
    const patched = bytes.slice();
    patched[0x1000] ^= 1;
    const html = new TextEncoder().encode('<!doctype html><html></html>');
    expect(await Promise.all([koreanImage(patched), koreanImage(new Uint8Array(readFileSync(new URL('../../original/VMO_WIN/vmv2.exe', import.meta.url)))), koreanImage(html)])).toEqual([null, null, null]);
  });

  it('crypto.subtle이 없으면(http 주소, 보안 맥락 아님) 한국어판 exe를 확인할 수 없어 null(원문으로 열림, 오류 아님)', async () => {
    vi.stubGlobal('crypto', {});
    expect(await koreanImage(new Uint8Array(readFileSync(new URL('Vmv2.exe', KO))))).toBeNull();
  });

  it('대화 상자 0x7c·메뉴 0x66은 한국어판 리소스', () => {
    const k = koreanExe(exe, koExe!, pairs);
    expect(readDialog(k, 0x7c)).toEqual(readDialog(koExe!, 0x7c));
    expect(readDialog(k, 0x7c)).not.toEqual(readDialog(exe, 0x7c));
    expect(readMenu(k, 0x66)).toEqual(readMenu(koExe!, 0x66));
    expect([readDialog(k, 0x7c).title, readMenu(k, 0x66)[0].items![1].text].map(sha)).toEqual(['382fe521c19eb76f', '8e327f0e4882228a']);
  });
});

const koSounds = existsSync(new URL('DATA13.DAT', KO)) ? openVmDat(13, new Uint8Array(readFileSync(new URL('DATA13.DAT', KO)))) : null;

it.skipIf(!koSounds)('한국어판 DATA13: 154개를 WAV 길이로 자르면 140개는 영문판과 같고 14개가 한국어 더빙', () => {
  const differ = Array.from({ length: koSounds!.entryCount }, (_, i) => i).filter((i) => Buffer.compare(wavBytes(koSounds!.read(i)), read((13 << 16) | i)) !== 0);
  expect([koSounds!.entryCount, differ]).toEqual([154, [4, 28, 29, 30, 92, 95, 97, 98, 105, 114, 118, 120, 129, 146]]);
});

it('원본을 못 받으면 오류가 받는 방법을 알린다: 영문판 pnpm fetch-original, 한국어판 pnpm import-korean', async () => {
  vi.stubGlobal('fetch', async () => new Response(null, { status: 404 }));
  await expect(fetchBytes('vmv2.exe')).rejects.toThrow('pnpm fetch-original');
  await expect(fetchBytes('DATA08.DAT', 'KO')).rejects.toThrow('`pnpm import-korean <한국어판 폴더>`를');
});

it('맵 이름·설명은 바이트 그대로 푼다 — 브라우저 TextDecoder(ascii·latin1은 windows-1252)를 거치면 CP949 0x80~0x9f가 다른 글자가 된다', () => {
  const id = mapScriptId(exe, 0);
  const r = (n: number) => {
    if (n !== id) return read(n);
    const c = read(n).slice();
    c.set([0xb0, 0x81, 0x9f, 0x80, 0], 0); // 이름
    c.set([0xc7, 0x8f, 0x41, 0], 0x1a0); // 설명
    return c;
  };
  browserLatin1();
  const m = loadMap(exe, r, 0);
  expect([[...bytes(m.header.name)], [...bytes(mapDescription(m, false))]]).toEqual([[0xb0, 0x81, 0x9f, 0x80], [0xc7, 0x8f, 0x41]]);
});
