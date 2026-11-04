// 상태 블록(vmv2.exe 0x4cc810, 3,692바이트) ↔ GameState. 원작이 전투를 이어서 하는 데 쓰는 최소 상태다(re/state-map.md).
// 근거가 있는 필드만 이름을 붙이고, 나머지 바이트는 raw에 그대로 남겨 encodeState(decodeState(b))가 b와 같다.

export const STATE_SIZE = 0xe6c;
/** 유닛 0·1번은 마스터, 2번부터 네이티얼(원작 되살리기 0x40f696·0x40fc66 순서) */
export const MASTERS = 2;
/** 규칙 함수가 새 상태를 만들 때 쓰는 고칠 수 있는 사본 타입 */
export type Mutable<T> = { -readonly [K in keyof T]: T[K] };
export const UNIT_SLOTS = 50;
export const STONE_SLOTS = 128;
const TIME_LIMIT = 0x014;     // 포인터 0x5061d0
const SIDES = 0x018;          // 진영 레코드 192바이트 × 2
const SIDE_SIZE = 0xc0;
const NAME_SIZE = 0x14;
const TIME_OF_DAY = 0x2d8;
const TURN_STARTED = 0x2dc;   // 포인터 0x476b24
const UNITS = 0x2e0;          // 유닛 압축 레코드 36바이트 × 50
const UNIT_SIZE = 0x24;
const UNIT_COUNT = 0x9e8;
const SIDE_STATES = 0x9ec;    // 진영 상태 24바이트 × 2
const SIDE_STATE_SIZE = 0x18;
const STONES = 0xa1c;         // 마정석 3바이트 × 128
const STONE_COUNT = 0xb9c;
const WATER = 0xba0;          // 물높이, 물높이 단계, 물이 돌아올 때까지 남은 분
const ELAPSED = 0xbac;
const BATTLE_STATS = 0xbb0;   // 진영마다 i32 0x39개(결과 창 "Battle results window"의 통계)
const TIME_EXTENSIONS = 0xe64;
export const STAT_COUNT = 0x39;
/** 통계 칸: Used MP, 마스터 행동 Stand by·Attack, 마법 6칸(행동 10~15), 네이티얼 종류별 소환 24칸, 종류별 얻은 경험치 24칸(0x408826) */
export const STAT_USED_MP = 0;
export const STAT_STAND_BY = 1;
export const STAT_ATTACK = 2;
export const STAT_SUMMONS = 9; // + 종류(1~24) − 1 = 칸 8 + 종류
export const STAT_NATIAL_EXP = 33; // + 종류 − 1

export interface UnitRecord {
  readonly x: number;
  readonly y: number;
  /** +0x02 위치 객체 +0x0a: 바라보는 방향 0~5(서, 북서, 북동, 동, 남동, 남서). 마스터는 맵 +0x64·+0x70에서 시작한다 */
  readonly direction: number;
  /** +0x03 위치 객체 +0x0b: 방향 × 3 + 애니메이션 프레임(0~2). 프레임 부분은 걷기 연출·대기 애니메이션이 바꾸는 표시 값(0x417957, 0x412f6d) */
  readonly pose: number;
  /** +0x04 위치 객체 +0x12: 애니메이션 카운터(0·2·4·6, 표시 값) */
  readonly animation: number;
  /** +0x06 마스터 번호(마스터) 또는 네이티얼 종류 1~24 */
  readonly type: number;
  /** +0x08 진영 0·1 */
  readonly side: number;
  /** +0x09 소환 순번. MP가 모자라면 작은 순번부터 사라진다(0x4022d7) */
  readonly summonOrder: number;
  /** +0x0c 레벨 0~2 */
  readonly level: number;
  /** +0x10 HP. 소환·전투 시작 때 10 */
  readonly hp: number;
  /** +0x14 OA(다음 차례까지 남은 시간). 시간 진행(0x4022d7)이 경과 시간만큼 깎는다 */
  readonly oa: number;
  /** +0x18 유닛 +0x50: 상태 이상이 남은 분. 0보다 크면 시간 진행이 OA보다 먼저 깎고, 차례 선택은 OA에 더한다(0x4022d7, 0x4129fb) */
  readonly statusMinutes: number;
  /** +0x1c 유닛 +0x54: 경험치. 100을 넘으려 하면 줄여 더한다(0x412ca0) */
  readonly exp: number;
  /** +0x20 유닛 +0x58: 하위 3비트가 상태 이상(1·2·4 = 행동 표 +0x07 세부의 0·1·2, 0x40354b). statusMinutes가 다하면 지운다 */
  readonly status: number;
}

export interface SideRecord {
  /** +0x00 이름: NUL까지, 없으면 20바이트 전부. 바이트 하나가 문자 하나(0~255)다 */
  readonly name: string;
  /** +0x14 프리 모드 설정(0x42d473)은 1 */
  readonly standardName: number;
  /** +0x18 바이트: 마스터별 표 0x470710 값(0x42dae0). 마스터 유닛 +0x08로 간다 */
  readonly attackAction: number;
  /** +0x1c 마법 번호 목록(오름차순, 최대 6) — 0x42d966 */
  readonly spells: readonly number[];
  /** +0x38 소환할 수 있는 네이티얼 종류 목록(오름차순, 최대 24) — 0x42d7d0 */
  readonly natials: readonly number[];
  /** +0x9c 마스터 번호, +0xa0 레벨 0~39 */
  readonly master: number;
  readonly level: number;
  /** +0xa4~+0xbc 마스터 능력치 표 값(0x42dae0) */
  readonly maxMp: number;
  readonly attack: number;
  readonly defense: number;
  readonly magic: number;
  readonly magicDefense: number;
  readonly speed: number;
  readonly movement: number;
}

export interface SideState {
  /** +0x00 0 사람, 1 CPU(프리 모드 0x450ed7). 네트워크 대전은 0과 2를 바꿔 쓴다 */
  readonly controller: number;
  /** +0x04 현재 MP */
  readonly mp: number;
  /** +0x08 이 진영의 유닛 수(마스터 포함) */
  readonly unitCount: number;
  /** +0x0c 정각 MP 회복 배수 = 2 + 보유 마정석 수(0x401019, 0x4022d7) */
  readonly mpMultiplier: number;
  /** +0x10 정각마다 빠지는 유지 MP 합계 */
  readonly upkeep: number;
}

export interface Stone {
  readonly x: number;
  readonly y: number;
  /** 0 없음, 1 진영 0, 2 진영 1 */
  readonly owner: number;
}

export interface GameState {
  /** 원작 블록 그대로. 이름 붙인 필드는 encodeState가 덮어쓴다 */
  readonly raw: Uint8Array;
  /** +0x14 시간 제한 0 SHORT, 1 MIDDLE, 2 LONG, 3 없음(맵 정보 창 0x429db7) */
  readonly timeLimit: number;
  /** +0xe64 진영마다 남은 생각 시간 연장 횟수(0x4017a2가 0x45e108[시간 제한], 0x407926이 깎는다) */
  readonly timeExtensions: readonly [number, number];
  readonly sides: readonly [SideRecord, SideRecord];
  readonly sideStates: readonly [SideState, SideState];
  /** +0x2d8 하루 중 시각(분) */
  readonly timeOfDay: number;
  /** +0x2dc 차례 시작 지형 효과를 줬으면 1(0x40546d가 1, 행동 뒤 흐름 0x40623b가 다음 차례 전에 0) */
  readonly turnStarted: number;
  /** +0xbac 누적 시각(분, 0x22ce0으로 나눈 나머지) */
  readonly elapsedMinutes: number;
  /** +0xba0 물높이 −1·0·1. 시작은 0(0x4255bb) */
  readonly waterLevel: number;
  /** +0xba4 물높이 단계 0·1·2(물높이 −1·0·1, 0x42562e). 시간 진행은 이 값으로 물을 되돌린다(0x425755) */
  readonly waterStage: number;
  /** +0xba8 물이 보통으로 돌아올 때까지 남은 분(물높이가 0이 아니면 120에서 시작) */
  readonly waterMinutes: number;
  /** +0xbb0 + 진영 × 0xe4: 결과 창 통계 i32 0x39개(STAT_* 칸). 0x407c39가 0으로 두고 0x406d13·0x4022d7·0x40623b가 더한다 */
  readonly stats: readonly [readonly number[], readonly number[]];
  /** 실행 중 유닛 표(0x478e10) 순서. 사라진 네이티얼 칸은 null로 남고 소환이 첫 빈 칸을 다시 쓴다(0x40f47e). 블록에는 빈 칸 없이 담긴다(0x4071ea) */
  readonly units: readonly (UnitRecord | null)[];
  readonly stones: readonly Stone[];
}

/** units[index]의 유닛. 빈 칸이면 예외 */
export function unitOf(state: Pick<GameState, 'units'>, index: number): UnitRecord {
  const u = state.units[index];
  if (!u) throw new Error(`유닛 표 ${index}번 칸이 비었습니다`);
  return u;
}

function readList(v: DataView, at: number, max: number, label: string): number[] {
  const count = v.getInt32(at, true);
  if (count < 0 || count > max) throw new Error(`${label} 목록 개수가 범위 밖입니다(0~${max}): ${count}`);
  return Array.from({ length: count }, (_, i) => v.getInt32(at + 4 + i * 4, true));
}

function writeList(v: DataView, at: number, max: number, list: readonly number[]): void {
  if (list.length > max) throw new Error(`목록이 너무 깁니다(최대 ${max}): ${list.length}`);
  v.setInt32(at, list.length, true);
  list.forEach((n, i) => v.setInt32(at + 4 + i * 4, n, true));
}

export function decodeState(block: Uint8Array): GameState {
  if (block.length !== STATE_SIZE) throw new Error(`상태 블록 크기가 ${STATE_SIZE}바이트가 아닙니다: ${block.length}`);
  const raw = new Uint8Array(block);
  const v = new DataView(raw.buffer);
  const u8 = (o: number) => raw[o];
  const i32 = (o: number) => v.getInt32(o, true);
  const side = (s: number): SideRecord => {
    const at = SIDES + s * SIDE_SIZE;
    const nameBytes = raw.subarray(at, at + NAME_SIZE);
    const end = nameBytes.indexOf(0);
    return {
      name: String.fromCharCode(...(end < 0 ? nameBytes : nameBytes.subarray(0, end))),
      standardName: i32(at + 0x14),
      attackAction: u8(at + 0x18),
      spells: readList(v, at + 0x1c, 6, `진영 ${s} 마법`),
      natials: readList(v, at + 0x38, 24, `진영 ${s} 네이티얼`),
      master: i32(at + 0x9c),
      level: i32(at + 0xa0),
      maxMp: i32(at + 0xa4),
      attack: i32(at + 0xa8),
      defense: i32(at + 0xac),
      magic: i32(at + 0xb0),
      magicDefense: i32(at + 0xb4),
      speed: i32(at + 0xb8),
      movement: i32(at + 0xbc),
    };
  };
  const sideState = (s: number): SideState => {
    const at = SIDE_STATES + s * SIDE_STATE_SIZE;
    return { controller: i32(at), mp: i32(at + 4), unitCount: i32(at + 8), mpMultiplier: i32(at + 0xc), upkeep: i32(at + 0x10) };
  };
  const unitCount = i32(UNIT_COUNT);
  if (unitCount < 0 || unitCount > UNIT_SLOTS) throw new Error(`유닛 수가 범위 밖입니다(0~${UNIT_SLOTS}): ${unitCount}`);
  const units = Array.from({ length: unitCount }, (_, n): UnitRecord => {
    const at = UNITS + n * UNIT_SIZE;
    return {
      x: u8(at),
      y: u8(at + 1),
      direction: u8(at + 2),
      pose: u8(at + 3),
      animation: u8(at + 4),
      type: v.getUint16(at + 6, true),
      side: u8(at + 8),
      summonOrder: u8(at + 9),
      level: i32(at + 0xc),
      hp: i32(at + 0x10),
      oa: i32(at + 0x14),
      statusMinutes: i32(at + 0x18),
      exp: i32(at + 0x1c),
      status: v.getUint16(at + 0x20, true),
    };
  });
  const stoneCount = i32(STONE_COUNT);
  if (stoneCount < 0 || stoneCount > STONE_SLOTS) throw new Error(`마정석 수가 범위 밖입니다(0~${STONE_SLOTS}): ${stoneCount}`);
  const stones = Array.from({ length: stoneCount }, (_, n): Stone => {
    const at = STONES + n * 3;
    return { x: u8(at), y: u8(at + 1), owner: u8(at + 2) };
  });
  return {
    raw,
    timeLimit: i32(TIME_LIMIT),
    timeExtensions: [i32(TIME_EXTENSIONS), i32(TIME_EXTENSIONS + 4)],
    sides: [side(0), side(1)],
    sideStates: [sideState(0), sideState(1)],
    timeOfDay: i32(TIME_OF_DAY),
    turnStarted: i32(TURN_STARTED),
    elapsedMinutes: i32(ELAPSED),
    waterLevel: i32(WATER),
    waterStage: i32(WATER + 4),
    waterMinutes: i32(WATER + 8),
    stats: [0, 1].map((n) => Array.from({ length: STAT_COUNT }, (_, k) => i32(BATTLE_STATS + (n * STAT_COUNT + k) * 4))) as [number[], number[]],
    units,
    stones,
  };
}

/** 바이트·u16 칸에 들어가는 정수인지 확인한다(넘으면 잘려 다른 값이 된다) */
function fits(value: number, max: number, label: string): number {
  if (!Number.isInteger(value) || value < 0 || value > max) throw new RangeError(`${label}이 칸(0~${max})을 넘습니다: ${value}`);
  return value;
}

export function encodeState(state: GameState): Uint8Array<ArrayBuffer> {
  if (state.raw.length !== STATE_SIZE) throw new Error(`상태 블록 크기가 ${STATE_SIZE}바이트가 아닙니다: ${state.raw.length}`);
  const units = state.units.filter((u) => u !== null);
  if (units.length > UNIT_SLOTS) throw new Error(`유닛이 너무 많습니다(최대 ${UNIT_SLOTS}): ${units.length}`);
  if (state.stones.length > STONE_SLOTS) throw new Error(`마정석이 너무 많습니다(최대 ${STONE_SLOTS}): ${state.stones.length}`);
  const out = new Uint8Array(state.raw);
  const v = new DataView(out.buffer);
  state.sides.forEach((s, n) => {
    const at = SIDES + n * SIDE_SIZE;
    if (s.name.length > NAME_SIZE) throw new Error(`진영 이름이 너무 깁니다(최대 ${NAME_SIZE}바이트): ${s.name}`);
    // 원작처럼 strcpy: 이름과 NUL만 쓰고 그 뒤 바이트는 남긴다(20바이트를 다 채우면 NUL 없음)
    for (let i = 0; i < s.name.length; i++) {
      const code = s.name.charCodeAt(i);
      if (code > 0xff || code === 0) throw new Error(`진영 이름에 쓸 수 없는 문자: ${s.name}`);
      out[at + i] = code;
    }
    if (s.name.length < NAME_SIZE) out[at + s.name.length] = 0;
    v.setInt32(at + 0x14, s.standardName, true);
    out[at + 0x18] = fits(s.attackAction, 0xff, `진영 ${n} attackAction`);
    writeList(v, at + 0x1c, 6, s.spells);
    writeList(v, at + 0x38, 24, s.natials);
    [s.master, s.level, s.maxMp, s.attack, s.defense, s.magic, s.magicDefense, s.speed, s.movement].forEach((x, k) =>
      v.setInt32(at + 0x9c + k * 4, x, true),
    );
  });
  state.sideStates.forEach((s, n) => {
    const at = SIDE_STATES + n * SIDE_STATE_SIZE;
    [s.controller, s.mp, s.unitCount, s.mpMultiplier, s.upkeep].forEach((x, k) => v.setInt32(at + k * 4, x, true));
  });
  v.setInt32(TIME_LIMIT, state.timeLimit, true);
  state.timeExtensions.forEach((x, k) => v.setInt32(TIME_EXTENSIONS + k * 4, x, true));
  v.setInt32(TIME_OF_DAY, state.timeOfDay, true);
  v.setInt32(TURN_STARTED, state.turnStarted, true);
  v.setInt32(ELAPSED, state.elapsedMinutes, true);
  [state.waterLevel, state.waterStage, state.waterMinutes].forEach((x, k) => v.setInt32(WATER + k * 4, x, true));
  state.stats.forEach((list, n) => {
    if (list.length !== STAT_COUNT) throw new Error(`통계 칸이 ${STAT_COUNT}개가 아닙니다: ${list.length}`);
    list.forEach((x, k) => v.setInt32(BATTLE_STATS + (n * STAT_COUNT + k) * 4, x, true));
  });
  v.setInt32(UNIT_COUNT, units.length, true);
  units.forEach((u, n) => {
    const at = UNITS + n * UNIT_SIZE;
    const label = (field: string) => `유닛 ${n} ${field}`;
    out[at] = fits(u.x, 0xff, label('x'));
    out[at + 1] = fits(u.y, 0xff, label('y'));
    out[at + 2] = fits(u.direction, 0xff, label('direction'));
    out[at + 3] = fits(u.pose, 0xff, label('pose'));
    out[at + 4] = fits(u.animation, 0xff, label('animation'));
    v.setUint16(at + 6, fits(u.type, 0xffff, label('type')), true);
    out[at + 8] = fits(u.side, 0xff, label('side'));
    out[at + 9] = fits(u.summonOrder, 0xff, label('summonOrder'));
    v.setInt32(at + 0xc, u.level, true);
    v.setInt32(at + 0x10, u.hp, true);
    v.setInt32(at + 0x14, u.oa, true);
    v.setInt32(at + 0x18, u.statusMinutes, true);
    v.setInt32(at + 0x1c, u.exp, true);
    v.setUint16(at + 0x20, fits(u.status, 0xffff, label('status')), true);
  });
  v.setInt32(STONE_COUNT, state.stones.length, true);
  state.stones.forEach((s, n) => {
    out[STONES + n * 3] = fits(s.x, 0xff, `마정석 ${n} x`);
    out[STONES + n * 3 + 1] = fits(s.y, 0xff, `마정석 ${n} y`);
    out[STONES + n * 3 + 2] = fits(s.owner, 0xff, `마정석 ${n} owner`);
  });
  return out;
}
