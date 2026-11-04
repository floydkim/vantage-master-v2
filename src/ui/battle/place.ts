// 표시 객체 위치 도우미: 칩 좌표·칩 안 어긋남·그릴 높이와 3차원 픽셀 좌표 사이를 오간다. 연출(걷기·스크립트)이 이것으로 표시 객체를 옮긴다.
import { GRID, partByte } from '../../engine/rules/terrain.ts';
import type { GameMap } from '../../formats/mapData.ts';
import { placeSprite, type Sprite } from './sprites.ts';

export type MutableSprite = { -readonly [K in keyof Sprite]: Sprite[K] };

const s8 = (v: number) => (v << 24) >> 24;

/** vmv2.exe 0x00417542: 칸에 세운다(어긋남·들림 0, 그릴 높이 = 칸 높이) */
export function place(s: MutableSprite, map: GameMap, grid: Uint16Array): void {
  Object.assign(s, placeSprite(map, grid, s.x, s.y), { px: 0, py: 0, lift: 0 });
}

/** vmv2.exe 0x00417730: 3차원 좌표(x 오른쪽, y 아래, z 위) */
export function toWorld(s: Sprite): [number, number, number] {
  return [s.chipX * 0x18 + s.px, (s.chipY - 0x17 + s.level) * 0xc + s.lift, s.level * 0xc - s.py + s.lift];
}

/** vmv2.exe 0x004175dd: 3차원 좌표 → 칩 좌표·어긋남·그릴 높이. lift면 칸 높이 안쪽의 들림을 한 층 위로 올린다 */
export function fromWorld(s: MutableSprite, x: number, y: number, z: number, lift: boolean, map: GameMap, grid: Uint16Array): void {
  s.chipX = s8(((x + 0x1800) / 0x18) | 0);
  s.chipY = s8(((y - z + 0xd14) / 0xc) | 0);
  s.level = s8(((z + 0xc00) / 0xc) | 0);
  s.px = (x + 0x1800) % 0x18;
  s.py = (y - z + 0xd14) % 0xc;
  s.lift = (y + 0xc00) % 0xc;
  if (s.lift < s.py) s.level = s8(s.level + 1);
  const part = grid[s.y * GRID + s.x];
  if (s.level <= s.height && s.lift > 0 && lift && partByte(map, part, 0x60) <= partByte(map, part, 0x61)) {
    s.level = s8(s.level + 1);
    s.lift -= 0xc;
  }
}

/** vmv2.exe 0x00417795: 3차원으로 (dx, dy, dz)만큼 */
export function nudge(s: MutableSprite, dx: number, dy: number, dz: number, map: GameMap, grid: Uint16Array): void {
  const [x, y, z] = toWorld(s);
  fromWorld(s, x + dx, y + dy, z + dz, true, map, grid);
}

// x87 값을 0에서 멀어지게 반올림한 뒤 버림(±0.5 → __ftol)
const round = (v: number) => Math.trunc(v > 0 ? v + 0.5 : v - 0.5) | 0;

/** vmv2.exe 0x004177ee의 어긋남: 각(도)·거리. 원작 상수 3.14159·1.73205(0x45b410·0x45b3f8) */
export function polarOffset(angle: number, distance: number): [number, number] {
  const a = (angle * 3.14159) / 180;
  return [round(-Math.cos(a) * distance), round((-Math.sin(a) * distance) / 1.73205)];
}

/** vmv2.exe 0x004177ee: 각 방향으로 거리만큼(걷기는 다음 칸에서 지금 칸 쪽으로 음수 거리) */
export function polar(s: MutableSprite, angle: number, distance: number, map: GameMap, grid: Uint16Array): void {
  const [dx, dy] = polarOffset(angle, distance);
  nudge(s, dx, dy, 0, map, grid);
}
