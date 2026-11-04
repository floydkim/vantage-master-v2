// 프레임 창 상태(vmv2.exe 0x00407334): 메뉴 켬·체크와 제목. 창 크기는 GetSystemMetrics 값(Win98 기본 배색)으로 센다
import type { ExeImage } from '../../formats/exeImage.ts';

/** GetSystemMetrics: SM_CYCAPTION(4), SM_CXDLGFRAME·SM_CYDLGFRAME(7·8), SM_CXFRAME·SM_CYFRAME(0x20·0x21), SM_CXVSCROLL·SM_CYHSCROLL(2·3), SM_CYMENU(0xf) */
export interface Metrics {
  readonly caption: number;
  readonly dlgFrame: number;
  readonly frame: number;
  readonly scroll: number;
  readonly menu: number;
}
export const WIN98: Metrics = { caption: 19, dlgFrame: 3, frame: 4, scroll: 16, menu: 19 };

/** 앱 장면(0x503fc8) */
export const SCENE = { title: 1, masterMake: 2, world: 3, battle: 4, result: 5, ending: 6 } as const;

export interface FrameContext {
  readonly scene: number;
  /** 네트워크 대전(0x5061d4, 연결 0x43162c) */
  readonly network: boolean;
  /** 시나리오(0x5061d8)면 난이도 0 Easy·1 Normal·그 밖 Expert(0x5061cc), 아니면 null(프리) */
  readonly scenario: number | null;
  /** 전투에 사람(진영 제어 0)이 있다(0x4077d9) */
  readonly human: boolean;
  /** 전장 확대(0 = x /2, 1 = x 1, 2 = x 2) */
  readonly zoom: number;
  /** 창이 있는가: 미니맵(View)·정보 창(Status)·도움말(HelpGuide)·채팅 */
  readonly view: boolean;
  readonly status: boolean;
  readonly help: boolean;
  readonly chat: boolean;
}

export interface MenuFlags {
  readonly enabled: boolean;
  readonly checked: boolean;
}

/** vmv2.exe 0x00407334: 메뉴 항목 id → 켬·체크(없는 id는 리소스대로 켬) */
export function menuState(c: FrameContext): Readonly<Record<number, MenuFlags>> {
  const s = c.scene;
  const on = (enabled: boolean, checked = false): MenuFlags => ({ enabled, checked: enabled && checked });
  const battle = s === SCENE.battle;
  const panes = s === SCENE.world || battle || s === SCENE.result;
  return {
    0x9c7b: on(s === SCENE.world), // 0x451c64
    0x9c81: on([2, 3, 4, 5, 7, 8].includes(s)), // 0x451c75
    0x9c80: on(battle || s === SCENE.result), // 0x451cc6
    0x9c82: on(battle && c.human), // 0x4077d9
    0x9c8d: on(c.network), // 0x43162c
    0x9c43: on(battle, c.zoom === 0), // 0x407850
    0x9c44: on(battle, c.zoom === 1),
    0x9c45: on(battle, c.zoom === 2),
    0x9c5b: on(battle, c.view), // 0x407861 → 0x40d912
    0x9c5c: on(battle, c.status), // 0x407872 → 0x40aed3
    0x9c7d: on(panes, c.help), // 0x407883 → 0x424e1a
    0x9c83: on(panes && c.network, c.chat), // 0x4078b9 → 0x417f38
    0x9c7f: on(s === SCENE.world || battle), // 0x4078f9
  };
}

const TITLE = 0x45efc8; // "Vantage Master V2"
const SUFFIX = { network: 0x45efdc, free: 0x45eff0, easy: 0x45f000, normal: 0x45f01c, expert: 0x45f038 };

/** 프레임 제목(0x407334 끝): 장면 2~5면 대전 방식을 붙인다 */
export function frameTitle(exe: ExeImage, c: Pick<FrameContext, 'scene' | 'network' | 'scenario'>): string {
  const title = exe.cString(TITLE);
  if (![2, 3, 4, 5].includes(c.scene)) return title;
  const at = c.network ? SUFFIX.network : c.scenario === null ? SUFFIX.free : c.scenario === 0 ? SUFFIX.easy : c.scenario === 1 ? SUFFIX.normal : SUFFIX.expert;
  return title + exe.cString(at);
}
