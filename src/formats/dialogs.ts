// exe의 대화 상자 리소스(RT_DIALOG). 하위 메뉴·알림의 글자와 배치(대화 상자 단위)를 원본에서 읽는다. DLGTEMPLATE와 DLGTEMPLATEEX 모두.
import type { ExeImage } from './exeImage.ts';
import { resourceData } from './resources.ts';

const RT_DIALOG = 5;
const DS_SETFONT = 0x40;

export interface DialogControl {
  readonly id: number;
  /** 창 스타일(낮은 16비트가 BS_*·SS_*·ES_* 등) */
  readonly style: number;
  /** 미리 정한 종류 번호(0x80 단추, 0x81 편집, 0x82 글자, 0x83 목록 상자 …) 또는 클래스 이름 */
  readonly className: string | number;
  readonly text: string | null;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface Dialog {
  readonly title: string;
  readonly style: number;
  /** DS_SETFONT 글꼴(포인트, 이름) */
  readonly font: { readonly size: number; readonly face: string } | null;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly controls: readonly DialogControl[];
}

/** 대화 상자 id(첫 언어)의 템플릿 */
export function readDialog(exe: ExeImage, id: number): Dialog {
  const u16 = (va: number) => new DataView(exe.read(va, 2).buffer).getUint16(0, true);
  const u32 = (va: number) => new DataView(exe.read(va, 4).buffer).getUint32(0, true);
  let p = resourceData(exe, RT_DIALOG, id).va;

  const ex = u16(p) === 1 && u16(p + 2) === 0xffff;
  const short = (va: number) => (u16(va) << 16) >> 16;
  const wide = (): string => {
    let s = '';
    for (let c = u16(p); c !== 0; c = u16(p)) {
      s += String.fromCharCode(c);
      p += 2;
    }
    p += 2;
    return s;
  };
  // 이름 또는 서수(0xffff 다음 u16), 없으면 null
  const nameOrOrdinal = (): string | number | null => {
    const c = u16(p);
    if (c === 0) {
      p += 2;
      return null;
    }
    if (c === 0xffff) {
      p += 4;
      return u16(p - 2);
    }
    return wide();
  };
  const style = ex ? u32(p + 12) : u32(p);
  const count = ex ? u16(p + 16) : u16(p + 8);
  const rect = ex ? p + 18 : p + 10;
  const [x, y, w, h] = [0, 2, 4, 6].map((k) => short(rect + k));
  p = rect + 8;
  nameOrOrdinal(); // 메뉴
  nameOrOrdinal(); // 창 클래스
  const title = wide();
  let font: Dialog['font'] = null;
  if (style & DS_SETFONT) {
    const size = u16(p);
    p += ex ? 6 : 2;
    font = { size, face: wide() };
  }
  const controls: DialogControl[] = [];
  for (let i = 0; i < count; i++) {
    p = (p + 3) & ~3;
    const r = ex ? p + 12 : p + 8;
    const cstyle = ex ? u32(p + 8) : u32(p);
    const cid = ex ? u32(r + 8) : u16(r + 8);
    const [cx, cy, cw, ch] = [0, 2, 4, 6].map((k) => short(r + k));
    p = r + (ex ? 12 : 10);
    const className = nameOrOrdinal();
    const text = nameOrOrdinal();
    p += 2 + u16(p); // 만들 때 넘기는 자료
    controls.push({ id: cid, style: cstyle, className: className ?? 0, text: typeof text === 'number' ? String(text) : text, x: cx, y: cy, w: cw, h: ch });
  }
  return { title, style, font, x, y, w, h, controls };
}
