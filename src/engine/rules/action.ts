// 행동(공격·마법)의 대상. vmv2.exe 0x00405d18(행동을 고른 뒤: 범위 종류 4·5는 자기 칸), 0x0040416f(대상 칸 고르기: 효과 반경 0이면
// 0x410e3d를 통과한 유닛 칸, 있으면 사거리 안 칸), 그리고 연출 스크립트의 둘레 타격(0x414939 0x2e·0x2f).
import type { Action } from '../../formats/actionTable.ts';
import type { TerrainTables } from '../../formats/terrainTable.ts';
import type { Cell } from '../command.ts';
import { unitOf } from '../state.ts';
import { type Ground, inRange } from './range.ts';
import { GRID, step } from './terrain.ts';

const HEAL = 1;
const CURE = 3;
const SELF_AREA = 4; // 범위 종류 4: 자기 칸 둘레(0x41074b는 늘 거짓)
const SELF = 5; // 범위 종류 5: 자기 칸, 대상을 고르지 않는다

// vmv2.exe 0x00410e3d: 회복·풀기는 같은 진영, 그 밖은 다른 진영 유닛이고 사거리(0x41074b) 안
export function canTarget(g: Ground, actor: number, action: Action, target: number): boolean {
  const self = unitOf(g.state, actor);
  const t = unitOf(g.state, target);
  const ally = action.kind === HEAL || action.kind === CURE;
  if (ally !== (self.side === t.side)) return false;
  return inRange(g, self.x, self.y, action, t.x, t.y);
}

/** 원작 UI가 고르게 하는 대상 칸(y 바깥, x 안쪽 순서) */
export function actionTargets(g: Ground, actor: number, action: Action): Cell[] {
  const self = unitOf(g.state, actor);
  if (action.rangeKind === SELF_AREA || action.rangeKind === SELF) return [{ x: self.x, y: self.y }];
  const cells: Cell[] = [];
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      if (action.areaRadius !== 0) {
        if (inRange(g, self.x, self.y, action, x, y)) cells.push({ x, y });
        continue;
      }
      const index = g.state.units.findIndex((u) => u && u.x === x && u.y === y);
      if (index >= 0 && canTarget(g, actor, action, index)) cells.push({ x, y });
    }
  }
  return cells;
}

// vmv2.exe 0x00414939 0x2e·0x2f: 대상 칸에서 거리 d인 고리. 방향 k = 0~5, j = d~1마다 k로 j걸음 뒤 (k + 1) % 6으로 d − j걸음(0x440dba, 격자 밖이면 버림)
export function ringCells(tables: TerrainTables, x: number, y: number, d: number): Cell[] {
  const walk = (from: Cell | null, dir: number, n: number) => {
    let c = from;
    for (let i = 0; i < n && c; i++) c = step(tables, c.x, c.y, dir);
    return c;
  };
  const cells: Cell[] = [];
  for (let k = 0; k < 6; k++) {
    for (let j = d; j > 0; j--) {
      const c = walk(walk({ x, y }, k, j), (k + 1) % 6, d - j);
      if (c) cells.push(c);
    }
  }
  return cells;
}
