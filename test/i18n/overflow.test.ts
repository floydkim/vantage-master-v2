import { existsSync, readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { masDescription } from '../../src/engine/scenario.ts';
import { readDescriptions, readMapLabel } from '../../src/formats/descriptions.ts';
import { type ExeImage, koreanExe, openExeImage } from '../../src/formats/exeImage.ts';
import { loadMap } from '../../src/formats/mapData.ts';
import { datFileName, openVmDat } from '../../src/formats/vmFiles.ts';
import { setHangul } from '../../src/i18n/hangul.ts';
import ko from '../../src/i18n/koStrings.json';
import { HELP_W } from '../../src/ui/battle/helpWindow.ts';
import { MENU_W, menuLabels } from '../../src/ui/battle/menu.ts';
import { koreanRead } from '../../src/ui/battle/original.ts';
import { elapsedColumns } from '../../src/ui/battle/resultWindow.ts';
import { reportElapsedColumns } from '../../src/ui/scene/engine.ts';
import { MAP_INFO_W, mapDescription } from '../../src/ui/world/worldArt.ts';
import { portraitRect } from '../../src/ui/world/masterEdit.ts';
import { readDialog } from '../../src/formats/dialogs.ts';
import { dialogLayout, fitPicture } from '../../src/ui/frame/dialogLayout.ts';
import { WIN98 } from '../../src/ui/frame/frame.ts';
import { exe, read } from '../ui/screenCases.ts';

// 한국어판 원본(pnpm import-korean)이 있을 때만 돈다. 글자 하나(바이트)는 8px, 한글은 2바이트 16px
const KO = new URL('../../original/KO/', import.meta.url);
const koExe = existsSync(new URL('Vmv2.exe', KO)) ? openExeImage(new Uint8Array(readFileSync(new URL('Vmv2.exe', KO)))) : null;
const pairs = new Map(Object.entries(ko).map(([e, k]) => [Number(e), Number(k)]));
const dats = new Map([8, 9, 10].map((n) => [n, koExe && openVmDat(n, new Uint8Array(readFileSync(new URL(datFileName(n), KO))))]));
const k = koExe && koreanExe(exe, koExe, pairs);
const r = koreanRead(read, (id) => dats.get(id >>> 16)!.read(id & 0xffff));
const u32 = (x: ExeImage, va: number) => new DataView(x.read(va, 4).buffer).getUint32(0, true);
afterEach(() => setHangul(null));

describe.skipIf(!koExe)('한국어판 글이 상자를 넘치지 않는다', () => {
  it('도움말: 지형·네이티얼·마스터·마법 설명, 맵 설명, 적 마스터(MAS) 설명은 6줄 이하이고 줄마다 글 자리(x 0x7f)부터 도움창 폭(624) 안', () => {
    const t = readDescriptions(k!);
    const maps = Array.from({ length: 52 }, (_, i) => loadMap(exe, r, i));
    const texts = [
      ...t.terrain,
      ...t.natials,
      ...t.masters,
      ...Array.from({ length: 6 }, (_, i) => k!.cString(u32(exe, 0x462314 + (10 + i) * 4))),
      ...maps.map(mapDescription),
      ...maps.map((m) => masDescription(r(m.header.enemyMasterId))),
    ];
    const wide = texts.filter((s) => {
      const lines = s.replace(/\n$/, '').split('\n'); // 끝 줄바꿈 뒤 빈 줄은 그리지 않음
      return lines.length > 6 || lines.some((l) => 0x7f + l.length * 8 > HELP_W);
    });
    expect(wide).toEqual([]);
  });

  it('결과 창 소요 시간: 일·시(2자리)는 글(x 56)의 빈칸에, 분 글은 글 뒤에(영문판 0x408614, 한국어판 0x40b5c4·0x40b628·0x40b669)', () => {
    for (const [x, korean] of [[exe, false] as const, [k!, true] as const]) {
      setHangul(korean ? () => new Uint8Array(32) : null);
      const label = x.cString(0x45f0fc);
      const [days, hours, minutes] = elapsedColumns();
      const blank = (at: number) => label.slice(Math.round((at - 56) / 8), Math.round((at + 16 - 56) / 8)).trim() === ''; // 영문판도 일 숫자가 앞 글자 끝 1px 열에 걸침
      expect([blank(days), blank(hours), minutes >= 56 + label.length * 8], `${korean ? '한국어' : '원문'} '${label}' ${[days, hours, minutes]}`).toEqual([true, true, true]);
    }
  });

  it('장면 보고서 소요 시간: 일(3자리)·시(2자리)는 글(x 0x120)의 빈칸에, 분은 글 뒤에(한국어판 0x41ce65·0x41cec9·0x41cf2b; 영문판 0x41c62f는 원작부터 겹침)', () => {
    setHangul(() => new Uint8Array(32));
    const label = k!.cString(0x460360);
    const [days, hours, minutes] = reportElapsedColumns();
    const blank = (at: number, n: number) => label.slice(Math.round((at - 0x120) / 8), Math.round((at + n * 8 - 0x120) / 8)).trim() === '';
    expect([blank(days, 3), blank(hours, 2), minutes >= 0x120 + label.length * 8], `'${label}' ${[days, hours, minutes]}`).toEqual([true, true, true]);
  });

  it('마스터 편집(0x7d) 그림은 그 판 대화 상자의 이름표·칸과 겹치지 않는다(영문판 0x42cb0e, 한국어판은 배치를 바꿔 0x42aa52·0x42ac4f)', () => {
    const overlaps = (x: ExeImage, korean: boolean) => {
      const p = fitPicture(portraitRect(korean), { width: 48, height: 67 });
      return dialogLayout(readDialog(x, 0x7d), WIN98)
        .controls.filter((c) => c.className === 0x82 || c.className === 0x81)
        .filter((c) => c.rect.left < p.right && p.left < c.rect.right && c.rect.top < p.bottom && p.top < c.rect.bottom)
        .map((c) => c.text ?? c.id);
    };
    expect([overlaps(exe, false), overlaps(k!, true)]).toEqual([[], []]);
  });

  it('명령 메뉴 글(x 0x16 − 7)은 메뉴 폭 안, 맵 정보의 밝기 글(x 80)·맵 이름표(x 216)는 창 폭 안', () => {
    expect(menuLabels(k!).filter((l) => 15 + l.length * 8 > MENU_W)).toEqual([]);
    const light = [0x468c4c, ...[0, 1, 2].map((i) => u32(exe, 0x468b84 + i * 4))].map((va) => k!.cString(va));
    expect(light.filter((l) => 80 + l.length * 8 > MAP_INFO_W - 8)).toEqual([]);
    expect(Array.from({ length: 52 }, (_, i) => readMapLabel(k!, i)).filter((l) => 216 + l.length * 8 > MAP_INFO_W - 8)).toEqual([]);
  });
});
