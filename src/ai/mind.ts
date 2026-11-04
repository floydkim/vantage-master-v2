// CPU 생각 하나(vmv2.exe 0x00445b20)가 함께 쓰는 값: 시뮬레이션 세계, AI 작업 버퍼(0x43ff60), 생각마다 다시 채우는 AI 전역 표,
// C 런타임 난수(0x452ed9), 마지막 이동 범위(작업 버퍼 0x4c4bf0).
import type { Action } from '../formats/actionTable.ts';
import type { RangeSearch } from '../engine/rules/movement.ts';
import { CELL_SIZE, GRID } from '../engine/rules/terrain.ts';
import type { SimUnit, World } from './world.ts';

export const CELLS = GRID * GRID;
/** 분석 격자: 칸(y × 32 + x)마다 i32 10개 */
export const RECORD = 10;
/** 기록 칸: x, y, 합계 점수, 행동 점수, 앞날 점수, 종류, 방향, 번호, 대상 x, 대상 y */
export const X = 0;
export const Y = 1;
export const TOTAL = 2;
export const SCORE = 3;
export const AHEAD = 4;
export const KIND = 5;
export const DIRECTION = 6;
export const NUMBER = 7;
export const TARGET_X = 8;
export const TARGET_Y = 9;
/** 후보 목록(0x4cd898) = 버퍼 + 0x2800칸. 마스터 0x60개, 네이티얼 0x20개 */
export const CANDIDATES = CELLS * RECORD;
export const MASTER_CANDIDATES = 0x60;
export const NATIAL_CANDIDATES = 0x20;
/** 마법 칸마다 방향별 버퍼(0x4cf054[k]) i32 0x400개 */
export const SPELL_SLOTS = 6;
export const NONE = -2000000000;
const SIDE_TYPES = 25;
const RANKS = 24;

/** 부호 있는 2^k 나눗셈(원작 (x + ((x >> 31) & (2^k − 1))) >> k) */
export const sar = (x: number, k: number): number => ((x | 0) + (((x | 0) >> 31) & ((1 << k) - 1))) >> k;

export class Mind {
  readonly world: World;
  readonly arena: Int32Array;
  readonly actor: SimUnit;
  readonly actorIndex: number;
  /** 0x4cd898: 후보 목록 시작 칸 */
  readonly candidates = CANDIDATES;
  readonly candidateLimit: number;
  /** 0x475da0 */
  seed: number;
  /** 0x4ead64[진영] */
  readonly scores: readonly number[];
  /** 0x4cefe0[진영] = 상대 진영 점수 */
  readonly rivalScores: readonly number[];
  /** 0x4cefe8[진영] */
  readonly threats: readonly number[];
  /** 0x4cd854[진영]: 진영 네이티얼이 가진 마법 MP 합 */
  readonly spellMp = [0, 0];
  /** 0x4cd890[진영]: 지켜 둘 MP(가장 비싼 소환 + 마법 MP 합, 최대 MP까지) */
  readonly reserveMp = [0, 0];
  /** 0x4cd8c8[진영 × 25 + 종류]: 소환 값 */
  readonly summonValue = new Int32Array(2 * SIDE_TYPES);
  /** 0x4cd8b8·0x4cd8bc[진영]: 상대 유닛의 평균 2배 좌표(x × 2 + (y & 1), y × 2) */
  readonly rivalCenter = [
    { x: 0, y: 0 },
    { x: 0, y: 0 },
  ];
  /** 0x4cd990·0x4eaca4[진영 × 24 + 순위]: 소환 순위(종류, 값) */
  readonly rankType = new Int32Array(2 * RANKS);
  readonly rankValue = new Int32Array(2 * RANKS);
  /** 0x4cd89c[마법 칸]: 범위 마법의 가장 좋은 칸 값 */
  readonly areaBest = new Int32Array(SPELL_SLOTS);
  /** 0x4cd868: 결정 */
  readonly decision = new Int32Array(RECORD);
  /** 마지막 이동 범위(0x4c4bf0) */
  range: RangeSearch | null = null;

  constructor(world: World, arena: Int32Array, actorIndex: number, seed: number, scores: readonly number[], threats: readonly number[]) {
    this.world = world;
    this.arena = arena;
    this.actorIndex = actorIndex;
    const actor = world.units[actorIndex];
    if (!actor) throw new Error(`유닛 표 ${actorIndex}번 칸이 비었습니다`);
    this.actor = actor;
    this.candidateLimit = actor.natial ? NATIAL_CANDIDATES : MASTER_CANDIDATES;
    this.seed = seed;
    this.scores = scores;
    this.rivalScores = [scores[1], scores[0]];
    this.threats = threats;
  }

  /** vmv2.exe 0x00452ed9 */
  rand(): number {
    this.seed = (Math.imul(this.seed, 0x343fd) + 0x269ec3) >>> 0;
    return (this.seed >>> 16) & 0x7fff;
  }

  /** 마법 칸 k의 방향별 버퍼 시작 칸(0x445b20) */
  spellBuffer(k: number): number {
    return CANDIDATES + this.candidateLimit * RECORD + k * CELLS;
  }

  action(n: number): Action {
    const a = this.world.data.actions[n];
    if (!a) throw new RangeError(`행동 ${n}이 행동 표 밖입니다`);
    return a;
  }

  /** 마지막 이동 범위의 칸 바이트 */
  rangeByte(x: number, y: number, offset: number): number {
    if (!this.range) throw new Error('이동 범위를 아직 구하지 않았습니다');
    return this.range.w[(y * GRID + x) * CELL_SIZE + offset];
  }

  /** 진영 마스터의 유닛 표 칸(진영 상태 +0x14) */
  masterIndex(side: number): number {
    const m = this.world.master(side);
    return this.world.units.indexOf(m);
  }
}

/** 원작 i32 나눗셈(0으로 나누면 원작은 멈춘다) */
export function idiv(a: number, b: number): number {
  if (b === 0) throw new Error(`0으로 나눕니다(원작은 예외로 멈춤): ${a} / 0`);
  return ((a | 0) / (b | 0)) | 0;
}
