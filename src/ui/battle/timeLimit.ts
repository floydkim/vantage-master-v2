// 사람 차례의 생각 시간 제한(블록 +0x14가 3이 아닐 때). 시각은 ms 정수(timeGetTime)를 인자로 받는다. 남은 시간은 1/6초 단위다
import type { ExeImage } from '../../formats/exeImage.ts';

/** 시간 제한 0~3마다(i32 × 4) */
export interface TimeTables {
  /** 0x45e0f0: 차례 유닛이 마스터일 때 제한(초) */
  readonly master: readonly number[];
  /** 0x45e0fc: 네이티얼일 때 제한(초) */
  readonly natial: readonly number[];
  /** 0x45e108: 전투 시작 때 진영마다 연장 횟수 */
  readonly extensions: readonly number[];
  /** 0x45e118: 연장 한 번에 늘어나는 초 */
  readonly extendSeconds: readonly number[];
}

export function readTimeTables(exe: ExeImage): TimeTables {
  const table = (at: number) => {
    const v = new DataView(exe.read(at, 16).buffer);
    return [0, 1, 2, 3].map((k) => v.getInt32(k * 4, true));
  };
  return { master: table(0x45e0f0), natial: table(0x45e0fc), extensions: table(0x45e108), extendSeconds: table(0x45e118) };
}

export const NO_LIMIT = 3;

export interface Timer {
  /** 0x476b80 시작 시각(ms) */
  readonly start: number;
  /** 0x476b34 제한(초). 연장마다 늘어난다 */
  readonly limit: number;
  /** 0x476ae0 남은 시간(1/6초) */
  readonly remaining: number;
  /** 0x476b5c~0x476b68 경고음 플래그: 10초, 1초, 2초, 3초 */
  readonly warned: readonly [boolean, boolean, boolean, boolean];
}

/** vmv2.exe 0x004055cf(사람 입력 시작): 시간 제한이 없으면 null(0x476adc = 0) */
export function startTimer(t: TimeTables, timeLimit: number, master: boolean, now: number): Timer | null {
  if (timeLimit === NO_LIMIT) return null;
  const limit = (master ? t.master : t.natial)[timeLimit];
  return { start: now, limit, remaining: limit * 6, warned: [false, false, false, false] };
}

export interface Tick {
  readonly timer: Timer;
  /** 차례 진영의 남은 연장 횟수 */
  readonly extensions: number;
  readonly sounds: readonly number[];
  /** 다 썼고 입력 중이다(0x407926이 1을 돌려줌): 강제 Stand by(0x406cd2) */
  readonly expired: boolean;
  /** 정보 창 다시 그리기: 시간 칸(0x40b00c), 연장을 썼으면 전체(0x40aee4), 연장 없이 다 썼으면 없음 */
  readonly redraw: 'time' | 'all' | null;
}

/** vmv2.exe 0x00407926(p): 48ms 콜백(p = 입력 단계 ≠ 0)과 걷기 끝(p = 1)이 부른다 */
export function tickTimer(t: TimeTables, timeLimit: number, timer: Timer, extensions: number, now: number, input: boolean): Tick {
  // e = (지금 − 시작) × 6 / 1000: DWORD 곱셈(넘치면 감김)과 부호 없는 나눗셈, 비교는 부호 있게
  const e = Math.floor((Math.imul((now - timer.start) >>> 0, 6) >>> 0) / 1000) | 0;
  const sounds: number[] = [];
  let { limit, remaining, warned } = timer;
  let redraw: Tick['redraw'] = 'time';
  if (e < limit * 6) {
    const before = remaining;
    remaining = limit * 6 - e;
    if (before !== remaining) {
      const w = [...warned] as [boolean, boolean, boolean, boolean];
      const bands: [number, (r: number) => boolean, number][] = [
        [0, (r) => r < 0x3d, 10],
        [1, (r) => r < 7, 11],
        [2, (r) => 6 < r && r < 0xd, 11],
        [3, (r) => 0xc < r && r < 0x13, 11],
      ];
      const hit = bands.find(([k, inBand]) => !w[k] && inBand(remaining));
      if (hit) {
        w[hit[0]] = true;
        sounds.push(hit[2]);
      }
      warned = w;
    }
  } else if (extensions < 1) {
    remaining = 0;
    redraw = null;
  } else {
    redraw = 'all';
    // 1/6초를 초 표로 나누는 원작 셈 그대로
    const n = Math.trunc((e - limit * 6) / t.extendSeconds[timeLimit]) + 1;
    if (extensions < n) {
      extensions = 0;
      remaining = 0;
    } else {
      extensions -= n;
      limit += n * t.extendSeconds[timeLimit];
      remaining = limit * 6 - e;
      sounds.push(12);
    }
    warned = [false, false, false, false];
  }
  const expired = remaining === 0 && input;
  if (expired) sounds.push(13);
  return { timer: { start: timer.start, limit, remaining, warned }, extensions, sounds, expired, redraw };
}

/**
 * 정보 창 연장 아이콘이 보일 진영(0x476af0). actorSide가 없으면 전투 시작·되살리기(0x401d98): 사람 진영이 하나면 그 진영.
 * 있으면 차례 시작(0x40536c): 차례 진영이 사람이면 그 진영, 아니면 그대로
 */
export function shownSide(controllers: readonly number[], prev: number | null, actorSide?: number): number | null {
  if (actorSide !== undefined) return controllers[actorSide] === 0 ? actorSide : prev;
  const humans = [0, 1].filter((s) => controllers[s] === 0);
  return humans.length === 1 ? humans[0] : null;
}
