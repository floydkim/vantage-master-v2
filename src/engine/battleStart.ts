// 프리 배틀 시작 상태. vmv2.exe 프리 모드 메뉴(0x450ed7)와 새 전투 시작(0x4017a2)에서 상태 블록을 바꾸는 단계를 같은 순서로 옮겼다.
// 진영 설정(0x42d473) → 맵 로드 → 마정석(0x401019) → 물높이(0x4255bb) → 진영 MP(0x40218f) → 마스터(0x40f521) → 시각(0x40224d).
// 원작은 이어서 첫 시간 진행(0x401b12 → 0x40536c: 가장 작은 OA만큼 0x4022d7)을 하는데, 그것은 시간 진행(계획 4)의 몫이라 여기서 멈춘다.
// 창·메뉴 구간(블록 +0x268~+0x2d3)은 ③ UI가 채운다.
import { type GameMap, MAP_COUNT } from '../formats/mapData.ts';
import type { MasterType } from '../formats/masterTable.ts';
import type { OaTables } from './rules/oaCost.ts';
import { oaCost } from './rules/oaCost.ts';
import { partByte } from './rules/terrain.ts';
import { type ScenarioWorld, writeScenario } from './scenario.ts';
import { type GameState, type SideRecord, type SideState, STAT_COUNT, STATE_SIZE, type Stone, type UnitRecord } from './state.ts';

export const FREE_MODE_LEVEL = 24;
const FREE_MODE_SPELLS = [10, 11, 12, 13, 14, 15];
const ALL_NATIALS = Array.from({ length: 24 }, (_, i) => i + 1);
const START_HP = 10;
const NEVER_MOVED_ACTION = 0;

export interface BattleData {
  readonly masters: readonly MasterType[];
  readonly oa: OaTables;
  /** 프리 모드 진영 이름(readFreeModeNames) */
  readonly names: readonly [string, string];
}

export interface SideChoice {
  readonly master: number;
  readonly level: number;
}

const DEFAULT_SIDES: readonly [SideChoice, SideChoice] = [
  { master: 0, level: FREE_MODE_LEVEL },
  { master: 1, level: FREE_MODE_LEVEL },
];

/** 월드 장면에서 정한 전투 설정: 진영 레코드 둘(마스터 정보 창·편집 대화 상자), 조종(진영 상태 +0x00: 0 사람, 1 CPU), 시간 제한(블록 +0x14: 0 SHORT, 1 MIDDLE, 2 LONG, 3 없음) */
export interface FreeBattleSetup {
  readonly sides: readonly [SideRecord, SideRecord];
  readonly controllers: readonly [number, number];
  readonly timeLimit: number;
  /** 시나리오면 블록의 시나리오 칸(+0x8·+0xc·+0x198·+0xd78). 전투 블록·이어 하기 저장에 그대로 남는다 */
  readonly scenario?: ScenarioWorld;
}

/** 0x45e108[시간 제한]: 진영마다 남은 연장 횟수(블록 +0xe64). UI의 시간 표(timeLimit.ts)가 exe에서 읽는 것과 같음을 시험이 확인 */
export const EXTENSIONS = [1, 3, 5, 0];
const ITEMS_NATIALS = 24; // 마스터 정보 아이템 0~23 = 네이티얼 1~24, 24~29 = 마법 10~15(0x468d60)

/** vmv2.exe 0x0042d762: 아이템 u를 진영 목록에서 빼거나(있으면) 오름차순으로 넣는다(없으면). 빈 목록도 된다 */
export function toggleItem(record: SideRecord, u: number): SideRecord {
  const natial = u < ITEMS_NATIALS;
  const n = natial ? u + 1 : u - ITEMS_NATIALS + 10;
  const list = natial ? record.natials : record.spells;
  const next = list.includes(n) ? list.filter((k) => k !== n) : [...list, n].sort((a, b) => a - b);
  return natial ? { ...record, natials: next } : { ...record, spells: next };
}

/** vmv2.exe 0x0042d473(+ 마스터 선택 0x42dae0): 프리 모드 기본 진영 레코드 둘 */
export function freeModeSides(data: Pick<BattleData, 'masters' | 'names'>, choices: readonly [SideChoice, SideChoice] = DEFAULT_SIDES): [SideRecord, SideRecord] {
  return [sideRecord(data, 0, choices[0]), sideRecord(data, 1, choices[1])];
}

// vmv2.exe 0x0042d473 + 0x0042dae0
function sideRecord(data: Pick<BattleData, 'masters' | 'names'>, side: number, choice: SideChoice): SideRecord {
  const master = data.masters[choice.master];
  const stats = master?.levels[choice.level];
  if (!master || !stats) throw new RangeError(`마스터 ${choice.master}·레벨 ${choice.level}이 표에 없습니다`);
  return {
    name: data.names[side],
    standardName: 1, // 이름이 마스터 기본 이름이다(편집 대화 상자 0x7d가 마스터를 바꾸면 이름도 따라 바뀜)
    attackAction: master.attackAction,
    spells: FREE_MODE_SPELLS,
    natials: ALL_NATIALS,
    master: choice.master,
    level: choice.level,
    ...stats,
  };
}

// 이름을 붙이지 않은 블록 값: 프리 모드 메뉴(0x450ed7·0x45102d)의 모드 셀과 맵 선택 플래그, 선택한 맵
export function freeModeBlock(selected: number): Uint8Array {
  const raw = new Uint8Array(STATE_SIZE);
  const v = new DataView(raw.buffer);
  v.setInt32(0x0c, 1, true); // *0x5061cc
  for (let i = 0; i < MAP_COUNT; i++) v.setInt32(0x198 + i * 4, 1, true); // 맵마다 선택할 수 있음(0x475b98)
  v.setInt32(0x2d4, selected, true); // 선택한 맵(*0x5061e8)
  return raw;
}

// vmv2.exe 0x00401019: 작업 격자를 행 우선으로 훑어 부품 +0x63의 0x80 비트가 선 칸을 마정석으로 모으고, 맵 +0x2c8의 초기 소유를 반영한다
function findStones(map: GameMap): { stones: Stone[]; owned: [number, number] } {
  const stones: { x: number; y: number; owner: number }[] = [];
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      if (partByte(map, map.grid[y * 32 + x], 0x63) & 0x80) stones.push({ x, y, owner: 0 });
    }
  }
  const owned: [number, number] = [0, 0];
  const v = new DataView(map.struct.buffer, map.struct.byteOffset, map.struct.byteLength);
  for (let at = 0x2c8; ; at += 12) {
    const missingEnd = () => new Error(`맵 ${map.index}의 마정석 초기 소유 목록에 끝 표시(−1)가 없습니다`);
    if (at + 4 > map.struct.length) throw missingEnd();
    if (v.getInt32(at, true) === -1) break;
    if (at + 12 > map.struct.length) throw missingEnd();
    const x = v.getInt32(at, true);
    const y = v.getInt32(at + 4, true);
    const owner = v.getInt32(at + 8, true);
    const stone = stones.find((s) => s.x === x && s.y === y);
    if (!stone) continue;
    if (owner !== 1 && owner !== 2) throw new Error(`맵 ${map.index}의 마정석 초기 소유 진영이 1·2가 아닙니다: ${owner}`);
    stone.owner = owner;
    owned[owner - 1]++;
  }
  return { stones, owned };
}

// vmv2.exe 0x0040f521: 맵 +0x5c(진영 0)·+0x68(진영 1)부터 x, y, 방향(i32)
function masterUnit(data: BattleData, map: GameMap, side: number, record: SideRecord): UnitRecord {
  const v = new DataView(map.struct.buffer, map.struct.byteOffset, map.struct.byteLength);
  const at = 0x5c + side * 0xc;
  const direction = v.getInt32(at + 8, true) & 0xff;
  return {
    x: v.getInt32(at, true) & 0xff,
    y: v.getInt32(at + 4, true) & 0xff,
    direction,
    pose: (direction * 3) & 0xff,
    animation: 0,
    type: record.master,
    side,
    summonOrder: side,
    level: 0,
    hp: START_HP,
    oa: oaCost(data.oa, record.speed, true, NEVER_MOVED_ACTION),
    statusMinutes: 0,
    exp: 0,
    status: 0,
  };
}

/** setup은 월드 장면의 설정(FreeBattleSetup), 또는 마스터·레벨만(기본 진영 레코드, 진영 0 사람·1 CPU, 시간 제한 없음) */
export function startFreeBattle(data: BattleData, map: GameMap, setup: FreeBattleSetup | readonly [SideChoice, SideChoice] = DEFAULT_SIDES): GameState {
  const full: FreeBattleSetup = 'sides' in setup ? setup : { sides: freeModeSides(data, setup), controllers: [0, 1], timeLimit: 3 };
  const sides: [SideRecord, SideRecord] = [full.sides[0], full.sides[1]];
  const { stones, owned } = findStones(map);
  const sideState = (side: number): SideState => ({
    controller: full.controllers[side], // 0 사람, 1 CPU (0x450ed7, 마스터 정보 창 0x42b502)
    mp: sides[side].maxMp,
    unitCount: 1,
    mpMultiplier: 2 + owned[side],
    upkeep: 0,
  });
  const extensions = EXTENSIONS[full.timeLimit];
  if (extensions === undefined) throw new RangeError(`시간 제한 범위 밖: ${full.timeLimit}`);
  const raw = freeModeBlock(map.index);
  if (full.scenario) writeScenario(raw, full.scenario);
  return {
    raw,
    timeLimit: full.timeLimit, // *0x5061d0: 월드 장면 맵 정보 창의 시간 제한(처음 3)
    timeExtensions: [extensions, extensions], // 0x4017a2: 두 진영 모두 0x45e108[시간 제한]
    sides,
    sideStates: [sideState(0), sideState(1)],
    timeOfDay: new DataView(map.struct.buffer, map.struct.byteOffset).getInt32(0x3c, true),
    elapsedMinutes: 0,
    turnStarted: 0, // 0x4017a2
    waterLevel: 0, // 0x4255bb
    waterStage: 1, // 물높이 0일 때 0x42562e가 두는 값
    waterMinutes: 0,
    stats: [new Array(STAT_COUNT).fill(0), new Array(STAT_COUNT).fill(0)], // 0x407c39
    units: [masterUnit(data, map, 0, sides[0]), masterUnit(data, map, 1, sides[1])],
    stones,
  };
}
