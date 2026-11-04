// 옵션 word(0x503ff0, 레지스트리 SaveDataKey)와 BGM 장치(0x4cd688, BGM Device). System > Customize(0x44ee63)·Sound(0x443511). 해독 메모 notes_options.md

/** 레지스트리가 없을 때(0x44e181) */
export const DEFAULT_OPTIONS = 0x77;
/** 비트: 하늘·물(지도)·유닛 애니메이션, CPU 생각 No Guard, BGM, 효과음 */
export const OPT = { sky: 1, water: 2, units: 4, noGuard: 8, bgm: 0x10, effects: 0x20 } as const;

/** vmv2.exe 0x0044ee63 앞: 생각 방식 라디오(비트 8), 애니메이션 라디오(켜진 가장 낮은 비트로: 1 → 0, 2 → 1, 4 → 2, 없음 → 3), 생각 방식은 전투(장면 4) 밖에서만 */
export function customizeInit(options: number, scene: number): { pattern: 0 | 1; animation: 0 | 1 | 2 | 3; patternEnabled: boolean } {
  const animation = options & 1 ? 0 : options & 2 ? 1 : options & 4 ? 2 : 3;
  return { pattern: options & OPT.noGuard ? 1 : 0, animation, patternEnabled: scene !== 4 };
}

const ANIMATION_BITS = [7, 6, 4, 0] as const; // Animate all, Stop background, Stop background and map, Stop all

/** vmv2.exe 0x0044ee63 OK 뒤: 옵션이 before → after로 바뀔 때 전투 중(장면 4) 끈 하늘은 처음 프레임(0x43d4b8), 물은 프레임 0(0x43e2e0) */
export function animationResets(before: number, after: number, scene: number): { resetSky: boolean; resetWater: boolean } {
  const off = before & ~after;
  return { resetSky: scene === 4 && (off & OPT.sky) !== 0, resetWater: scene === 4 && (off & OPT.water) !== 0 };
}

/** vmv2.exe 0x0044ee63 OK 뒤: 새 옵션과 하늘·물 되돌리기 */
export function customizeApply(options: number, scene: number, pattern: 0 | 1, animation: 0 | 1 | 2 | 3): { options: number; resetSky: boolean; resetWater: boolean } {
  const next = ((pattern ? options | OPT.noGuard : options & ~OPT.noGuard) & ~7) | ANIMATION_BITS[animation];
  return { options: next, ...animationResets(options, next, scene) };
}

/** vmv2.exe 0x00443511 앞: 템플릿(MIDI\CR000GS.MID가 있으면 0x7a), 체크 둘, 장치 라디오 */
export function soundInit(options: number, device: number, gsFiles: boolean): { template: 0x79 | 0x7a; bgm: boolean; effects: boolean; device: number } {
  return { template: gsFiles ? 0x7a : 0x79, bgm: (options & OPT.bgm) !== 0, effects: (options & OPT.effects) !== 0, device };
}

/** vmv2.exe 0x00443511 OK 뒤: 장치가 바뀌면 지금 곡 멈춤·CD 닫기(stop), BGM 비트나 장치가 바뀌면 0x44372e(restart) */
export function soundApply(options: number, device: number, bgm: boolean, effects: boolean, nextDevice: number): { options: number; device: number; stop: boolean; restart: boolean } {
  let next = options;
  let changed = false;
  if (bgm !== ((options & OPT.bgm) !== 0)) {
    next ^= OPT.bgm;
    changed = true;
  }
  if (effects !== ((options & OPT.effects) !== 0)) next ^= OPT.effects;
  const stop = nextDevice !== device;
  return { options: next, device: nextDevice, stop, restart: changed || stop };
}

/** 처리기 0x44edf1(0x7b)·0x4434b3(0x79·0x7a): 라디오·체크를 누르면 소리 4 */
export function optionClickSounds(template: number, id: number): number[] {
  const radio = template === 0x7b ? (id >= 0x960 && id <= 0x963) || id === 0xbc1 || id === 0xbc2 : id >= 0x9c4 && id <= 0x9c9;
  return radio ? [4] : [];
}

const OPTIONS_KEY = 'vmv2/SaveDataKey';
const DEVICE_KEY = 'vmv2/BGM Device';

/** 원작 기본은 CD(0)지만 사용자 결정 9로 브라우저 재생(MIDI 1)이 기본 */
const DEFAULT_DEVICE = 1;

/** 저장소의 옵션(없으면 0x77)과 BGM 장치(없으면 MIDI) */
export function readOptions(): { options: number; device: number } {
  const get = (key: string, fallback: number) => {
    try {
      const v = Number.parseInt(localStorage.getItem(key) ?? '', 10);
      return Number.isInteger(v) ? v : fallback;
    } catch {
      return fallback;
    }
  };
  return { options: get(OPTIONS_KEY, DEFAULT_OPTIONS) & 0xffff, device: usableDevice(get(DEVICE_KEY, DEFAULT_DEVICE)) };
}

/** vmv2.exe 0x0044369a: GS 파일(MIDI\CR000GS.MID)이 없으면 저장한 GS(2)는 MIDI(1)로. SC-88(3)은 리메이크가 녹음으로 틀어 그대로 둔다 */
export const usableDevice = (device: number): number => (device === 2 ? 1 : device);

/** 쓸 수 있는 BGM 장치(차례 0 CD, 1 MIDI, 2 GS, 3 SC-88): CD·SC-88은 저장소에 그 곡이 있을 때만, MIDI는 늘(게임 파일), GS는 파일이 없음. paths가 null이면 서버 출처(개발 서버의 original/)라 모두 */
export function bgmDevices(paths: readonly string[] | null): boolean[] {
  const has = (prefix: string) => paths === null || paths.some((p) => p.startsWith(prefix));
  return [has('CDDA/'), true, false, has('SC88/')];
}

/** 저장된 장치를 쓸 수 없으면 대화 상자 차례로 첫 쓸 수 있는 장치(MIDI는 늘 쓸 수 있다) */
export const fallbackDevice = (device: number, devices: readonly boolean[]): number => (devices[device] ? device : devices.indexOf(true));

/** OK 때 저장할 장치: 지금 쓰는 장치(대체됐을 수 있음)를 바꾸지 않았으면 저장된 선택 그대로(Customize OK·손대지 않은 Sound OK가 대체 장치로 덮지 않게), 바꿨으면 고른 장치 */
export const savedDevice = (next: number, current: number, stored: number): number => (next === current ? stored : next);

/** 원작은 앱이 끝날 때(WM_DESTROY 0x44e290)만 쓴다. 브라우저에는 믿을 만한 끝이 없어 OK마다 */
export function writeOptions(options: number, device: number): void {
  try {
    localStorage.setItem(OPTIONS_KEY, String(options & 0xffff));
    localStorage.setItem(DEVICE_KEY, String(device));
  } catch {
    // 저장소를 못 쓰면 이번 실행에만
  }
}
