// 효과음 채널(vmv2.exe 0x443d19·0x443e38·0x443f0a·0x443f4b·0x443f84). 원작은 PlaySoundA로 소리 하나만 낸다: 새 소리가 앞 소리를 끊고,
// SND_NOSTOP이면 울리는 중일 때 내지 않는다. 일반 효과음은 버퍼 둘(0x483f20 + 0x80000 + i·0x20000)을 번갈아 쓰고, 연출 효과음은 칸 넷에 미리 읽는다.
import type { ExeImage } from '../../formats/exeImage.ts';
import type { VmDat } from '../../formats/vmFiles.ts';

/** 원작 효과음 호출: 일반(0x443d19 번호), 반복(0x443e38 번호), 미리 읽기(0x443f0a 리소스, 칸), 내기(0x443f4b 칸) */
export type SoundCall = readonly ['ui', number] | readonly ['loop', number] | readonly ['load', number, number] | readonly ['play', number];

/** 소리를 내는 쪽. entry는 DATA13 항목. noStop이면 울리는 중일 때 내지 않고 false */
export interface Player {
  play(entry: number, loop: boolean, noStop: boolean): boolean;
  stop(): void;
}

const IDS = 0x47446c; // 번호 → 리소스
const PRIORITY = 0x4744a4; // 번호 → 우선순위
const NUMBERS = 14;
const NONE = -1;
const entryOf = (resource: number) => (resource === NONE ? NONE : resource & 0xffff);

export class Sound {
  private readonly ids: readonly number[];
  private readonly priority: readonly number[];
  private readonly player: Player;
  private state = 0; // 0x4cd6a8: 1 일반, 2 연출, 3 반복
  private current = 0; // 0x4744e0: 지금 버퍼의 번호
  private other = 0; // 0x4744e4: 다른 버퍼에 읽은 번호
  private cur = 0; // 0x4cd6a4
  // ponytail: 원작 처음 상태는 버퍼 0이 비어 있다(타이틀에서 이미 소리를 내 채워진 뒤 전투가 열림). 번호 0이 실린 것으로 둔다
  private readonly buffers: number[];
  private readonly slots = [NONE, NONE, NONE, NONE];

  /** 옵션 비트 0x20(System > Sound "Effect"): 꺼져 있으면 네 함수가 맨 앞에서 돌아간다(상태도 그대로) */
  effects = true;

  constructor(exe: ExeImage, player: Player) {
    const v = new DataView(exe.read(IDS, NUMBERS * 8).buffer);
    this.ids = Array.from({ length: NUMBERS }, (_, i) => v.getUint32(i * 4, true));
    this.priority = Array.from({ length: NUMBERS }, (_, i) => v.getInt32(PRIORITY - IDS + i * 4, true));
    this.player = player;
    this.buffers = [this.ids[0], NONE];
  }

  call(c: SoundCall): void {
    if (!this.effects) return;
    switch (c[0]) {
      case 'ui':
        return this.ui(c[1]);
      case 'loop':
        return this.loop(c[1]);
      case 'load':
        // vmv2.exe 0x00443f0a: 연출 효과음이 울리는 중이면 끈다(0x443f84)
        if (this.state === 2) this.stop();
        this.slots[c[2]] = c[1];
        return;
      case 'play':
        // vmv2.exe 0x00443f4b
        this.player.play(entryOf(this.slots[c[1]]), false, false);
        this.state = 2;
    }
  }

  // vmv2.exe 0x00443f84
  private stop(): void {
    this.player.stop();
    this.state = 0;
  }

  // 번호 n이 실린(또는 실을) 버퍼
  private bufferOf(n: number): number {
    if (this.current === n) return this.cur;
    const buf = 1 - this.cur;
    if (this.other !== n) {
      this.buffers[buf] = this.ids[n];
      this.other = n;
    }
    return buf;
  }

  private swap(buf: number, n: number): void {
    if (this.cur === buf) return;
    this.other = this.current;
    this.cur = buf;
    this.current = n;
  }

  /** vmv2.exe 0x00443d19: 연출 효과음 중이거나 지금 소리보다 우선순위가 낮으면 끊지 않는다 */
  private ui(n: number): void {
    const noStop = this.state === 2 || this.priority[n] < this.priority[this.current];
    const buf = this.bufferOf(n);
    const played = this.player.play(entryOf(this.buffers[buf]), false, noStop);
    if (noStop && !played) return;
    this.state = 1;
    this.swap(buf, n);
  }

  /** vmv2.exe 0x00443e38: 반복(SND_LOOP | SND_NOSTOP) */
  private loop(n: number): void {
    const buf = this.bufferOf(n);
    if (!this.player.play(entryOf(this.buffers[buf]), true, true)) return;
    this.state = 3;
    this.swap(buf, n);
  }
}

/** WAV를 RIFF 길이(+ 8)까지. 한국어판 DATA13은 항목마다 131072바이트 칸을 0으로 채운다(영문판은 길이가 맞음) */
export function wavBytes(entry: Uint8Array): Uint8Array {
  if (entry.length < 8 || String.fromCharCode(...entry.subarray(0, 4)) !== 'RIFF') return entry;
  const end = new DataView(entry.buffer, entry.byteOffset).getUint32(4, true) + 8;
  return end < entry.length ? entry.subarray(0, end) : entry;
}

const players = new WeakMap<VmDat, Player>();
const silent: Player = { play: () => true, stop: () => {} };

/** DATA13마다 재생기 하나(판마다 AudioContext를 새로 만들지 않는다). Web Audio를 쓸 수 없으면 소리 없이 */
export function webPlayer(dat13: VmDat): Player {
  let p = players.get(dat13);
  if (!p) {
    try {
      p = new WebPlayer(dat13);
    } catch {
      p = silent;
    }
    players.set(dat13, p);
  }
  return p;
}

/** 브라우저 재생기: DATA13 WAV를 미리 풀어 두고 소스 하나로 낸다(PlaySoundA처럼 새 소리가 앞 소리를 끊음) */
class WebPlayer implements Player {
  private readonly context = new AudioContext();
  private readonly buffers = new Map<number, AudioBuffer>();
  private source: AudioBufferSourceNode | null = null;

  constructor(dat13: VmDat) {
    for (let i = 0; i < dat13.entryCount; i++) {
      const wav = wavBytes(dat13.read(i));
      if (wav.length) this.context.decodeAudioData(wav.slice().buffer).then((b) => this.buffers.set(i, b), () => {});
    }
  }

  play(entry: number, loop: boolean, noStop: boolean): boolean {
    if (noStop && this.source) return false;
    if (this.context.state === 'suspended') void this.context.resume();
    this.stop();
    const buffer = this.buffers.get(entry);
    if (!buffer) return true; // ponytail: 아직 못 푼 소리는 건너뜀(원작은 빈 버퍼를 냄)
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.loop = loop;
    source.connect(this.context.destination);
    source.onended = () => {
      if (this.source === source) this.source = null;
    };
    source.start();
    this.source = source;
    return true;
  }

  stop(): void {
    const source = this.source;
    this.source = null;
    source?.stop();
  }
}
