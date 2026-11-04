import { expect, it } from 'vitest';
import { nextActor } from '../../src/engine/rules/turn.ts';
import { decodeState, type GameState } from '../../src/engine/state.ts';
import { SKY_START } from '../../src/ui/battle/field.ts';
import { readDescriptions } from '../../src/formats/descriptions.ts';
import { cursorStatus, drawnState, overlayOf, type Phase, type Session, startInput, statusOf } from '../../src/ui/battle/session.ts';
import { battleColors, drawBattle, loadBattleArt } from '../../src/ui/battle/screen.ts';
import { decodeSprite } from '../../src/ui/battle/sprites.ts';
import { Stage } from '../../src/ui/battle/stage.ts';
import { inflateBlock, readGolden } from '../engine/block.ts';
import { engineData } from './engineData.ts';
import { crcRows, differentRows, exe, mapOf, read } from './screenCases.ts';

type Cell2 = readonly [number, number] | null;
interface RangeScene {
  readonly args: { readonly unit: number | null; readonly phase: number; readonly look: Cell2; readonly aim: Cell2; readonly placed: Cell2 };
  readonly expected: { readonly field: readonly number[]; readonly pool: readonly string[]; readonly dim: string; readonly dib: string; readonly text: number | null };
}
interface RangeCase {
  readonly label: string;
  readonly map: number;
  readonly block: string;
  readonly cursor: readonly [number, number];
  readonly scenes: readonly RangeScene[];
}
const cases = readGolden<RangeCase>('rangeView');
const cell = (c: Cell2) => (c ? { x: c[0], y: c[1] } : null);
const texts = readDescriptions(exe);

// 생성기처럼 원작 UI 길: 단계 1 → 유닛 오른쪽 누름(단계 7) → 범위 보기 → … → 단계 7 오른쪽 누름(단계 1). 0x476b88·0x476b18은 장면을 넘어 남는다
function sessionOf(state: GameState, actor: number, c: RangeCase, s: RangeScene['args']): Session {
  const base: Session = { ...startInput({ state, actor }), cursor: { x: c.cursor[0], y: c.cursor[1] } };
  if (s.phase === 1) return base;
  return { ...base, phase: s.phase as Phase, selected: s.unit, look: cell(s.look), aim: cell(s.aim), placed: cell(s.placed), cursorOn: s.phase !== 7 };
}

it('범위 보기 장면마다 어둡게 할 칸·유닛, 상태 줄 문구, 원작 풀·화면·색 표가 같다(단계 7·8~0x14, 가상 배치)', () => {
  const wrong: string[] = [];
  const seen = new Set<number>();
  let placedScenes = 0;
  for (const c of cases) {
    const map = mapOf(c.map);
    const data = engineData(map);
    const art = loadBattleArt(exe, read, map);
    const state = decodeState(inflateBlock(c.block));
    const actor = nextActor(state).actor;
    const stage = new Stage(art, state);
    const first = sessionOf(state, actor, c, { unit: null, phase: 1, look: null, aim: null, placed: null });
    stage.startTurn(first.cursor!);
    stage.show(state, overlayOf(data, first, 0), first.cursor, true);
    let shade: 'black' | 'dark' = 'black';
    c.scenes.forEach((sc, i) => {
      const label = `${c.label} 장면 ${i}(단계 0x${sc.args.phase.toString(16)}, 유닛 ${sc.args.unit}${sc.args.placed ? ` 배치 ${sc.args.placed}` : ''})`;
      seen.add(sc.args.phase);
      if (sc.args.placed) placedScenes++;
      const s = sessionOf(state, actor, c, sc.args);
      const drawn = drawnState(s);
      const overlay = overlayOf(data, s, 0);
      if (sc.args.phase >= 8) {
        shade = 'dark'; // 0x43d3a6 → 0x4027e3
        const bits = Buffer.from(sc.expected.dim, 'hex');
        const want = Array.from({ length: 1024 }, (_, k) => (bits[k >> 3] >> (k & 7)) & 1);
        if (JSON.stringify(Array.from(overlay.dimCells ?? new Uint8Array(1024))) !== JSON.stringify(want)) {
          const diff = want.flatMap((w, k) => (w !== (overlay.dimCells?.[k] ?? 0) ? [`(${k & 31},${k >> 5})${w ? '어둠' : '보임'}`] : []));
          wrong.push(`${label}: 칸 ${diff.length}개 ${diff.slice(0, 6)}`);
        }
        const dimmed = drawn.units.flatMap((u, k) => (u && decodeSprite(Buffer.from(sc.expected.pool[k], 'hex')).tint & 1 ? [k] : []));
        if (JSON.stringify([...overlay.dimUnits].sort((a, b) => a - b)) !== JSON.stringify(dimmed)) wrong.push(`${label}: 유닛 ${[...overlay.dimUnits]}/${dimmed}`);
        if (statusOf(data, s) !== sc.expected.text) wrong.push(`${label}: 문구 ${statusOf(data, s)?.toString(16)}/${sc.expected.text?.toString(16)}`);
      }
      if (sc.args.phase === 7 && cursorStatus(data, texts, s) !== exe.cString(sc.expected.text!)) wrong.push(`${label}: 유닛 설명`);
      stage.show(drawn, overlay, s.cursor, s.cursorOn);
      const pool = sc.expected.pool.map((hex) => decodeSprite(Buffer.from(hex, 'hex')));
      if (JSON.stringify(stage.pool.map((p) => ({ ...p }))) !== JSON.stringify(pool)) {
        const k = pool.findIndex((p, j) => JSON.stringify({ ...stage.pool[j] }) !== JSON.stringify(p));
        wrong.push(`${label}: 풀 칸 ${k} ${JSON.stringify({ ...stage.pool[k] })} / ${JSON.stringify(pool[k])}`);
      }
      const rows = differentRows(crcRows(drawBattle(art, drawn, { water: 0, sky: SKY_START }, { ...overlay, cursor: stage.cursorView() }, stage.pool)), sc.expected.field);
      if (rows.length) wrong.push(`${label}: 칩 줄 ${rows.slice(0, 5)}`);
      if (Buffer.from(battleColors(art, state, shade).subarray(40, 246 * 4)).toString('hex') !== sc.expected.dib) wrong.push(`${label}: 색 표(${shade})`);
    });
  }
  expect(wrong.slice(0, 30)).toEqual([]);
  expect([...seen].sort((a, b) => a - b)).toEqual([1, 7, 8, 9, 0xa, 0xb, 0xc, 0xd, 0xe, 0xf, 0x10, 0x11, 0x12, 0x13, 0x14]);
  expect(placedScenes).toBeGreaterThan(10);
}, 300_000);
