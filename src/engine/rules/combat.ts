// 전투 계산. vmv2.exe 0x00410fda(데미지), 0x00411484(데미지로 얻는 경험치), 0x00411556(상태 이상으로 얻는 경험치),
// 0x00411425(상태 이상 지속), 0x00412ca0(경험치 보정). 능력치는 실행 중 값이라 블록에서 다시 만든다(fighterOf).
import type { Action } from '../../formats/actionTable.ts';
import type { ExeImage } from '../../formats/exeImage.ts';
import type { GameMap } from '../../formats/mapData.ts';
import type { Light, NatialType } from '../../formats/natialTable.ts';
import { TERRAIN_KINDS } from '../../formats/terrainTable.ts';
import { type GameState, MASTERS, unitOf } from '../state.ts';
import { cdiv } from './cint.ts';
import { natialStats } from './natialStats.ts';
import { GRID, partByte } from './terrain.ts';

const MASTER_EXP_VALUE = 0x50; // 0x40f696
const ELEMENTS = 5;
const MAX_DAMAGE = 10;
const MAX_HP = 10;
export const EXP_LIMIT = 100;
const CURVE = 0x45f68c; // 데미지 곡선. 원작은 표 밖(앞의 상성 표, 뒤의 속도 계수 표)도 그대로 읽는다
const HEAL_CURVE = CURVE + 5 * 4; // 0x45f6a0
const STATUS_MINUTES = 0x45f7d0;
const DAMAGE_AFFINITY = 0x45f5d8; // [공격자 속성 × 5 + 대상 속성]
const EXP_AFFINITY = 0x45f84c;
const TERRAIN_DEFENSE = 0x45f268; // [지형] 백분율

export interface CombatTables {
  /** exe 주소의 i32 (곡선 표 밖을 읽는 원작 동작 그대로) */
  readonly i32At: (va: number) => number;
  readonly damageAffinity: readonly number[];
  readonly expAffinity: readonly number[];
  readonly terrainDefense: readonly number[];
}

export function readCombatTables(exe: ExeImage): CombatTables {
  const cache = new Map<number, number>(); // CPU AI가 같은 칸을 아주 여러 번 읽는다
  const i32At = (va: number) => {
    let v = cache.get(va);
    if (v === undefined) cache.set(va, (v = new DataView(exe.read(va, 4).buffer).getInt32(0, true)));
    return v;
  };
  const list = (va: number, n: number) => Array.from({ length: n }, (_, i) => i32At(va + i * 4));
  return {
    i32At,
    damageAffinity: list(DAMAGE_AFFINITY, ELEMENTS * ELEMENTS),
    expAffinity: list(EXP_AFFINITY, ELEMENTS * ELEMENTS),
    terrainDefense: list(TERRAIN_DEFENSE, TERRAIN_KINDS),
  };
}

/** 싸움에 쓰는 유닛 값(유닛 +0x34~+0x40 능력치, +5 속성, +0x5c 경험치 값)과 블록 값 */
export interface Fighter {
  readonly natial: boolean;
  readonly side: number;
  readonly x: number;
  readonly y: number;
  readonly direction: number;
  readonly hp: number;
  readonly exp: number;
  readonly statusMinutes: number;
  readonly attack: number;
  readonly defense: number;
  readonly magic: number;
  readonly magicDefense: number;
  readonly element: number;
  readonly expValue: number;
}

/** 네이티얼은 밝기에 따른 능력치(0x40fe72), 마스터는 진영 레코드 능력치(0x40f696)와 속성 0·경험치 값 0x50 */
export function fighterOf(
  state: GameState,
  natials: readonly NatialType[],
  lightBonus: readonly (readonly number[])[],
  light: Light,
  index: number,
): Fighter {
  const u = unitOf(state, index);
  const base = { side: u.side, x: u.x, y: u.y, direction: u.direction, hp: u.hp, exp: u.exp, statusMinutes: u.statusMinutes };
  if (index < MASTERS) {
    const s = state.sides[u.side];
    return { ...base, natial: false, attack: s.attack, defense: s.defense, magic: s.magic, magicDefense: s.magicDefense, element: 0, expValue: MASTER_EXP_VALUE };
  }
  const type = natials[u.type - 1];
  if (!type) throw new RangeError(`네이티얼 종류 ${u.type}이 표에 없습니다`);
  if (u.level !== 0 && u.level !== 1 && u.level !== 2) throw new RangeError(`네이티얼 레벨 범위 밖: ${u.level}`);
  const st = natialStats(type, u.level, light, lightBonus);
  return { ...base, natial: true, ...st, element: type.element };
}

// vmv2.exe 0x00410fda: 회복은 음수. (x, y)는 효과 반경이 있는 행동의 원점(지정 칸)
export function damage(
  tables: CombatTables,
  map: GameMap,
  grid: Uint16Array,
  attacker: Fighter,
  action: Action,
  x: number,
  y: number,
  target: Fighter,
): number {
  if (action.kind === 1) return -(tables.i32At(HEAL_CURVE + (attacker.magic + action.power) * 4) + 0x7f) >> 8;
  let d = action.sub === 0 ? attacker.attack - target.defense : attacker.magic - target.magicDefense;
  d += action.power + tables.damageAffinity[attacker.element * ELEMENTS + target.element];
  const ox = action.areaRadius === 0 ? attacker.x : x;
  const oy = action.areaRadius === 0 ? attacker.y : y;
  let dy = oy - target.y;
  let dx = (oy & 1) + ox * 2 - ((target.y & 1) + target.x * 2);
  let facing = target.direction;
  if (facing > 2) {
    facing -= 3;
    dx = -dx;
    dy = -dy;
  }
  // 대상이 바라보는 방향에 대한 원점의 자리: 원작 비교식 그대로
  if (facing === 0) {
    if (dx < dy * 3 || dx < dy * -3) {
      if (dx < 0) d += dx < dy * 3 && dx < dy * -3 ? 4 : 5;
      else d += 7;
    } else d += 8;
  } else if (facing === 1) {
    if (dx < 0 || dy * 3 < dx) {
      if (dx < dy * -3) d += dx < 0 && dy * 3 < dx ? 4 : 5;
      else d += 7;
    } else d += 8;
  } else if (facing === 2) {
    if (dx < dy * -3 || 0 < dx) {
      if (dy * 3 < dx) d += dx < dy * -3 && 0 < dx ? 4 : 5;
      else d += 7;
    } else d += 8;
  }
  const kind = partByte(map, grid[target.y * GRID + target.x], 0x62);
  if (kind >= TERRAIN_KINDS) throw new RangeError(`지형 종류 ${kind}가 지형 표 밖입니다`);
  const value = (cdiv(tables.i32At(CURVE + d * 4) * tables.terrainDefense[kind], 100) + 0x7f) >> 8;
  return Math.min(value, MAX_DAMAGE);
}

const expDivisor = (tables: CombatTables, attacker: Fighter, target: Fighter) =>
  attacker.expValue * tables.expAffinity[attacker.element * ELEMENTS + target.element];

// vmv2.exe 0x00411484: 네이티얼만 얻는다. 같은 진영은 회복량, 다른 진영은 데미지(쓰러뜨리면 남은 HP + 8)
export function damageExp(tables: CombatTables, attacker: Fighter, target: Fighter, dealt: number): number {
  if (!attacker.natial) return 0;
  let amount = dealt;
  let k: number;
  if (attacker.side === target.side) {
    if (dealt >= 0) return 0;
    k = 0x6c;
    amount = target.hp - dealt < MAX_HP + 1 ? -dealt : MAX_HP - target.hp;
  } else {
    k = 0x3c;
    if (target.hp === dealt || target.hp - dealt < 0) amount = target.hp + 8;
  }
  const div = expDivisor(tables, attacker, target);
  return cdiv(target.expValue * amount * k - 1 + div, div);
}

// vmv2.exe 0x00411556: 상태 이상을 건 시간(같은 진영이면 푼 시간)만큼
export function statusExp(tables: CombatTables, attacker: Fighter, target: Fighter, minutes: number): number {
  if (!attacker.natial) return 0;
  let v = minutes - target.statusMinutes;
  if (attacker.side === target.side) v = -v;
  const div = expDivisor(tables, attacker, target);
  return cdiv(target.expValue * v * 3 - 1 + div, div);
}

// vmv2.exe 0x00411425
export const statusMinutesOf = (tables: CombatTables, caster: Fighter, action: Action): number =>
  tables.i32At(STATUS_MINUTES + (caster.magic + action.power) * 4);

// vmv2.exe 0x00412ca0: 경험치가 100을 넘으려 하면 넘는 쪽을 반으로
export function cappedExp(current: number, gain: number): number {
  return current + gain > EXP_LIMIT ? cdiv(gain - current, 2) + 0x32 : gain;
}

export const MAX_LEVEL = 2;

// vmv2.exe 0x00412cc9: 경험치를 더하고 100마다 레벨 +1(능력치는 fighterOf가 레벨로 다시 만든다). 최대 레벨이면 100에서 멈춘다.
// 경험치 연출(0x4147f2 → 0x4167a4)은 2씩 나눠 부르지만 결과는 한 번에 더한 것과 같다.
export function addExp(state: GameState, index: number, amount: number): GameState {
  const u = unitOf(state, index);
  let exp = u.exp + amount;
  let level = u.level;
  while (exp >= EXP_LIMIT) {
    if (level >= MAX_LEVEL) {
      exp = EXP_LIMIT;
      break;
    }
    level++;
    exp -= EXP_LIMIT;
  }
  return { ...state, units: state.units.map((v, i) => (i === index ? { ...u, exp, level } : v)) };
}
