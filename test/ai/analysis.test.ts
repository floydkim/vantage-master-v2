import { expect, it } from 'vitest';
import { type AiWeight, analyzeSide, decideWeights, initialWeights, thinkWeights } from '../../src/ai/analysis.ts';
import { readCombatTables } from '../../src/engine/rules/combat.ts';
import { decodeState, type GameState } from '../../src/engine/state.ts';
import type { EngineData } from '../../src/engine/turn.ts';
import { readActionCosts, readActions, readActionScripts, readSpeedFactors } from '../../src/formats/actionTable.ts';
import { openExeImage } from '../../src/formats/exeImage.ts';
import { loadMap, type ReadResource } from '../../src/formats/mapData.ts';
import { readLightBonus, readNatialTable } from '../../src/formats/natialTable.ts';
import { readTerrainTables } from '../../src/formats/terrainTable.ts';
import { openVmDat } from '../../src/formats/vmFiles.ts';
import { inflateBlock, readGolden } from '../engine/block.ts';
import { readOriginal } from '../original.ts';

// 원작 CPU AI 분석 단계(0x44b207 진영마다, 0x445d57 생각 가중치, 0x446106 결정 가중치)를 오라클로 실행한 결과. 재생성: pnpm oracle ai_analysis
type Pair = readonly [number, number] | null;
interface Case {
  readonly args: { readonly map: number; readonly block: string; readonly holes: readonly number[]; readonly actor: number; readonly weights: readonly Pair[] };
  readonly expected: { readonly scores: readonly number[]; readonly threats: readonly number[]; readonly think: readonly Pair[]; readonly decide: readonly Pair[] };
}
const golden = readGolden<Case>('aiAnalysis');
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

const prepared = (c: Case): { data: EngineData; state: GameState } => {
  const decoded = decodeState(inflateBlock(c.args.block));
  const units = [...decoded.units];
  for (const i of c.args.holes) units.splice(i, 0, null);
  return { data: { ...base, map: loadMap(exe, read, c.args.map) }, state: { ...decoded, units } };
};

it('진영 분석과 생각·결정 가중치가 원작과 같다(300가지, 풀기 네이티얼에서 끝나는 반복 포함)', () => {
  expect(golden).toHaveLength(300);
  let stopped = 0;
  for (const [k, c] of golden.entries()) {
    const { data, state } = prepared(c);
    const sides = [analyzeSide(data, state, 0), analyzeSide(data, state, 1)];
    expect(sides.map((s) => s.score), `경우 ${k} 점수`).toEqual(c.expected.scores);
    expect(sides.map((s) => s.statusThreat), `경우 ${k} 상태 이상 위협`).toEqual(c.expected.threats);
    const think = thinkWeights(data, state, c.args.actor, c.args.weights.map(toWeight));
    expect(think.map(toPair), `경우 ${k} 생각 가중치`).toEqual(c.expected.think);
    expect(decideWeights(data, state, think).map(toPair), `경우 ${k} 결정 가중치`).toEqual(c.expected.decide);
    if (state.units.some((u, i) => u && i >= 2 && data.actions[data.natials[u.type - 1].magicAction].kind === 3)) stopped++;
  }
  expect(stopped).toBeGreaterThan(30);
});

it('처음 가중치는 소환·되살리기 값(네이티얼은 표 +0x4c 둘 다, 마스터는 +0x60 = 0x9c4)', () => {
  const { data, state } = prepared(golden[0]);
  const w = initialWeights(data, state);
  expect(w[0]).toEqual({ w60: 0x9c4, w64: 0 });
  const n = state.units.findIndex((u, i) => i >= 2 && u);
  const t = data.natials[state.units[n]!.type - 1];
  expect(w[n]).toEqual({ w60: t.aiWeight, w64: t.aiWeight });
});
