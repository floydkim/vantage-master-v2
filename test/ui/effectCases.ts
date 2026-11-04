import { isDeepStrictEqual } from 'node:util';
import { expect } from 'vitest';
import { apply } from '../../src/engine/apply.ts';
import type { Command } from '../../src/engine/command.ts';
import { nextActor } from '../../src/engine/rules/turn.ts';
import { decodeState, type GameState, unitOf } from '../../src/engine/state.ts';
import { SELF_RANGE, type StrikeRecord } from '../../src/engine/turn.ts';
import { NO_OVERLAY } from '../../src/ui/battle/overlay.ts';
import { battleColors, drawBattle, loadBattleArt } from '../../src/ui/battle/screen.ts';
import { actingState } from '../../src/ui/battle/attack.ts';
import { decodeSprite } from '../../src/ui/battle/sprites.ts';
import { Stage, walkSteps } from '../../src/ui/battle/stage.ts';
import { inflateBlock } from '../engine/block.ts';
import { engineData } from './engineData.ts';
import { SoundLog } from './soundCases.ts';
import { crcRows, differentRows, exe, mapOf, read } from './screenCases.ts';

export interface RawCommand {
  readonly to: readonly [number, number];
  readonly direction: number;
  readonly kind: number;
  readonly number: number;
  readonly target: readonly [number, number];
}
interface Tick {
  readonly pool: readonly string[];
  readonly b20: number;
  readonly ba8: number;
  readonly cursorFrame: number;
  readonly water: number;
  readonly hp: readonly (number | null)[];
  readonly dib: string | null;
  readonly field?: readonly number[];
}
export interface EffectCase {
  readonly label: string;
  readonly map: number;
  readonly block: string;
  readonly command: RawCommand;
  readonly strikes: readonly number[][];
  readonly ticks: readonly Tick[];
}
// 원작 생성기와 같은 차례: CPU 차례 표식 → 결정 처리(0x406573: 표식 지움·단계 0) → 걷기(제자리면 없음) → 0x4067b1(명령 방향, 대상 칸으로 커서 0x403c8e)
// → 0x406d13 → 공격·마법 연출(0x413820) → 연출이 다 끝난 틱에 행동 뒤 흐름(0x406045). 틱마다 풀·타이머·HP·색 표·화면·효과음을 원작과 비교
export function runEffect(c: EffectCase, kind: 'attack' | 'magic', wrong: string[]): void {
  {
    const map = mapOf(c.map);
    const data = engineData(map);
    const art = loadBattleArt(exe, read, map);
    const state = decodeState(inflateBlock(c.block));
    const actor = nextActor(state).actor;
    const a = unitOf(state, actor);
    const home = { x: a.x, y: a.y };
    const command: Command = { ...c.command, to: { x: c.command.to[0], y: c.command.to[1] }, target: { x: c.command.target[0], y: c.command.target[1] } };
    const { to } = command;
    const trace: StrikeRecord[] = [];
    expect(apply(data, state, command, 'received', trace).ok, c.label).toBe(true);
    const aim = data.actions[command.number].rangeKind === SELF_RANGE ? to : command.target;
    const moved: GameState = { ...state, units: state.units.map((u, i) => (i === actor ? { ...u!, x: to.x, y: to.y, direction: command.direction } : u)) };
    const hp = state.units.map((u) => (u ? u.hp : null));
    const acting = actingState(moved, trace);
    let drawn = moved;
    const hit = (r: StrikeRecord) => {
      if (r.special) {
        drawn = { ...drawn, ...r.special };
        r.special.units?.forEach((u, i) => u && (hp[i] = u.hp));
      } else if (r.unit !== null) hp[r.unit] = r.hp;
    };
    const stage = new Stage(art, state);
    stage.startTurn(home);
    stage.show(state, { ...NO_OVERLAY, turnMarker: { unit: actor, remote: false } }, home, false);
    stage.decide(state);
    let tick = 0;
    let done = -1;
    const attack = () => {
      const self = aim.x === to.x && aim.y === to.y;
      stage.show(moved, NO_OVERLAY, self ? stage.cursorCell : aim, false);
      stage.act(data, acting, actor, command.number, aim, trace, hit, () => (done = tick));
    };
    if (to.x === home.x && to.y === home.y) attack();
    else {
      const { steps, flying } = walkSteps(data, state, actor, to);
      stage.walk(actor, steps, flying, attack);
    }
    const sounds = new SoundLog();
    sounds.take(stage, -1);
    let dib = '';
    for (const before = wrong.length; tick < c.ticks.length && wrong.length < before + 6; tick++) {
      const t = c.ticks[tick];
      const where = `${c.label} 틱 ${tick}`;
      stage.tick();
      sounds.take(stage, tick);
      const want = t.pool.map((h) => decodeSprite(Buffer.from(h, 'hex')));
      if (stage.pool.length !== want.length) wrong.push(`${where}: 풀 ${stage.pool.length}칸, 원작 ${want.length}칸`);
      want.forEach((w, i) => {
        const ours = stage.pool[i] as unknown as Record<string, number> | undefined;
        if (!ours || isDeepStrictEqual({ ...ours }, w)) return;
        const keys = Object.keys(w).filter((k) => ours[k] !== (w as unknown as Record<string, number>)[k]);
        wrong.push(`${where} 칸 ${i}: ${keys.map((k) => `${k} ${ours[k]}/${(w as unknown as Record<string, number>)[k]}`).join(', ')}`);
      });
      const timer = [stage.b20, stage.ba8, stage.cursorFrame, stage.water];
      if (!isDeepStrictEqual(timer, [t.b20, t.ba8, t.cursorFrame, t.water])) wrong.push(`${where}: 타이머 ${timer}`);
      if (!isDeepStrictEqual(hp, t.hp)) wrong.push(`${where}: HP ${hp}/${t.hp}`);
      dib = t.dib ?? dib;
      const colors = Buffer.from(battleColors(art, drawn, stage.shade, stage.flash, stage.shadeTime).subarray(40, 246 * 4)).toString('hex');
      if (colors !== dib) wrong.push(`${where}: 색 표(${stage.shade})`);
      if (t.field) {
        const rows = differentRows(crcRows(drawBattle(art, drawn, { water: stage.water, sky: stage.sky }, { ...NO_OVERLAY, cursor: stage.cursorView() }, stage.pool)), t.field);
        if (rows.length) wrong.push(`${where}: 칩 줄 ${rows.slice(0, 5)}`);
      }
    }
    sounds.check(kind, c.label, wrong);
    if (done !== c.ticks.length - 1) wrong.push(`${c.label}: 끝 틱 ${done}, 원작 ${c.ticks.length - 1}`);
  }
}
