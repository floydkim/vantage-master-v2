// 시나리오(Easy·Normal)·Expert 모드: 시작 블록, 우리·적 진영 준비, 맵 묶음 열림과 다음 장면, 전투 통계 누적. 해독 메모 re/scenario.md
import type { ExeImage } from '../formats/exeImage.ts';
import { MASTER_LEVELS, type MasterStats, type MasterType, readMasterStats } from '../formats/masterTable.ts';
import { type SideRecord, STATE_SIZE } from './state.ts';

/** *0x5061cc(블록 +0xc): 0 Easy, 1 Normal, 2 Expert */
export type ScenarioMode = 0 | 1 | 2;

const SCENARIO_GROUPS = 0x475b9c; // i32 × 9: 맵 0부터 묶음 크기
const EXPERT_GROUPS = 0x475bc0; // i32 × 8: 맵 30부터
const EXPERT_FIRST = 30;
const ITEMS = 0x468d60; // 0x10바이트 × 30: +0 종류(1 네이티얼, 그 밖 마법), +4 번호
const ITEM_COUNT = 30;
const REWARDS = 0x468f40; // i32 × 26: 맵 0~25를 깨면 받는 아이템(0x42da6c)
const REWARD_MAPS = 0x1a;
const MAP_FLAGS = 0x198;
const NAME_SIZE = 20;
const SPELL_SLOTS = 6; // 진영 레코드 +0x1c 개수 + 6칸
const NATIAL_SLOTS = 24; // +0x38 개수 + 24칸

export interface ScenarioData {
  readonly masters: readonly MasterType[];
  readonly groups: { readonly scenario: readonly number[]; readonly expert: readonly number[] };
  readonly items: readonly { readonly natial: boolean; readonly value: number }[];
  readonly rewards: readonly number[];
  /** 0x42dae0의 평탄한 행(마스터 × 40 + 레벨). 깬 맵을 다시 깨면 레벨에 상한이 없다 */
  readonly stats: (row: number) => MasterStats;
}

export function readScenarioData(exe: ExeImage): Omit<ScenarioData, 'masters'> {
  const i32s = (at: number, n: number) => {
    const v = new DataView(exe.read(at, n * 4).buffer);
    return Array.from({ length: n }, (_, k) => v.getInt32(k * 4, true));
  };
  const items = Array.from({ length: ITEM_COUNT }, (_, k) => {
    const [kind, value] = i32s(ITEMS + k * 0x10, 2);
    return { natial: kind === 1, value };
  });
  return {
    groups: { scenario: i32s(SCENARIO_GROUPS, 9), expert: i32s(EXPERT_GROUPS, 8) },
    items,
    rewards: i32s(REWARDS, REWARD_MAPS),
    stats: (row) => readMasterStats(exe, row),
  };
}

/** vmv2.exe 0x00450da0(Easy·Normal, 모드는 0x426a3a가 넣음)·0x00450e35(Expert): 시나리오 플래그, 네트워크 0, 맵 플래그는 첫 묶음만 1, 진영 0 사람·1 CPU */
export function scenarioBlock(mode: ScenarioMode, groups: ScenarioData['groups']): Uint8Array {
  const raw = new Uint8Array(STATE_SIZE);
  const v = new DataView(raw.buffer);
  v.setInt32(0x08, 1, true); // *0x5061d8
  v.setInt32(0x0c, mode, true); // *0x5061cc
  v.setInt32(0x10, 0, true); // *0x5061d4
  const [first, count] = mode === 2 ? [EXPERT_FIRST, groups.expert[0]] : [0, groups.scenario[0]];
  for (let m = 0; m < count; m++) v.setInt32(MAP_FLAGS + (first + m) * 4, 1, true); // 0x475b98
  v.setInt32(0x9ec, 0, true); // 진영 상태 0 조종(0x45e0ec): 사람
  v.setInt32(0xa04, 1, true); // 진영 상태 1: CPU
  return raw;
}

/** vmv2.exe 0x0042dae0: 마스터의 공격 행동, 행 (마스터 × 40 + 레벨)의 능력치 */
function withMaster(data: Pick<ScenarioData, 'masters' | 'stats'>, r: Omit<SideRecord, 'attackAction' | 'maxMp' | 'attack' | 'defense' | 'magic' | 'magicDefense' | 'speed' | 'movement'>): SideRecord {
  const m = data.masters[r.master];
  if (!m) throw new RangeError(`마스터 ${r.master}가 표에 없습니다`);
  return { ...r, attackAction: m.attackAction, ...data.stats(r.master * MASTER_LEVELS + r.level) };
}

/**
 * vmv2.exe 0x0042d7d0·0x0042d966: 오름차순 자리에 넣는다(같은 값도 넣음, 뒤에).
 * 원작은 칸 수를 보지 않아 깬 맵을 다시 깨 보상이 겹치면 레코드를 덮어쓴다(네이티얼 25번째 → +0x9c 마스터, 마법 7번째 → +0x38 네이티얼 개수). 여기는 꽉 차면 넣지 않는다(re/scenario.md)
 */
const insert = (list: readonly number[], n: number, max: number) => (list.length >= max ? list : [...list.filter((x) => x <= n), n, ...list.filter((x) => x > n)]);

/** vmv2.exe 0x0042d64f: 아이템을 진영 목록에(−1은 없음) */
function addItem(data: Pick<ScenarioData, 'items'>, r: SideRecord, item: number): SideRecord {
  if (item === -1) return r;
  const { natial, value } = data.items[item];
  return natial ? { ...r, natials: insert(r.natials, value, NATIAL_SLOTS) } : { ...r, spells: insert(r.spells, value, SPELL_SLOTS) };
}

/** vmv2.exe 0x0042d190: 우리 진영(진영 0). 이름은 Master making에서 넣은 글자(0x483efc), 레벨은 Expert 22·시나리오 0 */
export function scenarioPlayer(data: Pick<ScenarioData, 'masters' | 'stats'>, name: string, master: number, mode: ScenarioMode): SideRecord {
  const r = withMaster(data, { name: name.slice(0, NAME_SIZE), standardName: 0, spells: [], natials: [], master, level: mode === 2 ? 0x16 : 0 });
  if (mode === 2) return { ...r, spells: [10, 11, 12, 13, 14, 15], natials: Array.from({ length: 24 }, (_, k) => k + 1) };
  return { ...r, natials: [1, 7, 13, 22] };
}

/** vmv2.exe 0x0042d2e9: 맵의 적 마스터 설정(MAS0xx._SC: [0~4] 이름, [5] 마스터, [6] 레벨, [0x51…] 아이템 −1까지)으로 적 진영. Easy는 레벨을 낮춘다 */
export function scenarioEnemy(data: Pick<ScenarioData, 'masters' | 'items' | 'stats'>, mas: Uint8Array, mode: ScenarioMode): SideRecord {
  const v = new DataView(mas.buffer, mas.byteOffset, mas.byteLength);
  const i32 = (k: number) => v.getInt32(k * 4, true);
  const end = mas.indexOf(0);
  const name = String.fromCharCode(...mas.subarray(0, Math.min(end < 0 ? NAME_SIZE : end, NAME_SIZE)));
  const level = mode === 0 ? Math.trunc((Math.max(i32(6) - 7, 0) * 0x11 + 5) / 0x16) : i32(6);
  let r = withMaster(data, { name, standardName: 0, spells: [], natials: [], master: i32(5), level });
  for (let k = 0x51; i32(k) !== -1; k++) r = addItem(data, r, i32(k));
  return r;
}

/** vmv2.exe 0x0042d2e9 → 0x00424fbf: MAS +0x1c의 글(진영 1 마스터 설명, 0x483bec) */
export function masDescription(mas: Uint8Array): string {
  const end = mas.indexOf(0, 0x1c);
  return String.fromCharCode(...mas.subarray(0x1c, end < 0 ? mas.length : end));
}

/** 블록 +0xd78: 시나리오 통계 i32 59칸(0x482dc4 = 0x4cd588). 0x41bce9가 비우고 0x41bd98가 전투마다 더한다 */
export const SCENARIO_STATS = 0xd78;
const STATS_COUNT = 59;
const MAP_COUNT = 52;

/** 블록의 시나리오 칸: +0x8 시나리오, +0xc 모드, +0x198 맵 플래그 52개(0 숨김·1 열림·2 깸), +0xd78 통계 59칸 */
export interface ScenarioWorld {
  readonly mode: ScenarioMode;
  readonly flags: readonly number[];
  readonly stats: readonly number[];
}

/** 블록에 시나리오 칸을 쓴다(원작은 같은 블록이 늘 들고 있어 게임 데이터·이어 하기에 그대로 남는다) */
export function writeScenario(raw: Uint8Array, s: ScenarioWorld): void {
  const v = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  v.setInt32(0x08, 1, true);
  v.setInt32(0x0c, s.mode, true);
  s.flags.forEach((f, k) => v.setInt32(MAP_FLAGS + k * 4, f, true));
  s.stats.forEach((n, k) => v.setInt32(SCENARIO_STATS + k * 4, n, true));
}

/** 블록의 시나리오 칸. +0x8이 0(프리·네트워크)이면 없음 */
export function readScenario(raw: Uint8Array): ScenarioWorld | undefined {
  const v = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const mode = v.getInt32(0x0c, true);
  if (v.getInt32(0x08, true) === 0 || mode < 0 || mode > 2) return undefined; // 모드가 0~2 밖이면 손댄 세이브
  const i32s = (at: number, n: number) => Array.from({ length: n }, (_, k) => v.getInt32(at + k * 4, true));
  return { mode: mode as ScenarioMode, flags: i32s(MAP_FLAGS, MAP_COUNT), stats: i32s(SCENARIO_STATS, STATS_COUNT) };
}

/**
 * vmv2.exe 0x0045157b(결과 창 END 0x408034, 시나리오·Expert): 고른 맵을 2(깸)로, 묶음을 차례로 열고(0 → 1) 깬 맵이 (크기 + 1) / 2보다 적은 묶음에서 멈춘다.
 * 0x0042da93으로 우리 마스터 레벨 + 1·능력치·보상 아이템(0x42da6c: 맵 0~25)을 준다. 장면: 시나리오에서 새 묶음 1~5가 열리면 0~4, 맵 26이면 5, 다 깼으면 6, 아니면 −1
 */
export function progressScenario(data: ScenarioData, flags: readonly number[], selected: number, mode: ScenarioMode, player: SideRecord): { flags: number[]; scene: number; player: SideRecord } {
  const next = [...flags];
  next[selected] = 2;
  const [first, groups] = mode === 2 ? [EXPERT_FIRST, data.groups.expert] : [0, data.groups.scenario];
  let opened = false;
  let at = first;
  let g = 0;
  for (; g < groups.length; g++) {
    let cleared = 0;
    for (let k = 0; k < groups[g]; k++, at++) {
      if (next[at] === 0) {
        next[at] = 1;
        opened = true;
      } else if (next[at] === 2) cleared++;
    }
    if (cleared < Math.trunc((groups[g] + 1) / 2)) break;
  }
  const leveled = withMaster(data, { ...player, level: player.level + 1 });
  const rewarded = addItem(data, leveled, selected < REWARD_MAPS ? data.rewards[selected] : -1);
  const scene = mode === 2 || g < 1 || g > 5 || !opened ? (selected === 0x1a ? 5 : g < groups.length ? -1 : 6) : g - 1;
  return { flags: next, scene, player: rewarded };
}

/**
 * vmv2.exe 0x004080ac·0x00408447: 시나리오에서 이긴(0x476b6c) 결과 창의 쪽 5. 진영 0을 레벨 + 1로 다시 계산(0x42dae0)하고, 레벨 + 1이 40이면 쪽 5가 없다.
 * 보상은 고른 맵의 아이템(0x42da6c, 맵 0~25 밖은 −1)
 */
export function resultLevelUp(data: Pick<ScenarioData, 'masters' | 'stats' | 'rewards'>, player: SideRecord, selected: number): { after: SideRecord; reward: number } | null {
  if (player.level + 1 >= MASTER_LEVELS) return null;
  return { after: withMaster(data, { ...player, level: player.level + 1 }), reward: selected < REWARD_MAPS ? data.rewards[selected] : -1 };
}

/** vmv2.exe 0x0041bd98(첫 칸, 날짜, 진영 통계 57칸): 시나리오 통계 59칸에 더한다(i32) */
export function accumulateStats(total: readonly number[], first: number, days: number, side: readonly number[]): number[] {
  if (total.length !== STATS_COUNT || side.length !== STATS_COUNT - 2) throw new RangeError(`통계 칸 수가 틀립니다: 시나리오 ${total.length}(${STATS_COUNT}), 진영 ${side.length}(${STATS_COUNT - 2})`);
  return total.map((t, k) => (t + (k === 0 ? first : k === 1 ? days : side[k - 2])) | 0);
}
