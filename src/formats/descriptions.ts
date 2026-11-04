// 상태 줄 설명 글(첫머리 " <이름> " 뒤 줄바꿈으로 이어지는 설명). 커서 칸의 지형(0x424eb6), 네이티얼·마스터(0x424ed3)가 쓴다.
import type { ExeImage } from './exeImage.ts';

const TERRAIN = 0x46222c; // 지형 종류(부품 +0x62) 0~16
const NATIALS = 0x46226c; // 네이티얼 종류 0~25(0은 벽)
const MASTERS = 0x4622d0; // 마스터 번호 0~26
const TERRAIN_KINDS = 17;
const NATIAL_KINDS = 26;
const MASTER_COUNT = 27;

export interface Descriptions {
  readonly terrain: readonly string[];
  readonly natials: readonly string[];
  readonly masters: readonly string[];
  /** 시나리오: 진영 1 마스터 설명(맵 MAS +0x1c, 0x42d2e9 → 0x424fbf가 0x483bec에 복사) */
  readonly enemyMaster?: string;
}

/** vmv2.exe 0x00424f45·0x00424ed3: 진영의 마스터 설명. 시나리오의 진영 1은 MAS 글, 아니면 0x4622d0[마스터] */
export const masterText = (texts: Descriptions, side: number, master: number): string => (side === 1 && texts.enemyMaster !== undefined ? texts.enemyMaster : texts.masters[master]);

export function readDescriptions(exe: ExeImage): Descriptions {
  const table = (at: number, n: number) => {
    const v = new DataView(exe.read(at, n * 4).buffer);
    return Array.from({ length: n }, (_, i) => exe.cString(v.getUint32(i * 4, true)));
  };
  return { terrain: table(TERRAIN, TERRAIN_KINDS), natials: table(NATIALS, NATIAL_KINDS), masters: table(MASTERS, MASTER_COUNT) };
}

/** 설명 첫머리 <이름>의 이름(없으면 빈 문자열) */
export const titleOf = (text: string): string => /<([^>]*)>/.exec(text)?.[1] ?? '';

const MAP_LABELS = 0x475be0; // Phase 1~6, Expert, Free Map, Versus
// vmv2.exe 0x00450b40: 맵마다 위 이름표 중 하나를 0x5061f0[맵]에 둔다(코드에 박힌 대입)
const MAP_LABEL_OF = [0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5, 6, 6, 6, 6, 6, 6, 6, 6, 7, 7, 7, 7, 7, 8, 8, 7, 7, 7, 8, 8, 8, 8];

/** 맵 이름표(전투 상태 창 0x40b12a가 맵 이름 아래에 쓴다) */
export function readMapLabel(exe: ExeImage, map: number): string {
  const k = MAP_LABEL_OF[map];
  if (k === undefined) throw new RangeError(`맵 번호 범위 밖: ${map}`);
  return exe.cString(new DataView(exe.read(MAP_LABELS + k * 4, 4).buffer).getUint32(0, true));
}
