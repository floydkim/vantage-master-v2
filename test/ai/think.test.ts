import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import type { AiWeight } from '../../src/ai/analysis.ts';
import { type AiMemory, cpuCommand, initialMemory, type ThinkingPattern } from '../../src/ai/think.ts';
import type { AiData } from '../../src/ai/world.ts';
import { encodeCommand } from '../../src/engine/command.ts';
import { readCombatTables } from '../../src/engine/rules/combat.ts';
import { decodeState, type GameState } from '../../src/engine/state.ts';
import { readActionCosts, readActions, readActionScripts, readSpeedFactors } from '../../src/formats/actionTable.ts';
import { openExeImage } from '../../src/formats/exeImage.ts';
import { readMapAi } from '../../src/formats/mapAi.ts';
import { loadMap, type ReadResource } from '../../src/formats/mapData.ts';
import { readLightBonus, readNatialTable } from '../../src/formats/natialTable.ts';
import { readTerrainTables } from '../../src/formats/terrainTable.ts';
import { datFileName, openVmDat, type VmDat } from '../../src/formats/vmFiles.ts';
import { inflateBlock, readGolden } from '../engine/block.ts';
import { readOriginal } from '../original.ts';

// 원작이 CPU끼리 둔 프리 배틀에서 차례마다 원작 생각(0x445b20)의 명령과 AI 기억. 재생성: pnpm oracle ai_think
type Pair = readonly [number, number] | null;
interface Memory {
  /** 생각 전: 지난 생각 뒤 원작이 작업 버퍼 자리에 푼 리소스 [번호, 버퍼 시작에서 떨어진 바이트, 압축 여부] */
  readonly loads?: readonly (readonly [number, number, number])[];
  readonly seed: number;
  readonly weights: readonly Pair[];
  readonly arena: string;
}
interface Turn {
  readonly block: string;
  readonly holes: readonly number[];
  readonly actor: number;
  readonly before: Memory;
  readonly message: readonly [number, number];
  readonly after: Memory;
}
interface Case {
  /** masters가 있으면 전투 시작부터 둔 판, 없으면 값을 흔든 상태 */
  readonly args: { readonly map: number; readonly pattern?: ThinkingPattern; readonly masters?: readonly number[] };
  readonly expected: { readonly turns: readonly Turn[] };
}
const golden = readGolden<Case>('aiThink');
const exe = openExeImage(readOriginal('vmv2.exe'));
const dat10 = openVmDat(10, readOriginal('DATA10.DAT'));
const read: ReadResource = (id) => dat10.read(id & 0xffff);
const base = {
  natials: readNatialTable(exe),
  lightBonus: readLightBonus(exe),
  oa: { actionCosts: readActionCosts(exe), speedFactors: readSpeedFactors(exe) },
  terrain: readTerrainTables(exe),
  combat: readCombatTables(exe),
  actions: readActions(exe),
  scriptHits: () => [],
  actionScripts: readActionScripts(exe),
};
const toWeight = (p: Pair): AiWeight | null => (p ? { w60: p[0], w64: p[1] } : null);
const toPair = (w: AiWeight | null): Pair => (w ? [w.w60, w.w64] : null);
const sha = (a: Int32Array) => createHash('sha256').update(new Uint8Array(a.buffer, a.byteOffset, a.byteLength)).digest('hex');

const dats = new Map<number, VmDat>();
const resource = (id: number): Uint8Array => {
  const n = id >>> 16;
  let dat = dats.get(n);
  if (!dat) {
    dat = openVmDat(n, readOriginal(datFileName(n)));
    dats.set(n, dat);
  }
  return dat.read(id & 0xffff);
};

// 연출 그림 읽기(0x4222ef)가 작업 버퍼 자리에 푼 바이트를 덮어쓴다(버퍼 밖은 버림)
function applyLoads(arena: Int32Array, loads: Memory['loads']): void {
  const bytes = new Uint8Array(arena.buffer, arena.byteOffset, arena.byteLength);
  for (const [id, at] of loads ?? []) {
    const data = resource(id);
    const from = Math.max(0, -at);
    const to = Math.min(data.length, bytes.length - at);
    if (from < to) bytes.set(data.subarray(from, to), at + from);
  }
}

const stateOf = (t: Turn): GameState => {
  const decoded = decodeState(inflateBlock(t.block));
  const units = [...decoded.units];
  for (const i of t.holes) units.splice(i, 0, null);
  return { ...decoded, units };
};

it('CPU끼리 둔 판에서 차례마다 명령과 AI 기억(난수·가중치·작업 버퍼)이 원작과 같다', () => {
  expect(golden).toHaveLength(156);
  expect(golden.filter((c) => c.args.masters)).toHaveLength(6);
  for (const [g, c] of golden.entries()) {
    const data: AiData = { ...base, map: loadMap(exe, read, c.args.map), mapAi: readMapAi(dat10, c.args.map) };
    const first = c.expected.turns[0];
    const start = initialMemory(data, stateOf(first), first.before.seed);
    // 전투 시작부터 둔 판의 첫 차례 기억은 전투 시작 값(소환·되살리기 가중치, 맵 AI 자료)이다
    if (c.args.masters) expect(start.weights.map(toPair), `판 ${g} 처음 가중치`).toEqual(first.before.weights);
    let arena: Int32Array = start.arena;
    for (const [k, t] of c.expected.turns.entries()) {
      const where = `판 ${g} 차례 ${k}`;
      applyLoads(arena, t.before.loads);
      expect(sha(arena), `${where} 생각 전 작업 버퍼`).toBe(t.before.arena);
      const memory: AiMemory = { seed: t.before.seed, weights: t.before.weights.map(toWeight), arena };
      const out = cpuCommand(data, stateOf(t), t.actor, c.args.pattern ?? 'standard', memory);
      expect(encodeCommand(out.command), `${where} 명령`).toEqual(t.message);
      expect(out.memory.seed, `${where} 난수`).toBe(t.after.seed);
      expect(out.memory.weights.map(toPair), `${where} 가중치`).toEqual(t.after.weights);
      expect(sha(out.memory.arena), `${where} 작업 버퍼`).toBe(t.after.arena);
      arena = out.memory.arena;
    }
  }
}, 600_000);

it('살아 있는 유닛의 가중치가 기억에 없으면 오류(조용히 0으로 두지 않는다)', () => {
  const c = golden[0];
  const t = c.expected.turns[0];
  const data: AiData = { ...base, map: loadMap(exe, read, c.args.map), mapAi: readMapAi(dat10, c.args.map) };
  const state = stateOf(t);
  const weights = t.before.weights.map(toWeight);
  const missing = Math.max(...state.units.map((u, i) => (u ? i : -1)));
  weights[missing] = null;
  const memory: AiMemory = { seed: t.before.seed, weights, arena: data.mapAi.ints.slice() };
  expect(() => cpuCommand(data, state, t.actor, 'standard', memory)).toThrow(`유닛 표 ${missing}번 칸`);
});
