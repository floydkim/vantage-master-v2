// CPU AI 시뮬레이션 세계. 원작 AI는 실행 중 상태(유닛 표 0x478e10, 위치 객체, 진영 상태, 시각, 물높이, 마정석, 작업 격자, 지형 그래프)를
// 직접 바꿔 가며 앞날을 두어 보고 0x44ba74(떠 두기)·0x44bb31(되돌리기)로 돌린다. 여기서는 그 상태를 원작 배치대로 고칠 수 있게 둔다.
import type { MapAi } from '../formats/mapAi.ts';
import type { Light } from '../formats/natialTable.ts';
import { lightPhase } from '../engine/rules/light.ts';
import { type Mover, type Occupant, RangeSearch } from '../engine/rules/movement.ts';
import { natialStats } from '../engine/rules/natialStats.ts';
import { cellHeights, GRID, partByte, STONE_PART_STEP, terrainGraph, workGrid } from '../engine/rules/terrain.ts';
import { type GameState, MASTERS, type SideRecord } from '../engine/state.ts';
import type { EngineData } from '../engine/turn.ts';
import type { AiWeight } from './analysis.ts';

/** CPU AI가 쓰는 자료: 엔진 자료와 맵별 AI 표(0x44c8c3) */
export interface AiData extends EngineData {
  readonly mapAi: MapAi;
}

const MASTER_MOVE_TYPE = 1; // 0x40f696
const MASTER_EXP_VALUE = 0x50;
const MOVE_TYPES = 5;

/** 실행 중 유닛 레코드(0x6c바이트)와 그 위치 객체 가운데 AI가 읽고 쓰는 값 */
export interface SimUnit {
  /** 플래그 0x4000: 네이티얼 */
  natial: boolean;
  /** 플래그 0x0001: 0x40fb43이 평가용으로 만든 네이티얼 */
  temp: boolean;
  /** +0x02 마스터 번호 또는 네이티얼 종류 */
  type: number;
  /** +0x04 */
  side: number;
  /** +0x05 속성 */
  element: number;
  /** +0x06 밝기 성향 */
  lightPreference: number;
  /** +0x08 공격 행동 */
  attackAction: number;
  /** +0x09 소환 순번 */
  summonOrder: number;
  /** +0x0c·+0x10 마법 목록 */
  spells: number[];
  /** +0x28 이동 타입 */
  moveType: number;
  /** +0x2c */
  level: number;
  /** +0x30 */
  hp: number;
  /** +0x34~+0x44 능력치 */
  attack: number;
  defense: number;
  magic: number;
  magicDefense: number;
  speed: number;
  /** +0x48 이동력 */
  movement: number;
  /** +0x4c */
  oa: number;
  /** +0x50 상태 이상 남은 분 */
  statusMinutes: number;
  /** +0x54 */
  exp: number;
  /** +0x58 하위 3비트가 상태 이상 */
  status: number;
  /** +0x5c 경험치 값 */
  expValue: number;
  /** +0x60·+0x64 AI 가중치 */
  w60: number;
  w64: number;
  /** 위치 객체 +0·+1·+8(높이)·+0x0a(방향) */
  x: number;
  y: number;
  height: number;
  direction: number;
}

export interface SimSideState {
  controller: number;
  mp: number;
  unitCount: number;
  mpMultiplier: number;
  upkeep: number;
}

export interface SimStone {
  readonly x: number;
  readonly y: number;
  owner: number;
}

interface Saved {
  readonly units: (SimUnit | null)[];
  readonly sideStates: SimSideState[];
  readonly time: number;
  readonly waterLevel: number;
  readonly waterStage: number;
  readonly waterMinutes: number;
  readonly stones: number[];
}

export class World {
  readonly data: AiData;
  readonly sides: readonly [SideRecord, SideRecord];
  /** 실행 중 유닛 표. 사라진 칸(플래그 0x8000)은 null. 길이가 쓰는 칸 수(0x47a398) */
  units: (SimUnit | null)[];
  /** 칸마다 레코드 하나(원작 포인터는 칸 주소라 되돌리거나 다시 써도 같은 레코드를 가리킨다) */
  private readonly records: SimUnit[] = [];
  sideStates: SimSideState[];
  /** 하루 중 시각(분, 0x476ad8가 가리키는 블록 +0x2d8) */
  time: number;
  waterLevel: number;
  waterStage: number;
  waterMinutes: number;
  readonly stones: SimStone[];
  /** 작업 격자(0x483560)와 칸 높이 */
  grid: Uint16Array;
  heights: Uint8Array;
  /** 이동 타입별 지형 그래프(0x49dfc0). 원작은 물높이가 바뀔 때만 다시 만든다(0x440210) */
  graphs: Uint8Array[];
  private saved: Saved | null = null;
  /** 지금 격자를 만든 물높이·마정석 소유(같으면 다시 만들어도 같은 격자) */
  private gridKey = '';

  constructor(data: AiData, state: GameState, weights: readonly (AiWeight | null)[]) {
    this.data = data;
    this.sides = state.sides;
    this.time = state.timeOfDay;
    this.waterLevel = state.waterLevel;
    this.waterStage = state.waterStage;
    this.waterMinutes = state.waterMinutes;
    this.stones = state.stones.map((s) => ({ ...s }));
    this.sideStates = state.sideStates.map((s) => ({ ...s }));
    this.grid = workGrid(data.map, this);
    this.heights = cellHeights(data.map, this.grid);
    this.gridKey = this.gridKeyOf();
    this.graphs = this.buildGraphs();
    const light = this.light();
    this.units = state.units.map((u, i) => {
      if (!u) return null;
      const w = weights[i] ?? { w60: 0, w64: 0 };
      const base = {
        temp: false,
        type: u.type,
        side: u.side,
        summonOrder: u.summonOrder,
        level: u.level,
        hp: u.hp,
        oa: u.oa,
        statusMinutes: u.statusMinutes,
        exp: u.exp,
        status: u.status,
        w60: w.w60,
        w64: w.w64,
        x: u.x,
        y: u.y,
        height: this.cellHeight(u.x, u.y),
        direction: u.direction,
      };
      if (i < MASTERS) {
        const s = state.sides[u.side];
        return {
          ...base,
          natial: false,
          element: 0,
          lightPreference: 0,
          attackAction: s.attackAction,
          spells: [...s.spells],
          moveType: MASTER_MOVE_TYPE,
          attack: s.attack,
          defense: s.defense,
          magic: s.magic,
          magicDefense: s.magicDefense,
          speed: s.speed,
          movement: s.movement,
          expValue: MASTER_EXP_VALUE,
        };
      }
      const unit = this.newNatial(u.type, u.side);
      Object.assign(unit, base, { natial: true });
      this.refreshStats(unit, light);
      return unit;
    });
    this.units.forEach((u, i) => {
      if (u) this.records[i] = u;
    });
  }

  light(): Light {
    return lightPhase(this.time, this.data.map.header);
  }

  cellHeight(x: number, y: number): number {
    return this.heights[y * GRID + x];
  }

  /** 칸의 작업 격자 부품 바이트 */
  part(x: number, y: number, offset: number): number {
    return partByte(this.data.map, this.grid[y * GRID + x], offset);
  }

  private buildGraphs(): Uint8Array[] {
    return Array.from({ length: MOVE_TYPES }, (_, t) => terrainGraph(this.data.terrain, this.data.map, this.grid, t));
  }

  /** 작업 격자를 물높이·마정석 소유로 다시 만든다(둘 다 그대로면 결과가 같아 건너뜀) (vmv2.exe 0x004071bd) */
  rebuildGrid(): void {
    const key = this.gridKeyOf();
    if (key === this.gridKey) return;
    this.gridKey = key;
    this.grid = workGrid(this.data.map, this);
    this.heights = cellHeights(this.data.map, this.grid);
  }

  /** 마정석 소유를 바꾸고 그 칸 작업 격자를 고친다(0x401401이 칸만 고치는 것과 같다) */
  setStoneOwner(stone: SimStone, owner: number): void {
    const c = stone.y * GRID + stone.x;
    this.grid[c] += (owner - stone.owner) * STONE_PART_STEP;
    this.heights[c] = partByte(this.data.map, this.grid[c], 0x61);
    stone.owner = owner;
    this.gridKey = this.gridKeyOf();
  }

  private gridKeyOf(): string {
    return `${this.waterLevel}:${this.stones.map((s) => s.owner).join('')}`;
  }

  /** vmv2.exe 0x00440210 */
  rebuildGraphs(): void {
    this.graphs = this.buildGraphs();
  }

  /** 위치 객체 높이를 지금 칸으로 (vmv2.exe 0x00417542) */
  updatePosition(u: SimUnit): void {
    u.height = this.cellHeight(u.x, u.y);
  }

  /** 모든 위치 객체 (vmv2.exe 0x00417bed) */
  refreshPositions(): void {
    for (const u of this.units) if (u) this.updatePosition(u);
  }

  /** 네이티얼 능력치를 레벨·밝기로 다시 구한다 (vmv2.exe 0x0040fe72) */
  refreshStats(u: SimUnit, light: Light = this.light()): void {
    const t = this.data.natials[u.type - 1];
    if (!t) throw new RangeError(`네이티얼 종류 ${u.type}이 표에 없습니다`);
    if (u.level !== 0 && u.level !== 1 && u.level !== 2) throw new RangeError(`네이티얼 레벨 범위 밖: ${u.level}`);
    const st = natialStats(t, u.level, light, this.data.lightBonus);
    u.attack = st.attack;
    u.defense = st.defense;
    u.magic = st.magic;
    u.magicDefense = st.magicDefense;
    u.speed = st.speed;
    u.expValue = st.expValue;
  }

  /** 네이티얼 레코드의 표 값(0x40f910·0x40fb43 공통 부분). 능력치는 refreshStats로 채운다 */
  newNatial(type: number, side: number): SimUnit {
    const t = this.data.natials[type - 1];
    if (!t) throw new RangeError(`네이티얼 종류 ${type}이 표에 없습니다`);
    return {
      natial: true,
      temp: false,
      type,
      side,
      element: t.element,
      lightPreference: t.lightPreference,
      attackAction: t.attackAction,
      summonOrder: 0,
      spells: t.magicAction ? [t.magicAction] : [],
      moveType: t.moveType,
      level: 0,
      hp: 10,
      attack: 0,
      defense: 0,
      magic: 0,
      magicDefense: 0,
      speed: 0,
      movement: t.movement,
      oa: 0,
      statusMinutes: 0,
      exp: 0,
      status: 0,
      expValue: 0,
      w60: t.aiWeight,
      w64: t.aiWeight,
      x: 0,
      y: 0,
      height: 0,
      direction: 0,
    };
  }

  /** 유닛 표의 첫 빈 칸, 없으면 끝(최대 51칸)에 u의 값을 두고 그 칸 레코드를 돌려준다 (vmv2.exe 0x0040f47e) */
  allocate(u: SimUnit): SimUnit {
    let i = this.units.indexOf(null);
    if (i < 0) {
      if (this.units.length >= 0x33) throw new Error('유닛 표가 가득 찼습니다(원작은 널 포인터를 씀)');
      i = this.units.length;
      this.units.push(null);
    }
    return this.place(i, u);
  }

  private place(i: number, u: SimUnit): SimUnit {
    const record = this.records[i];
    if (record) Object.assign(record, u, { spells: [...u.spells] });
    else this.records[i] = { ...u, spells: [...u.spells] };
    this.units[i] = this.records[i];
    return this.records[i];
  }

  /** 진영 마스터(진영 상태 +0x14) */
  master(side: number): SimUnit {
    for (let i = 0; i < MASTERS; i++) {
      const m = this.units[i];
      if (m && m.side === side) return m;
    }
    throw new Error(`진영 ${side}의 마스터가 없습니다`);
  }

  /** 칸에 선 첫 유닛 (vmv2.exe 0x0040ff5c) */
  unitAt(x: number, y: number): SimUnit | null {
    return this.units.find((u) => u && u.x === x && u.y === y) ?? null;
  }

  /** 이동 범위 탐색을 시작한다 (vmv2.exe 0x004404f7 + 0x00440567) */
  search(index: number): RangeSearch {
    const u = this.units[index];
    if (!u) throw new Error(`유닛 표 ${index}번 칸이 비었습니다`);
    const mover: Mover = { moveType: u.moveType, movement: u.movement };
    return new RangeSearch(this.data.terrain, this.graphs[u.moveType], this.heights, this.units as readonly (Occupant | null)[], index, mover);
  }

  /** vmv2.exe 0x0044ba74 */
  save(): void {
    this.saved = {
      units: this.units.map((u) => u && { ...u, spells: [...u.spells] }),
      sideStates: this.sideStates.map((s) => ({ ...s })),
      time: this.time,
      waterLevel: this.waterLevel,
      waterStage: this.waterStage,
      waterMinutes: this.waterMinutes,
      stones: this.stones.map((s) => s.owner),
    };
  }

  /** vmv2.exe 0x0044bb31: 작업 격자는 늘, 지형 그래프는 물높이가 바뀌었을 때만 다시 만든다 */
  restore(): void {
    const s = this.saved;
    if (!s) throw new Error('떠 둔 상태가 없습니다');
    this.time = s.time;
    this.units = s.units.map((u, i) => u && this.place(i, u));
    this.sideStates = s.sideStates.map((v) => ({ ...v }));
    const waterChanged = this.waterLevel !== s.waterLevel;
    if (waterChanged) this.stones.forEach((stone, i) => (stone.owner = s.stones[i]));
    else this.stones.forEach((stone, i) => stone.owner !== s.stones[i] && this.setStoneOwner(stone, s.stones[i]));
    this.waterLevel = s.waterLevel;
    this.waterStage = s.waterStage;
    this.waterMinutes = s.waterMinutes;
    this.rebuildGrid();
    if (waterChanged) this.rebuildGraphs();
  }

  /** 정각 MP 회복량(마스터 마력 × 회복 배수 − 유지 MP) */
  income(side: number): number {
    const st = this.sideStates[side];
    return Math.imul(this.master(side).magic, st.mpMultiplier) - st.upkeep;
  }
}
