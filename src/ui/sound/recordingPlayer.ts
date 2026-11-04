// BGM 녹음 장치: 사용자가 준 음원(pnpm import-cd-audio → original/CDDA·SC88/TRACKnn.mp3, nn = 곡 표 0x4742f0의 CD 트랙)을
// 오디오 요소로 한 곡 틀고 끝을 알린다. CD 장치(MCI cdaudio 0x443973 재생·0x443a62 멈춤)와 SC-88 장치(원작은 S8 MIDI 파일, 리메이크는 그 녹음)에 쓴다.
// 반복은 Bgm(0x443847)이 끝 알림에 다시 틀기로. 파일이 없으면 소리 없이 failed를 알린다(원작 열기 실패처럼, "There is no CD audio…" 상자 없음: 결정 9)
import type { BgmDevice, BgmTrack } from './bgm.ts';
import { originalUrl } from '../../originals/source.ts';
import { WAKE_EVENTS } from './midiPlayer.ts';

const VOLUME = 0.7; // MIDI 장치와 같은 크기

/** 오디오 요소에서 쓰는 것만(시험은 대역을 넣는다) */
export interface AudioLike {
  src: string;
  currentTime: number;
  volume: number;
  play(): Promise<void>;
  pause(): void;
  addEventListener(type: 'ended' | 'error', listener: () => void): void;
}

export class RecordingDevice implements BgmDevice {
  /** 트랙이 끝났다(MM_MCINOTIFY 성공) */
  onEnded: (() => void) | null = null;
  /** 트랙을 열지 못했다(파일 없음, 늦게 앎) */
  onFailed: ((track: number) => void) | null = null;
  private readonly table: readonly BgmTrack[];
  /** 원본 폴더(CDDA·SC88): 트랙 파일은 그 아래 TRACKnn.mp3 */
  private readonly dir: 'CDDA' | 'SC88';
  private readonly create: () => AudioLike;
  private audio: AudioLike | null = null;
  // 요청 번호: 첫 사용자 동작을 기다리는 동안 다음 곡·멈춤이 오면 그 재생은 버린다
  private request = 0;
  private track = -1;
  /** 틀고 있음: 멈춘 뒤 온 끝·오류 알림은 버린다 */
  private playing = false;

  constructor(table: readonly BgmTrack[], dir: 'CDDA' | 'SC88', create: () => AudioLike = () => new Audio()) {
    this.table = table;
    this.dir = dir;
    this.create = create;
  }

  private element(): AudioLike {
    if (this.audio) return this.audio;
    const a = this.create();
    a.volume = VOLUME;
    a.addEventListener('ended', () => this.finish(() => this.onEnded?.()));
    a.addEventListener('error', () => this.finish(() => this.onFailed?.(this.track)));
    return (this.audio = a);
  }

  private finish(notify: () => void): void {
    if (!this.playing) return;
    this.playing = false;
    notify();
  }

  /** 0x443973·0x443b26: 그 곡의 트랙을 처음부터. 여는 것은 비동기라 바로 true를 돌려주고 실패는 onFailed로 */
  play(track: number): boolean {
    const a = this.element();
    const id = ++this.request;
    this.track = track;
    this.playing = true;
    void originalUrl(`${this.dir}/TRACK${String(this.table[track].cd).padStart(2, '0')}.mp3`).then((url) => {
      if (id !== this.request) return; // 그사이 다른 곡·멈춤
      if (!url) {
        a.pause(); // 넣지 않은 트랙: 파일이 없는 것과 같다(앞 곡을 멈춘다)
        return this.finish(() => this.onFailed?.(track));
      }
      a.src = url;
      a.currentTime = 0;
      a.play().catch((e: unknown) => (e as { name?: string } | null)?.name === 'NotAllowedError' && this.wake(id));
    });
    return true;
  }

  // 자동 재생 제한: 첫 사용자 동작에 다시 튼다(그사이 다른 곡·멈춤이 왔으면 그만)
  private wake(id: number): void {
    const go = () => {
      for (const type of WAKE_EVENTS) window.removeEventListener(type, go, { capture: true });
      if (id === this.request) void this.audio?.play().catch(() => {});
    };
    for (const type of WAKE_EVENTS) window.addEventListener(type, go, { capture: true });
  }

  replay(): boolean {
    return this.track >= 0 && this.play(this.track);
  }

  /** 0x443a62: 멈춤 */
  stop(): void {
    this.request++;
    this.playing = false;
    this.audio?.pause();
  }

  /** 0x443a95: 장치 닫기 */
  close(): void {
    this.stop();
  }
}
