import { expect, it } from 'vitest';
import { cappedExp, damage, damageExp, fighterOf, readCombatTables, statusExp, statusMinutesOf } from '../../src/engine/rules/combat.ts';
import { lightPhase } from '../../src/engine/rules/light.ts';
import { workGrid } from '../../src/engine/rules/terrain.ts';
import { decodeState, unitOf } from '../../src/engine/state.ts';
import { readActions } from '../../src/formats/actionTable.ts';
import { openExeImage } from '../../src/formats/exeImage.ts';
import { loadMap, type ReadResource } from '../../src/formats/mapData.ts';
import { readLightBonus, readNatialTable } from '../../src/formats/natialTable.ts';
import { openVmDat } from '../../src/formats/vmFiles.ts';
import { readOriginal } from '../original.ts';
import { inflateBlock, readGolden } from './block.ts';

// 흔든 전투에서 원작 전투 계산 함수(0x410fda, 0x411484, 0x411556, 0x411425, 0x412ca0)를 직접 부른 결과. 재생성: pnpm oracle combat
interface Case {
  readonly args: {
    readonly map: number; readonly block: string; readonly attacker: number; readonly target: number;
    readonly action: number; readonly x: number; readonly y: number; readonly minutes: number; readonly gain: number;
  };
  readonly expected: { readonly damage: number; readonly damageExp: number; readonly statusExp: number; readonly statusMinutes: number; readonly cappedExp: number };
}
const golden = readGolden<Case>('combat');
const exe = openExeImage(readOriginal('vmv2.exe'));
const dat10 = openVmDat(10, readOriginal('DATA10.DAT'));
const read: ReadResource = (id) => dat10.read(id & 0xffff);
const tables = readCombatTables(exe);
const actions = readActions(exe);
const natials = readNatialTable(exe);
const lightBonus = readLightBonus(exe);

it('전투 계산이 원작과 같다(400가지: 공격·마법 34개, 방향, 속성, 지형, 밝기, 레벨)', () => {
  expect(golden).toHaveLength(400);
  // 경험치 분기(0x411484)가 픽스처에 있어야 한다: 네이티얼이 같은 진영을 회복(상한 안), 적을 쓰러뜨림(HP보다 큰 데미지)
  const branches = golden.map((c) => {
    const s = decodeState(inflateBlock(c.args.block));
    const attacker = unitOf(s, c.args.attacker);
    const target = unitOf(s, c.args.target);
    const natial = c.args.attacker >= 2;
    return {
      heal: natial && attacker.side === target.side && c.expected.damage < 0 && target.hp - c.expected.damage <= 10,
      kill: natial && attacker.side !== target.side && c.expected.damage > target.hp,
    };
  });
  expect(branches.filter((b) => b.heal).length).toBeGreaterThan(5);
  expect(branches.filter((b) => b.kill).length).toBeGreaterThan(5);
  for (const [k, c] of golden.entries()) {
    const map = loadMap(exe, read, c.args.map);
    const state = decodeState(inflateBlock(c.args.block));
    const light = lightPhase(state.timeOfDay, map.header);
    const attacker = fighterOf(state, natials, lightBonus, light, c.args.attacker);
    const target = fighterOf(state, natials, lightBonus, light, c.args.target);
    const action = actions[c.args.action];
    const dealt = damage(tables, map, workGrid(map, state), attacker, action, c.args.x, c.args.y, target);
    expect({
      damage: dealt,
      damageExp: damageExp(tables, attacker, target, dealt),
      statusExp: statusExp(tables, attacker, target, c.args.minutes),
      statusMinutes: statusMinutesOf(tables, attacker, action),
      cappedExp: cappedExp(attacker.exp, c.args.gain),
    }, `경우 ${k}`).toEqual(c.expected);
  }
});
