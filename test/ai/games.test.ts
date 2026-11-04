import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import type { AiWeight } from '../../src/ai/analysis.ts';
import { cpuTurn, playUntilHuman } from '../../src/ai/play.ts';
import { type AiMemory, initialMemory, type ThinkingPattern } from '../../src/ai/think.ts';
import type { AiData } from '../../src/ai/world.ts';
import { type SideChoice, startFreeBattle } from '../../src/engine/battleStart.ts';
import { encodeCommand } from '../../src/engine/command.ts';
import { readCombatTables } from '../../src/engine/rules/combat.ts';
import { encodeState, type SideState, unitOf } from '../../src/engine/state.ts';
import { startTurn, type TurnResult } from '../../src/engine/turn.ts';
import { readActionCosts, readActions, readActionScripts, readSpeedFactors } from '../../src/formats/actionTable.ts';
import { readHits } from '../../src/formats/effectScript.ts';
import { openExeImage } from '../../src/formats/exeImage.ts';
import { readMapAi } from '../../src/formats/mapAi.ts';
import { loadMap, type ReadResource } from '../../src/formats/mapData.ts';
import { readFreeModeNames, readMasterTable } from '../../src/formats/masterTable.ts';
import { readLightBonus, readNatialTable } from '../../src/formats/natialTable.ts';
import { readTerrainTables } from '../../src/formats/terrainTable.ts';
import { datFileName, openVmDat, type VmDat } from '../../src/formats/vmFiles.ts';
import { blockDifferences, inflateBlock, readGolden } from '../engine/block.ts';
import { readOriginal } from '../original.ts';

// CPU 생각 픽스처(aiThink)의 CPU끼리 둔 6판을 TS만으로 이어 둔다: startFreeBattle → (cpuCommand → apply) 반복. 차례마다 원작 블록·주체·
// 명령과 같은지, TS가 이어 간 AI 기억(가중치·작업 버퍼)이 원작 생각 전 기억과 같은지 본다. 난수 상태와 생각 사이 연출 그림 읽기는
// 원작 연출이 정하는 것이라(③b) 픽스처 값을 넣는다. 재생성: pnpm oracle ai_think
type Pair = readonly [number, number] | null;
interface Turn {
  readonly block: string;
  readonly holes: readonly number[];
  readonly actor: number;
  readonly before: { readonly loads: readonly (readonly [number, number, number])[]; readonly seed: number; readonly weights: readonly Pair[]; readonly arena: string };
  readonly message: readonly [number, number];
}
interface Case {
  readonly args: { readonly map: number; readonly pattern: ThinkingPattern; readonly masters?: readonly [number, number]; readonly levels?: readonly [number, number] };
  readonly expected: { readonly turns: readonly Turn[] };
}
const TURNS = 60;
const games = readGolden<Case>('aiThink').filter((c) => c.args.masters);
const exe = openExeImage(readOriginal('vmv2.exe'));
const dat10 = openVmDat(10, readOriginal('DATA10.DAT'));
const read: ReadResource = (id) => dat10.read(id & 0xffff);
const dat12 = openVmDat(12, readOriginal('DATA12.DAT'));
const scripts = Array.from({ length: 0x55 }, (_, n) => readHits(dat12.read(n)));
const base = {
  natials: readNatialTable(exe),
  lightBonus: readLightBonus(exe),
  oa: { actionCosts: readActionCosts(exe), speedFactors: readSpeedFactors(exe) },
  terrain: readTerrainTables(exe),
  combat: readCombatTables(exe),
  actions: readActions(exe),
  scriptHits: (n: number) => scripts[n],
  actionScripts: readActionScripts(exe),
};
const battle = { masters: readMasterTable(exe), oa: base.oa, names: readFreeModeNames(exe) };
const dataFor = (map: number): AiData => ({ ...base, map: loadMap(exe, read, map), mapAi: readMapAi(dat10, map) });
const toPair = (w: AiWeight | null): Pair => (w ? [w.w60, w.w64] : null);
const sha = (a: Int32Array) => createHash('sha256').update(new Uint8Array(a.buffer, a.byteOffset, a.byteLength)).digest('hex');
const dats = new Map<number, VmDat>();
const resource = (id: number): Uint8Array => {
  const n = id >>> 16;
  let dat = dats.get(n);
  if (!dat) dats.set(n, (dat = openVmDat(n, readOriginal(datFileName(n)))));
  return dat.read(id & 0xffff);
};
// 연출 그림 읽기(0x4222ef)가 작업 버퍼 자리에 푼 바이트를 덮어쓴다(버퍼 밖은 버림)
function applyLoads(arena: Int32Array, loads: Turn['before']['loads']): void {
  const bytes = new Uint8Array(arena.buffer, arena.byteOffset, arena.byteLength);
  for (const [id, at] of loads) {
    const data = resource(id);
    const from = Math.max(0, -at);
    const to = Math.min(data.length, bytes.length - at);
    if (from < to) bytes.set(data.subarray(from, to), at + from);
  }
}
/** 표시 애니메이션 값과 유닛 수 뒤 칸을 0으로(turns.test.ts와 같음) */
function comparable(block: Uint8Array): Uint8Array {
  const out = new Uint8Array(block);
  const count = new DataView(out.buffer).getInt32(0x9e8, true);
  for (let i = 0; i < count; i++) {
    const at = 0x2e0 + i * 0x24;
    out[at + 3] -= out[at + 3] % 3;
    out[at + 4] = 0;
  }
  out.fill(0, 0x2e0 + count * 0x24, 0x9e8);
  return out;
}
const start = (c: Case, controller: number): { data: AiData; result: TurnResult } => {
  const data = dataFor(c.args.map);
  const sides = [0, 1].map((n) => ({ master: c.args.masters![n], level: c.args.levels![n] })) as [SideChoice, SideChoice];
  const s = startFreeBattle(battle, data.map, sides);
  // 오라클은 차례를 진행하는 동안 두 진영을 제어 0으로 두고 생각만 직접 시킨다
  const state = { ...s, sideStates: s.sideStates.map((st) => ({ ...st, controller })) as [SideState, SideState] };
  return { data, result: startTurn(data, state) };
};

it('CPU끼리 둔 판을 TS가 시작부터 이어 두어 차례마다 블록·주체·명령·AI 기억이 원작과 같다(표준 4판, No Guard 2판)', () => {
  expect(games).toHaveLength(6);
  let summons = 0;
  for (const [g, c] of games.entries()) {
    let { data, result } = start(c, 0);
    const turns = c.expected.turns;
    let memory: AiMemory = initialMemory(data, result.state, turns[0].before.seed);
    for (const [k, t] of turns.entries()) {
      const where = `판 ${g} 차례 ${k}`;
      if ('winner' in result) throw new Error(`${where}: TS 전투가 먼저 끝났습니다`);
      expect(blockDifferences(comparable(encodeState(result.state)), comparable(inflateBlock(t.block))), `${where} 블록`).toEqual([]);
      expect(result.state.units.flatMap((u, i) => (u ? [] : [i])), `${where} 빈 칸`).toEqual(t.holes);
      expect(result.actor, `${where} 주체`).toBe(t.actor);
      applyLoads(memory.arena, t.before.loads);
      memory = { ...memory, seed: t.before.seed };
      expect(memory.weights.map(toPair), `${where} 가중치`).toEqual(t.before.weights);
      expect(sha(memory.arena), `${where} 작업 버퍼`).toBe(t.before.arena);
      const turn = cpuTurn(data, result, c.args.pattern, memory);
      expect(encodeCommand(turn.command), `${where} 명령`).toEqual(t.message);
      if (turn.command.kind === 2) summons++;
      result = turn.result;
      memory = turn.memory;
    }
    // 생성기는 전투가 끝나면 멈춘다: 차례가 모자라면 마지막 명령으로 끝났다
    if (turns.length < TURNS) expect('winner' in result, `판 ${g} 승패`).toBe(true);
  }
  expect(summons).toBeGreaterThan(20);
}, 600_000);

it('CPU 진영 차례만 두고 사람 진영 차례나 전투 끝에서 멈춘다', () => {
  const c = games[0];
  const { data, result } = start(c, 0);
  if ('winner' in result) throw new Error('첫 차례에 전투가 끝났습니다');
  const cpuSide = unitOf(result.state, result.actor).side; // 첫 차례 진영만 CPU로
  const state = { ...result.state, sideStates: result.state.sideStates.map((st, s) => ({ ...st, controller: s === cpuSide ? 1 : 0 })) as [SideState, SideState] };
  const memory = initialMemory(data, state, c.expected.turns[0].before.seed);
  const human = playUntilHuman(data, { state, actor: result.actor }, c.args.pattern, memory);
  expect(human.commands.length).toBeGreaterThan(0);
  if (!('winner' in human.result)) expect(unitOf(human.result.state, human.result.actor).side).toBe(1 - cpuSide);
  const none = playUntilHuman(data, human.result, c.args.pattern, human.memory);
  expect(none.commands).toEqual([]);
});
