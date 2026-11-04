// exe의 메뉴 리소스(RT_MENU, MENUTEMPLATE). 글자의 &는 밑줄 글자, \t 뒤는 단축키 글자다
import type { ExeImage } from './exeImage.ts';
import { resourceData } from './resources.ts';

const RT_MENU = 4;
export const MF_GRAYED = 0x1;
export const MF_CHECKED = 0x8;
const MF_POPUP = 0x10;
const MF_END = 0x80;

export interface MenuItem {
  /** 0이면 구분선(펼침 메뉴는 id 없음) */
  readonly id: number;
  readonly text: string;
  readonly flags: number;
  readonly items?: readonly MenuItem[];
}

/** 메뉴 id의 항목들 */
export function readMenu(exe: ExeImage, id: number): MenuItem[] {
  let p = resourceData(exe, RT_MENU, id).va;
  const u16 = () => {
    const v = new DataView(exe.read(p, 2).buffer).getUint16(0, true);
    p += 2;
    return v;
  };
  const wide = (): string => {
    let s = '';
    for (let c = u16(); c !== 0; c = u16()) s += String.fromCharCode(c);
    return s;
  };
  u16(); // 판
  const header = u16(); // 머리 뒤 덧붙임(p += u16()은 u16 안의 증가를 잃는다)
  p += header;
  const list = (): MenuItem[] => {
    const out: MenuItem[] = [];
    for (;;) {
      const flags = u16();
      if (flags & MF_POPUP) out.push({ id: 0, text: wide(), flags: flags & ~(MF_POPUP | MF_END), items: list() });
      else {
        const itemId = u16();
        out.push({ id: itemId, text: wide(), flags: flags & ~MF_END });
      }
      if (flags & MF_END) return out;
    }
  };
  return list();
}
