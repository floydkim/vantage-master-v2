// BGM MIDI 장치(원작 MCI sequencer 0x443b26·0x443beb·0x443c5a): spessasynth_lib(WorkletSynthesizer + Sequencer)로 곡을 한 번 틀고 끝을 알린다.
// 반복은 Bgm(0x443847)이 끝 알림에 replay로. 사운드폰트·MIDI 파일이 없으면 소리 없이 failed를 알린다(원작 MCI 열기 실패처럼, 오류 상자 없음)
import { Sequencer, WorkletSynthesizer } from 'spessasynth_lib';
import processorUrl from 'spessasynth_lib/dist/spessasynth_processor.min.js?url';
import { originalBytes } from '../../originals/source.ts';
import type { BgmDevice, BgmTrack } from './bgm.ts';

const SOUNDFONT = 'GeneralUser-GS.sf2'; // pnpm fetch-soundfont(다른 SF2·DLS로 바꿀 수 있음), BASE_URL 아래(하위 경로 배포)
const MIDI = 'VMO_WIN/MIDI/';
const VOLUME = 0.7; // 효과음과 따로(원작은 MIDI 장치 음량)
/** 자동 재생 제한을 푸는 사용자 동작: 마우스는 pointerdown, 터치·펜은 pointerup부터 */
export const WAKE_EVENTS = ['pointerdown', 'pointerup', 'keydown'];

async function fetchBinary(url: string): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(url, { headers: { Accept: 'application/octet-stream' } });
    return res.ok ? await res.arrayBuffer() : null;
  } catch {
    return null;
  }
}

export class MidiDevice implements BgmDevice {
  /** 곡이 끝났다(MM_MCINOTIFY 성공) */
  onEnded: (() => void) | null = null;
  /** 곡을 열지 못했다(파일·사운드폰트 없음, 늦게 앎) */
  onFailed: ((track: number) => void) | null = null;
  private readonly table: readonly BgmTrack[];
  private engine: Promise<{ readonly ctx: AudioContext; readonly synth: WorkletSynthesizer; readonly seq: Sequencer } | null> | null = null;
  private loaded: { readonly synth: WorkletSynthesizer; readonly seq: Sequencer } | null = null;
  // 요청 번호: 앞 곡을 다 읽기 전에 다음 곡·멈춤이 오면 늦게 온 결과는 버린다
  private request = 0;
  /** 시퀀서에 올라 틀고 있는 곡의 요청 번호 */
  private live = 0;

  constructor(table: readonly BgmTrack[]) {
    this.table = table;
  }

  private start() {
    this.engine ??= (async () => {
      // 자동 재생 제한: 첫 사용자 동작에 깨운다. 사운드폰트(32MB)를 받기 전에 만들어 두어야 실행 아이콘을 누르는 그 동작이 깨운다(WebKit은 동작 안에서만 허락)
      const ctx = new AudioContext();
      const wake = () => void ctx.resume();
      const unwake = () => {
        for (const type of WAKE_EVENTS) window.removeEventListener(type, wake, { capture: true });
      };
      for (const type of WAKE_EVENTS) window.addEventListener(type, wake, { capture: true });
      ctx.addEventListener('statechange', () => ctx.state === 'running' && unwake());
      const bank = await fetchBinary(`${import.meta.env.BASE_URL}${SOUNDFONT}`);
      if (!bank) {
        unwake();
        void ctx.close();
        return null;
      }
      await ctx.audioWorklet.addModule(processorUrl);
      const synth = new WorkletSynthesizer(ctx);
      const gain = new GainNode(ctx, { gain: VOLUME });
      synth.connect(gain);
      gain.connect(ctx.destination);
      await synth.soundBankManager.addSoundBank(bank, 'main');
      await synth.isReady;
      const seq = new Sequencer(synth, { skipToFirstNoteOn: false });
      seq.loopCount = 0;
      seq.eventHandler.addEvent('songEnded', 'vmv2-bgm', () => this.songEnded());
      this.loaded = { synth, seq };
      return { ctx, synth, seq };
    })().catch(() => null);
    return this.engine;
  }

  /** 사운드폰트를 미리 받아 엔진을 만든다(첫 곡을 기다리지 않게) */
  prefetch(): void {
    void this.start();
  }

  /** 0x443b26: 곡을 열고 처음부터. 열기는 비동기라 바로 true를 돌려주고 실패는 onFailed로 */
  play(track: number): boolean {
    const id = ++this.request;
    void (async () => {
      const [engine, midi] = await Promise.all([this.start(), originalBytes(MIDI + this.table[track].files[0]).then((b) => b.slice().buffer, () => null)]);
      if (id !== this.request) return;
      if (!engine || !midi) return this.onFailed?.(track);
      engine.seq.loadNewSongList([{ binary: midi, fileName: this.table[track].files[0] }]);
      engine.seq.currentTime = 0;
      this.live = id;
      engine.seq.play();
    })();
    return true;
  }

  /** 시퀀서의 곡 끝: 지금 요청한 곡이 틀고 있을 때만 알린다(멈춘 뒤·다음 곡을 여는 동안 온 옛 곡 알림은 버림) */
  songEnded(): void {
    if (this.live === this.request) this.onEnded?.();
  }

  /** 0x443beb: 연 곡을 처음부터 다시 */
  replay(): boolean {
    if (!this.loaded) return false;
    this.loaded.seq.currentTime = 0;
    this.loaded.seq.play();
    return true;
  }

  /** 0x443c5a: 멈추고 닫기 */
  stop(): void {
    this.request++;
    if (!this.loaded) return;
    this.loaded.seq.pause();
    this.loaded.synth.stopAll(); // midiOutReset의 노트 끔처럼 여운을 남긴다(강제로 자르지 않음)
  }
}

