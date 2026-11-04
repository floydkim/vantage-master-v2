// 명령(차례 하나). vmv2.exe 네트워크 대전 메시지 형식(0x406d13이 만들고, 받는 쪽 0x40672d·0x4067b1이 실행):
// u16 A = 이동할 x | y << 5 | 방향 << 10 | 종류 << 13, u16 B = 행동·네이티얼 번호 | 대상 x << 6 | 대상 y << 11.
export const STAND_BY = 0;
export const ACT = 1;
export const SUMMON = 2;
export const RETURN = 3;

export interface Cell {
  readonly x: number;
  readonly y: number;
}

export interface Command {
  /** 이동할 칸(제자리면 지금 칸) */
  readonly to: Cell;
  /** 이동한 뒤 바라볼 방향 0~5 */
  readonly direction: number;
  /** STAND_BY, ACT(공격·마법), SUMMON, RETURN(네이티얼 되돌리기) */
  readonly kind: number;
  /** 행동 번호(ACT) 또는 네이티얼 종류(SUMMON) */
  readonly number: number;
  readonly target: Cell;
}

export function encodeCommand(c: Command): [number, number] {
  const fits = (v: number, bits: number) => Number.isInteger(v) && v >= 0 && v < 1 << bits;
  if (![[c.to.x, 5], [c.to.y, 5], [c.direction, 3], [c.kind, 3], [c.number, 6], [c.target.x, 5], [c.target.y, 5]].every(([v, b]) => fits(v, b))) {
    throw new RangeError(`명령 값이 메시지 칸을 넘습니다: ${JSON.stringify(c)}`);
  }
  return [c.to.x | (c.to.y << 5) | (c.direction << 10) | (c.kind << 13), c.number | (c.target.x << 6) | (c.target.y << 11)];
}

export function decodeCommand(a: number, b: number): Command {
  return {
    to: { x: a & 0x1f, y: (a >> 5) & 0x1f },
    direction: (a >> 10) & 7,
    kind: (a >> 13) & 7,
    number: b & 0x3f,
    target: { x: (b >> 6) & 0x1f, y: (b >> 11) & 0x1f },
  };
}
