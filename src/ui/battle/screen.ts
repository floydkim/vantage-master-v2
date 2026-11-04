// 전장 화면: 상태와 화면 움직임(물 프레임, 하늘)에서 원작 전장 DIB와 같은 색 번호 버퍼(1560 × 1008, 확대 1)와 DIB 색 표를 만든다.
// 원작은 바뀐 칩만 다시 그리지만(0x43c8aa) 결과 픽셀은 모두 다시 그린 것과 같다.
import { workGrid } from '../../engine/rules/terrain.ts';
import type { GameState } from '../../engine/state.ts';
import type { ExeImage } from '../../formats/exeImage.ts';
import type { GameMap } from '../../formats/mapData.ts';
import { addSky, dimTerrain, type Lists, type SkyMotion, terrainLists } from './field.ts';
import { buildHalf, type UiSource } from './halfSheet.ts';
import { shrinkTables } from './minimap.ts';
import { markerSprites, markUnit, NO_OVERLAY, type UiOverlay } from './overlay.ts';
import { basePalette, brightenPalette, darkenPalette, dibColors, type Flash, type Shade, timePalette } from './palette.ts';
import { drawField, type RasterTables, readRasterTables } from './raster.ts';
import { type BattleSheet, buildSheet, type ReadAny } from './sheet.ts';
import { addSprites, loadSpriteGraphics, loadUnitGraphics, type Sprite, type SpriteGraphics, unitGraphic, unitPage, unitSprite } from './sprites.ts';

export interface BattleArt {
  readonly exe: ExeImage;
  readonly read: ReadAny;
  readonly map: GameMap;
  readonly sheet: BattleSheet;
  readonly tables: RasterTables;
  readonly sprites: SpriteGraphics;
  readonly base: Uint8Array;
  /** 유닛 칸마다 그림 페이지에 둔 그림(그림 번호 × 2 + 진영), 없으면 -1 */
  readonly loaded: number[];
  /** 물 프레임마다 지형 목록. 작업 격자(물높이·마정석)가 바뀌면 비운다(원작도 그때만 0x43b8a8로 다시 짓는다) */
  readonly terrain: Map<number, { readonly lists: Lists; readonly open: Uint8Array }>;
  terrainGrid: string;
}

/** 화면 움직임: 물 애니메이션 프레임 0~3(0x49de20), 하늘 */
export interface View {
  readonly water: number;
  readonly sky: SkyMotion;
}

/** 맵 하나의 그림 자료(전투 시작 0x401a0c·0x422cd8·0x42266c) */
export function loadBattleArt(exe: ExeImage, read: ReadAny, map: GameMap): BattleArt {
  const sheet = buildSheet(exe, read, map);
  return { exe, read, map, sheet, tables: readRasterTables(exe), sprites: loadSpriteGraphics(exe, read, sheet), base: basePalette(read, map), loaded: [], terrain: new Map(), terrainGrid: '' };
}

/** 유닛 칸마다 그 유닛의 그림을 그림 페이지에(바뀐 칸만, 0x4227d5). 전장과 상태 창 초상이 같은 페이지를 쓴다 */
export function loadUnitPages(art: BattleArt, state: GameState): void {
  state.units.forEach((u, slot) => {
    if (!u) return;
    const graphic = unitGraphic(u, slot) * 2 + u.side;
    if (art.loaded[slot] === graphic) return;
    loadUnitGraphics(art.exe, art.read, art.sheet, slot, unitGraphic(u, slot), u.side);
    art.loaded[slot] = graphic;
  });
}

/** 지금 상태의 전장 화면 색 번호. overlay는 입력 단계의 표시(어둡게 할 칸·유닛, 커서, 표식). pool을 주면(연출 틀 Stage) 상태 대신 그 표시 객체를 그린다.
 *  half면 반 시트로 780 × 504(x /2) */
export function drawBattle(art: BattleArt, state: GameState, view: View, overlay: UiOverlay = NO_OVERLAY, pool?: readonly Sprite[], half = false): Uint8Array {
  const grid = workGrid(art.map, state);
  loadUnitPages(art, state);
  const key = grid.join(',');
  if (art.terrainGrid !== key) {
    art.terrain.clear();
    art.terrainGrid = key;
  }
  let built = art.terrain.get(view.water);
  if (!built) art.terrain.set(view.water, (built = terrainLists(art.sheet, art.map, grid, view.water)));
  const lists = built.lists.map((l) => l.slice()); // 어둡게 하기·하늘·표시 객체가 목록을 고친다
  const open = built.open;
  const c = overlay.cursor;
  const blink = c && c.frame < 2 ? { x: c.x, y: c.y } : null;
  if (overlay.dimCells || blink) {
    dimTerrain(lists, (x, y) => overlay.dimCells?.[y * 32 + x] === 1 || (blink !== null && blink.x === x && blink.y === y));
  }
  addSky(art.sheet, lists, open, view.sky);
  // 풀 순서: 유닛 칸 순서, 커서, 차례 표식, 범위 표식(되살리기·첫 빈 칸 할당 0x4174a6과 같은 차례)
  const units = pool ? [] : state.units.flatMap((u, slot) => (u ? [markUnit(unitSprite(art.map, grid, u, slot), slot, overlay)] : []));
  addSprites(lists, art.sprites, pool ?? [...units, ...markerSprites(art.map, grid, state, overlay)], blink);
  return drawField(art.sheet, art.tables, lists, half);
}

/** vmv2.exe 0x0040ee74: 확대를 x /2로 바꿀 때 반 시트를 채운다. palette는 그때의 논리 팔레트(logicalPalette), ui는 UI 페이지 출처,
 *  logical은 x /2인 동안 읽기 때의 논리 팔레트(없으면 palette).
 *  유닛 페이지는 시트에 읽혀 있는 칸 모두(원작은 유닛 표를 돈다: 흐름 중 소환된 유닛도) */
export function enterHalf(art: BattleArt, state: GameState, palette: Uint8Array, ui: UiSource, logical?: () => Uint8Array): void {
  loadUnitPages(art, state);
  const pages = art.loaded.flatMap((g, slot) => (g >= 0 ? [unitPage(slot)] : []));
  art.sheet.half = buildHalf(art.sheet, art.read, palette, shrinkTables(art.exe, art.map), pages, ui, logical);
}

/** vmv2.exe 0x0040ef93: x /2를 떠난다(표식 그림 다시 읽기 0x422f9a는 부르는 쪽이) */
export function leaveHalf(art: BattleArt): void {
  art.sheet.half = null;
}

/**
 * 지금 시각의 DIB 색 표(RGBQUAD 256개, 10~245번만 채움). shade는 어두운 칸 0x76~0xe5번의 상태(palette.ts Shade)이고, 원작은 그 칸을 음영을 건
 * 시각(shadeTime)의 팔레트로 한 번 계산해 둔다: 다음 차례 시작에 시각이 바뀌어도 그대로다
 */
export function battleColors(art: BattleArt, state: GameState, shade: Shade = 'black', flash?: Flash, shadeTime = state.timeOfDay): Uint8Array {
  const shaded = battlePalette(art, state, shade, shadeTime);
  return dibColors(flash ? flash.apply(shaded) : shaded);
}

/** 지금 시각·음영의 게임 팔레트(236칸, 번쩍임 없음) */
export function battlePalette(art: BattleArt, state: GameState, shade: Shade, shadeTime: number): Uint8Array {
  const palette = timePalette(art.exe, art.map, art.base, state.timeOfDay);
  const from = shadeTime === state.timeOfDay ? palette : timePalette(art.exe, art.map, art.base, shadeTime);
  return shade === 'dark' ? darkenPalette(palette, from) : shade === 'bright' ? brightenPalette(palette, from) : shade === 'base' ? brightenPalette(palette, art.base) : palette;
}

/** 논리 팔레트(LOGPALETTE 항목 256개: R, G, B, 0, DIB 번호 그대로): 반 시트 줄이기(0x4232a9)가 읽는다. 번쩍임은 넣지 않는다 */
export function logicalPalette(art: BattleArt, state: GameState, shade: Shade = 'black', shadeTime = state.timeOfDay): Uint8Array {
  const p = battlePalette(art, state, shade, shadeTime);
  const out = new Uint8Array(256 * 4);
  for (let i = 0; i < 236; i++) out.set(p.subarray(i * 4, i * 4 + 3), (i + 10) * 4);
  return out;
}

/** 색 번호 → 캔버스 RGBA */
export function toRgba(indices: Uint8Array, colors: Uint8Array): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(indices.length * 4);
  for (let i = 0; i < indices.length; i++) {
    const c = indices[i] * 4;
    out[i * 4] = colors[c + 2];
    out[i * 4 + 1] = colors[c + 1];
    out[i * 4 + 2] = colors[c];
    out[i * 4 + 3] = 255;
  }
  return out;
}
