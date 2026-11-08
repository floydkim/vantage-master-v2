// 우리 번역이 바꾸는 글의 목록(설계 2026-11-07 §4.2). 자리 이름(where)은 시험·내려받기·검수 도구가 함께 쓴다:
// exe:0x45f0fc, dialog:0x7d:t(제목)·dialog:0x7d:3(컨트롤 차례), menu:0x66:0.2(항목 차례 경로), map:14:0x78, mas:84:0x1c, scene:3:5(DATA08 항목:줄), ending:7:21(DATA09).
// 글은 원본에서 읽는다(저장소에 넣지 않음)
import { readDialog } from '../formats/dialogs.ts';
import type { ExeImage } from '../formats/exeImage.ts';
import { type MenuItem, readMenu } from '../formats/menus.ts';
import { resourceIds } from '../formats/resources.ts';
import type { ReadAny } from '../ui/battle/sheet.ts';
import { byteKey, uiKey } from './ko.ts';
import koStrings from './koStrings.json';

export type SourceKind = 'exe' | 'dialog' | 'menu' | 'map' | 'mas' | 'scene' | 'ending';

export interface Source {
  readonly where: string;
  readonly kind: SourceKind;
  /** 바이트 문자열(글자 = 바이트), wide면 UTF-16 리소스 글 */
  readonly text: string;
  readonly wide: boolean;
}

export interface Edition {
  readonly exe: ExeImage;
  readonly read: ReadAny;
}

const RT_MENU = 4;
const RT_DIALOG = 5;
const DEBUG_DIALOG = 0x71; // 개발자용 디버그 옵션(일본어, 원작 배포판에서 열 수 없고 리메이크도 쓰지 않음): 번역하지 않는다
const MAP_FIELDS = [0, 0x78, 0x1a0];
const MAS_FIELDS = [0, 0x1c];
// 장면 스크립트 명령의 길이(i32 칸, re/scene.md). 0x29는 4 + 글 + 0, 0x19·0x23은 0x80000000까지
const LENGTH: Readonly<Record<number, number>> = {
  0: 8, 1: 7, 2: 2, 3: 3, 4: 5, 5: 6, 6: 7, 7: 7, 8: 8, 9: 2, 0xa: 5, 0xb: 3, 0xc: 4, 0xd: 4, 0xe: 7, 0xf: 5, 0x10: 6, 0x11: 7, 0x12: 7,
  0x13: 4, 0x14: 5, 0x15: 5, 0x16: 4, 0x17: 3, 0x18: 3, 0x1a: 2, 0x1b: 3, 0x1c: 5, 0x1d: 3, 0x1e: 3, 0x1f: 3, 0x20: 4, 0x21: 2, 0x22: 2,
  0x24: 1, 0x25: 2, 0x26: 2, 0x27: 2, 0x28: 2, 0x2a: 2, 0x2b: 5, 0x2c: 6, 0x2d: 1, 0x2e: 2, 0x2f: 2, 0x30: 1, 0x31: 2,
};

/** 장면·엔딩 스크립트의 글 명령(0x29) 글들, 스크립트 차례. 처음부터 명령을 차례로 훑어 끝에서 딱 끝나야 한다(아니면 RangeError) */
export function sceneLines(script: Uint8Array): string[] {
  const v = new DataView(script.buffer, script.byteOffset, script.byteLength);
  const lines: string[] = [];
  let p = 0;
  const i32 = (at: number) => {
    if (at + 4 > script.length) throw new RangeError(`장면 스크립트가 ${at}에서 끝남`);
    return v.getInt32(at, true);
  };
  while (p < script.length) {
    const op = i32(p);
    if (op === 0x29) {
      const end = script.indexOf(0, p + 4);
      if (end < 0) throw new RangeError(`글 명령(${p})이 0 없이 끝남`);
      lines.push(String.fromCharCode(...script.subarray(p + 4, end)));
      p = end + 1;
    } else if (op === 0x19 || op === 0x23) {
      p += op === 0x23 ? 8 : 4;
      while (i32(p) !== (0x80000000 | 0)) p += 4;
      p += 4;
    } else if (LENGTH[op] !== undefined) {
      p += LENGTH[op] * 4;
    } else throw new RangeError(`모르는 장면 명령 0x${op.toString(16)}(${p})`);
  }
  if (p !== script.length) throw new RangeError(`장면 스크립트 끝(${script.length})을 넘음: ${p}`);
  return lines;
}

/** 번역할 글인가: 영문 글자가 있거나 2바이트 글자(일본어)가 있다 */
export const needsTranslation = (text: string): boolean => /[A-Za-z]/.test(text) || /[\x80-￿]/.test(text);

const field = (b: Uint8Array, at: number): string => {
  const end = b.indexOf(0, at);
  return String.fromCharCode(...b.subarray(at, end < 0 ? b.length : end));
};

const menuAt = (items: readonly MenuItem[], path: readonly number[]): MenuItem | undefined =>
  path.slice(1).reduce<MenuItem | undefined>((m, i) => m?.items?.[i], items[path[0]]);

/** 자리의 글(그 판에서). 없는 자리면 null */
export function textAt(where: string, e: Edition): string | null {
  const [kind, a, b] = where.split(':');
  try {
    switch (kind) {
      case 'exe':
        return e.exe.cString(Number(a));
      case 'dialog': {
        const d = readDialog(e.exe, Number(a));
        return b === 't' ? d.title : (d.controls[Number(b)]?.text ?? null);
      }
      case 'menu':
        return menuAt(readMenu(e.exe, Number(a)), b.split('.').map(Number))?.text ?? null;
      case 'map':
      case 'mas':
        return field(e.read((10 << 16) | Number(a)), Number(b));
      case 'scene':
      case 'ending':
        return sceneLines(e.read(((kind === 'scene' ? 8 : 9) << 16) | Number(a)))[Number(b)] ?? null;
    }
  } catch (err) {
    if (err instanceof RangeError) return null;
    throw err;
  }
  return null;
}

/** 다른 판(정발판)의 같은 자리 글. 장면·엔딩은 두 판의 줄 수가 다르면 짝지을 수 없어 null, exe 글은 대응이 없어 원문과 같으면 null */
export function pairedText(where: string, en: Edition, other: Edition): string | null {
  const [kind, a] = where.split(':');
  if (kind === 'scene' || kind === 'ending') {
    const id = ((kind === 'scene' ? 8 : 9) << 16) | Number(a);
    if (sceneLines(en.read(id)).length !== sceneLines(other.read(id)).length) return null;
  }
  const t = textAt(where, other);
  return kind === 'exe' && t === textAt(where, en) ? null : t;
}

const hex = (n: number) => `0x${n.toString(16)}`;

/** 번역할 글 전부(needsTranslation인 것), 자리 차례: exe(koStrings.json 차례) → 대화 상자 → 메뉴 → 맵 → 적 마스터 → 장면 → 엔딩 */
export function allSources(e: Edition): Source[] {
  const out: Source[] = [];
  const add = (where: string, kind: SourceKind, text: string | null, wide = false) => {
    if (text !== null && needsTranslation(text)) out.push({ where, kind, text, wide });
  };
  for (const va of Object.keys(koStrings)) add(`exe:${hex(Number(va))}`, 'exe', e.exe.cString(Number(va)));
  for (const id of resourceIds(e.exe, RT_DIALOG).filter((d) => d !== DEBUG_DIALOG)) {
    const d = readDialog(e.exe, id);
    add(`dialog:${hex(id)}:t`, 'dialog', d.title, true);
    // 이름 클래스 컨트롤(msctls_updown32 등)의 글은 창 이름이라 화면에 나오지 않는다
    d.controls.forEach((c, i) => typeof c.className === 'number' && add(`dialog:${hex(id)}:${i}`, 'dialog', c.text, true));
  }
  for (const id of resourceIds(e.exe, RT_MENU)) {
    const walk = (items: readonly MenuItem[], path: number[]) =>
      items.forEach((m, i) => {
        add(`menu:${hex(id)}:${[...path, i].join('.')}`, 'menu', m.text, true);
        if (m.items) walk(m.items, [...path, i]);
      });
    walk(readMenu(e.exe, id), []);
  }
  for (let i = 0; i < 90; i++) {
    const kind = i < 52 ? 'map' : 'mas';
    for (const at of i < 52 ? MAP_FIELDS : MAS_FIELDS) add(`${kind}:${i}:${hex(at)}`, kind, field(e.read((10 << 16) | i), at));
  }
  for (const [kind, dat, n] of [['scene', 8, 6], ['ending', 9, 27]] as const) {
    for (let i = 0; i < n; i++) sceneLines(e.read((dat << 16) | i)).forEach((t, k) => add(`${kind}:${i}:${k}`, kind, t));
  }
  return out;
}

/** 번역 표의 키 */
export const sourceKey = (s: Source): string => (s.wide ? uiKey(s.text) : byteKey(s.text));
