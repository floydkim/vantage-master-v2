// 정보 대화 상자의 값 칸과 그림: 네이티얼(0x444ec8, Summon List 0x6f·Summon Infomation 0x81·Unit Information 0x7f), 마법(0x4258ca, Magic 0x70·
// Magic List 0x82), 마스터(0x444376, Unit Information 0x80). 칸은 컨트롤 ID(10진) → 글이고, 원작이 SetDlgItemText를 부르지 않는 칸은 빠진다.
// 그림은 원작처럼 공용 칩 시트의 페이지(0x2e6·0x2d8)와 배치 묶음 7에 읽은 뒤 DIB 색 번호(0x10 = 투명)로 놓는다.
import { natialStats } from '../../engine/rules/natialStats.ts';
import type { SideRecord } from '../../engine/state.ts';
import { type Action, readActionNames, readActions } from '../../formats/actionTable.ts';
import type { ExeImage } from '../../formats/exeImage.ts';
import { type Light, type NatialType, readLightBonus, readNatialTable } from '../../formats/natialTable.ts';
import { u32 } from './attack.ts';
import type { BattleArt } from './screen.ts';
import { CHIP, CHIP_H, CHIP_W } from './sheet.ts';
import { loadLayoutSet, placePage, UNIT_GRAPHICS } from './sprites.ts';

export type InfoTexts = Readonly<Record<number, string>>;

export interface InfoTables {
  readonly natials: readonly NatialType[];
  readonly lightBonus: readonly (readonly number[])[];
  readonly actions: readonly Action[];
  readonly actionNames: readonly (string | null)[];
  readonly elements: readonly string[];
  readonly characters: readonly string[];
  readonly moveTypes: readonly string[];
  readonly masterAttacks: readonly string[];
  /** 0x44406a·0x4440f2·0x4441ef·0x444ec8이 쓰는 글(exe 주소 → 글) */
  readonly text: (va: number) => string;
}

const ELEMENTS = 0x474838;
const CHARACTERS = 0x47484c;
const MOVE_TYPES = 0x45f254;
const MASTER_ATTACKS = 0x469080;
const NONE = 0x4749b4;
const pointers = (exe: ExeImage, at: number, n: number) => Array.from({ length: n }, (_, i) => exe.cString(u32(exe, at + i * 4)));

export function readInfoTables(exe: ExeImage): InfoTables {
  return {
    natials: readNatialTable(exe),
    lightBonus: readLightBonus(exe),
    actions: readActions(exe),
    actionNames: readActionNames(exe),
    elements: pointers(exe, ELEMENTS, 5),
    characters: pointers(exe, CHARACTERS, 3),
    moveTypes: pointers(exe, MOVE_TYPES, 5),
    masterAttacks: pointers(exe, MASTER_ATTACKS, 27),
    text: (va) => exe.cString(va),
  };
}

// vmv2.exe 0x0044406a: 행동 +6 종류 → 마법 종류
function magicKind(t: InfoTables, action: number): string | undefined {
  const kind = t.actions[action].kind;
  if (kind === 0) return t.text(0x4748a0);
  if (kind === 1 || kind === 5) return t.text(0x4748b0);
  if (kind >= 2 && kind <= 4) return t.text(0x4748c0);
}

// vmv2.exe 0x004440f2: 범위 종류(+8), 포물선 높이(+0xb). 4·5는 빈 글(BSS 0x4cd6ac)
function rangeText(t: InfoTables, action: number): string | undefined {
  const a = t.actions[action];
  if (a.rangeKind === 0) return t.text(0x4748d0);
  if (a.rangeKind === 1) return t.text(a.arcHeight < 0x11 ? 0x4748dc : a.arcHeight < 0x19 ? 0x4748f0 : 0x474904);
  if (a.rangeKind === 2) return t.text(0x474918);
  if (a.rangeKind === 3) return t.text(0x474928);
  if (a.rangeKind === 4 || a.rangeKind === 5) return '';
}

// vmv2.exe 0x004441ef: 범위 종류(+8), 효과 반경(+0xa)
function effectText(t: InfoTables, action: number): string | undefined {
  const a = t.actions[action];
  if (a.rangeKind === 0) return t.text(0x474930);
  if (a.rangeKind >= 1 && a.rangeKind <= 3) return [0x474938, 0x474940, 0x474958].map(t.text)[a.areaRadius];
  if (a.rangeKind === 4) return ['', t.text(0x474970), t.text(0x474980)][a.areaRadius];
  if (a.rangeKind === 5) return t.text(0x474990);
}

const set = (out: Record<number, string>, id: number, v: string | undefined) => {
  if (v !== undefined) out[id] = v;
};

/** vmv2.exe 0x00444ec8: 네이티얼 종류의 레벨(0~2)·밝기 미리보기(0x40fb43 → 0x40fe72) */
export function natialInfo(t: InfoTables, type: number, level: 0 | 1 | 2, light: Light): InfoTexts {
  const n = t.natials[type - 1];
  const st = natialStats(n, level, light, t.lightBonus);
  const out: Record<number, string> = {
    1600: n.name,
    1601: t.elements[n.element],
    1602: t.characters[n.lightPreference],
    1603: String(st.attack),
    1604: String(st.defense),
    1605: String(st.magic),
    1606: String(st.magicDefense),
    1607: String(st.speed),
    1608: String(n.movement),
    1609: t.moveTypes[n.moveType],
    1700: String(n.summonMp),
    1701: String(Math.trunc(n.summonMp / 8)),
    1800: n.attackName,
    3000: String(t.actions[n.attackAction].range),
  };
  set(out, 3001, rangeText(t, n.attackAction));
  if (n.magicAction === 0) return { ...out, 1901: t.text(NONE), 1900: '', 3002: '', 3003: '', 3005: '', 3004: '' };
  return { ...out, ...magicInfo(t, n.magicAction) };
}

/** vmv2.exe 0x004258ca: 마법 목록에서 고른 행동 */
export function magicInfo(t: InfoTables, action: number): InfoTexts {
  const out: Record<number, string> = { 1900: t.actionNames[action] ?? '', 3002: String(t.actions[action].range), 3004: String(t.actions[action].mpCost) };
  set(out, 1901, magicKind(t, action));
  set(out, 3003, rangeText(t, action));
  set(out, 3005, effectText(t, action));
  return out;
}

/** vmv2.exe 0x00444376: 진영 레코드만 읽는다(속성·성향·이동 타입은 고정 0·0·1, "Max HP" 칸은 최대 MP). 이름의 &는 &&(0x423c87) */
export function masterInfo(t: InfoTables, side: SideRecord): InfoTexts {
  const out: Record<number, string> = {
    1600: side.name.replace(/&/g, '&&'),
    1500: String(side.level + 1),
    1501: String(side.maxMp),
    1601: t.elements[0],
    1602: t.characters[0],
    1603: String(side.attack),
    1604: String(side.defense),
    1605: String(side.magic),
    1606: String(side.magicDefense),
    1607: String(side.speed),
    1608: String(side.movement),
    1609: t.moveTypes[1],
    1800: t.masterAttacks[side.master],
    3000: String(t.actions[side.attackAction].range),
  };
  set(out, 3001, rangeText(t, side.attackAction));
  return out;
}

export const LEVEL_RADIOS = [3015, 3016, 3017] as const;
/** 밝기 0 Lettle Bright, 1 Bright, 2 Dark */
export const LIGHT_RADIOS = [3019, 3018, 3020] as const;

/** vmv2.exe 0x00444c2b(0): 레벨·밝기 라디오 체크와 끔. levels = 켬 허용(+0x28) && 유닛 있음, light = 그리고 성향 ≠ 0 && 맵 +0x34 ≠ 0 */
export function infoRadios(level: number, light: number, levels: boolean, lightOn: boolean): { checked: Record<number, boolean>; disabled: number[] } {
  return {
    checked: { [LEVEL_RADIOS[level]]: true, [LIGHT_RADIOS[light]]: true },
    disabled: [...(levels ? [] : LEVEL_RADIOS), ...(lightOn ? [] : LIGHT_RADIOS)],
  };
}

export const PORTRAIT_W = 48;
export const PORTRAIT_H = 72;
/** 원본 사각형 높이(아래 5줄은 그리지 않는다) */
export const PORTRAIT_SHOWN = 67;
export const MAGIC_W = 96;
export const MAGIC_H = 192;
/** 네이티얼 대화 상자 그림 페이지, 마스터 대화 상자 페이지 */
export const NATIAL_PAGE = 0x2e6;
export const MASTER_PAGE = 0x2d8;
const MAGIC_GRAPHICS = 0x461094; // [행동 × 2 + 진영]
const MAGIC_LAYOUTS = 0x4611a4;
const MAGIC_SET = 7;
const LAYOUT_POSE = 0x20; // u16 칸
const TINTS = 0x473bb4; // 색 바꿈 표 포인터들(1 = 0x473534)

// vmv2.exe 0x0043f8f1(색 바꿈 표 1): 시트 밖 칩(0x7ff 빈 칸 = 0x465f 등)은 원작에서 늘 0인 메모리다
function drawChips(art: BattleArt, width: number, height: number, cells: readonly (readonly [number, number, number])[]): Uint8Array {
  const tint = art.exe.read(u32(art.exe, TINTS + 4), 256);
  const out = new Uint8Array(width * height).fill(10);
  const chips = art.sheet.chips;
  for (const [x, y, chip] of cells) {
    const at = (chip & 0xffff) * CHIP;
    for (let r = 0; r < CHIP_H; r++) {
      for (let c = 0; c < CHIP_W; c++) out[(y + r) * width + x + c] = tint[at + CHIP <= chips.length ? chips[at + r * CHIP_W + c] : 0];
    }
  }
  return out;
}

/** vmv2.exe 0x004227d5 + 0x004453df·0x00444652: 유닛 그림(그림 번호 × 2 + 진영)을 page에 읽고 묶음 0 자세 0x10의 열 1·2 × 줄 0~5를 48 × 72에 */
export function unitPortrait(art: BattleArt, graphic: number, side: number, page: number): Uint8Array {
  placePage(art.sheet, art.read(u32(art.exe, UNIT_GRAPHICS + (graphic * 2 + side) * 4)), page, false); // 플래그 1
  const base = 0x1000 + page * 16;
  const layout = art.sprites.layouts;
  const cells: [number, number, number][] = [];
  for (let c = 1; c < 3; c++) for (let r = 0; r < 6; r++) cells.push([(c - 1) * CHIP_W, (5 - r) * CHIP_H, base + layout[0x10 * LAYOUT_POSE + r + c * 8]]);
  return drawChips(art, PORTRAIT_W, PORTRAIT_H, cells);
}

/** vmv2.exe 0x004228b2·0x00422a89 + 0x00425ab5: 마법 그림을 페이지 0x2e6·묶음 7에 읽고 자세 14(위 8줄)·15(아래 8줄) 4열을 96 × 192에 */
export function magicPicture(art: BattleArt, action: number): Uint8Array {
  placePage(art.sheet, art.read(u32(art.exe, MAGIC_GRAPHICS + action * 8)), NATIAL_PAGE, false);
  loadLayoutSet(art.read, art.sprites.layouts, u32(art.exe, MAGIC_LAYOUTS + action * 8), MAGIC_SET);
  const base = 0x1000 + NATIAL_PAGE * 16;
  const at = (MAGIC_SET * 0x12 + 14) * LAYOUT_POSE;
  const layout = art.sprites.layouts;
  const cells: [number, number, number][] = [];
  for (let c = 0; c < 4; c++) {
    for (let j = 0; j < 8; j++) {
      cells.push([c * CHIP_W, (7 - j) * CHIP_H, base + layout[at + j + c * 8]]);
      cells.push([c * CHIP_W, (15 - j) * CHIP_H, base + layout[at + LAYOUT_POSE + j + c * 8]]);
    }
  }
  return drawChips(art, MAGIC_W, MAGIC_H, cells);
}
