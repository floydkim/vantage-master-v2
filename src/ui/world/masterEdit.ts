// 마스터 편집 대화 상자(0x7d, 모달리스)와 이름 입력(0x86)의 규칙. 해독 메모 notes_master_edit.md
import type { SideRecord } from '../../engine/state.ts';
import type { BattleData } from '../../engine/battleStart.ts';
import type { Point, Rect, Size } from '../frame/layout.ts';

/** 편집 객체 +0x28~+0x67(0x42c034가 진영 레코드에서 옮김. 목록·조종은 없다) */
export interface MasterEdit {
  readonly name: string;
  readonly standardName: number;
  readonly attackAction: number;
  readonly master: number;
  /** 레벨 0~39(화면은 +1) */
  readonly level: number;
  readonly maxMp: number;
  readonly attack: number;
  readonly defense: number;
  readonly magic: number;
  readonly magicDefense: number;
  readonly speed: number;
  readonly movement: number;
}

export const LIST = 0x579;
export const LEVEL = 0x5dc;
export const NAME_LABEL = 0x640;
export const NAME_EDIT = 0x8fc;
export const EDIT_NAME = 0xbcf;
export const STANDARD_NAME = 0xbd0;
/** 최대 MP·공격·방어·마력·마법방어·속도·이동력 편집 칸(모두 ES_READONLY, 업다운으로만 바뀜) */
export const STAT_EDITS = [0x5dd, 0x643, 0x644, 0x645, 0x646, 0x647, 0x648] as const;
/** 업다운 범위(0x42c4d6 UDM_SETRANGE): 짝 컨트롤 id → [최소, 최대] */
export const EDIT_RANGES = { 0x5de: [1, 40], 0x5df: [0, 236], 0x5e0: [0, 20], 0x5e1: [0, 20], 0x5e2: [0, 20], 0x5e3: [0, 20], 0x5e4: [0, 20], 0x5e5: [0, 20] } as const;
const STAT_KEYS = ['maxMp', 'attack', 'defense', 'magic', 'magicDefense', 'speed', 'movement'] as const;

/** 효과음(notes §13): 열기·Edit Name·이름 OK·Standard Name·OK 1, 목록이 바뀜 0, 이름 거절 3, Cancel 2. 업다운·밖에서 닫힘은 없음 */
export const EDIT_SOUNDS = { open: [1], select: [0], editName: [1], nameOk: [1], nameRejected: [3], standardName: [1], ok: [1], cancel: [2] } as const;

/** vmv2.exe 0x0042c034 */
export function editOf(r: SideRecord): MasterEdit {
  const { name, standardName, attackAction, master, level, maxMp, attack, defense, magic, magicDefense, speed, movement } = r;
  return { name, standardName, attackAction, master, level, maxMp, attack, defense, magic, magicDefense, speed, movement };
}

/** vmv2.exe 0x0042db87: 공격 행동(0x470710)과 능력치 7개(0x4690f0[마스터][레벨]) */
export function withStandardStats(data: Pick<BattleData, 'masters'>, e: MasterEdit): MasterEdit {
  const m = data.masters[e.master];
  return { ...e, attackAction: m.attackAction, ...m.levels[e.level] };
}

/** vmv2.exe 0x0042c9ac(목록 선택이 바뀜): 같은 마스터면 null(소리도 없음). 표준 이름(+0x3c ≠ 0)이면 이름도 따라간다 */
export function selectMaster(data: Pick<BattleData, 'masters'>, names: readonly string[], e: MasterEdit, m: number): MasterEdit | null {
  if (m === e.master) return null;
  return withStandardStats(data, { ...e, master: m, name: e.standardName !== 0 ? names[m] : e.name });
}

/** 레벨 칸 EN_UPDATE(0x42ce52): 레벨을 바꾸고 표준 능력치(손으로 바꾼 값은 버림) */
export const setLevel = (data: Pick<BattleData, 'masters'>, e: MasterEdit, level: number): MasterEdit => withStandardStats(data, { ...e, level });

/** 능력치 업다운이 바꾼 편집 칸(OK 때 0x42c7cc(1)로 읽힘) */
export function setStat(e: MasterEdit, id: number, value: number): MasterEdit {
  const k = STAT_EDITS.indexOf(id as (typeof STAT_EDITS)[number]);
  return k < 0 ? e : { ...e, [STAT_KEYS[k]]: value };
}

/** Standard Name(0xbd0, 0x42d2bc) */
export const useStandardName = (names: readonly string[], e: MasterEdit): MasterEdit => ({ ...e, name: names[e.master], standardName: 1 });

/** vmv2.exe 0x0042c3ab: 1~16바이트 */
export const acceptName = (bytes: string): boolean => bytes.length >= 1 && bytes.length <= 16;

/** 이름 입력이 보낸 0x4b2: 이름을 바꾸고 표준 이름 플래그 0 */
export const renamed = (e: MasterEdit, name: string): MasterEdit => ({ ...e, name, standardName: 0 });

/** vmv2.exe 0x0042c0ff: 편집을 레코드에(마법·네이티얼 목록은 그대로) */
export const applyEdit = (r: SideRecord, e: MasterEdit): SideRecord => ({ ...r, ...e });

/** vmv2.exe 0x00423c87: '&'를 '&&'로(0x80 이상 바이트는 다음 바이트와 묶어 그대로) */
export function nameLabel(name: string): string {
  let out = '';
  for (let i = 0; i < name.length; i++) {
    const c = name[i];
    if (c.charCodeAt(0) >= 0x80) out += c + (name[++i] ?? '');
    else out += c === '&' ? '&&' : c;
  }
  return out;
}

// 오른쪽(아래)으로 넘치면 당기고, 그다음 왼쪽(위)을 넘으면 붙인다(왼쪽이 이김)
const clamp = (v: number, lo: number, hi: number, size: number) => Math.max(v + size > hi ? hi - size : v, lo);

/** vmv2.exe 0x0042c4d6: 커서 − (W/2, H/4), 주 창 안으로, 그다음 화면 안으로 */
export function editDialogAt(cursor: Point, size: Size, main: Rect, screen: Size): Point {
  let x = cursor.x - Math.trunc(size.width / 2);
  let y = cursor.y - Math.trunc(size.height / 4);
  x = clamp(x, main.left, main.right, size.width);
  y = clamp(y, main.top, main.bottom, size.height);
  x = x < 0 ? 0 : x + size.width > screen.width ? screen.width - size.width : x;
  y = y < 0 ? 0 : y + size.height > screen.height ? screen.height - size.height : y;
  return { x, y };
}

/** vmv2.exe 0x0042c2a6: 부모 가로 가운데, 위 끝이 부모 높이의 7/8. 화면 안으로만 */
export function nameDialogAt(parent: Rect, size: Size, screen: Size): Point {
  const x = Math.trunc((parent.left + parent.right - size.width) / 2);
  const y = Math.trunc((7 * parent.bottom + parent.top) / 8);
  return {
    x: x < 0 ? 0 : x + size.width > screen.width ? screen.width - size.width : x,
    y: y < 0 ? 0 : y + size.height > screen.height ? screen.height - size.height : y,
  };
}

/** 마스터 편집 그림 사각형(대화 단위, 0x42caa0 → 0x42cb0e MapDialogRect). 한국어판은 대화 상자 배치를 바꿔 그림도 왼쪽으로(0x42aa52·0x42ac4f) */
export const portraitRect = (korean: boolean): Rect =>
  korean ? { left: 0x3c, top: 0x37, right: 0x74, bottom: 0x91 } : { left: 0x50, top: 0x37, right: 0x88, bottom: 0x91 };
