import { expect, it, vi } from 'vitest';
import type { VmDat } from '../../src/formats/vmFiles.ts';
import { type Player, Sound, wavBytes, webPlayer } from '../../src/ui/battle/sound.ts';
import { exe } from './screenCases.ts';

// 가짜 재생기: 소리는 end()를 부를 때까지 울린다(SND_NOSTOP 판정)
function fake() {
  const log: string[] = [];
  let playing = false;
  const player: Player = {
    play(entry, loop, noStop) {
      if (noStop && playing) {
        log.push(`무시 ${entry.toString(16)}`);
        return false;
      }
      playing = true;
      log.push(`${loop ? '반복' : '냄'} ${entry.toString(16)}`);
      return true;
    },
    stop() {
      playing = false;
      log.push('끔');
    },
  };
  return { log, player, end: () => (playing = false) };
}

it('일반 효과음은 번호 표의 DATA13 항목을 내고, 우선순위가 낮으면 울리는 소리를 끊지 않는다(0x443d19)', () => {
  const f = fake();
  const sound = new Sound(exe, f.player);
  sound.call(['ui', 4]); // 우선순위 2
  sound.call(['ui', 0]); // 1 < 2: 울리는 중이라 무시
  f.end();
  sound.call(['ui', 0]); // 끝났으면 낸다
  sound.call(['ui', 1]); // 3 ≥ 1: 끊고 낸다
  sound.call(['ui', 1]); // 같은 번호는 같은 버퍼
  expect(f.log).toEqual(['냄 8d', '무시 89', '냄 89', '냄 8a', '냄 8a']);
});

it('연출 효과음은 칸에 미리 읽은 리소스를 늘 끊고 내며, 그동안 일반 효과음은 끊지 않는다(0x443f0a·0x443f4b)', () => {
  const f = fake();
  const sound = new Sound(exe, f.player);
  sound.call(['load', 0xd0086, 3]);
  sound.call(['ui', 1]);
  sound.call(['play', 3]); // 끊고 낸다
  sound.call(['ui', 12]); // 상태 2: 우선순위가 높아도 SND_NOSTOP
  sound.call(['load', 0xd0087, 0]); // 상태 2면 먼저 끈다(0x443f84)
  sound.call(['ui', 12]);
  expect(f.log).toEqual(['냄 8a', '냄 86', '무시 98', '끔', '냄 98']);
});

it('반복음은 울리는 중이면 걸리지 않고, 다음 일반 효과음이 끊는다(0x443e38)', () => {
  const f = fake();
  const sound = new Sound(exe, f.player);
  sound.call(['ui', 4]);
  sound.call(['loop', 6]); // 울리는 중: SND_NOSTOP
  f.end();
  sound.call(['loop', 6]);
  sound.call(['loop', 6]); // 반복 중이라 무시
  sound.call(['ui', 7]); // 우선순위 1 ≥ 0: 끊는다
  expect(f.log).toEqual(['냄 8d', '무시 8f', '반복 8f', '무시 8f', '냄 90']);
});

it('연출 효과음(0x443f4b)은 반복음도 끊고 내며, 반복 중(상태 3)의 미리 읽기는 끄지 않는다. 한 번도 읽지 않은 칸은 빈 소리, 읽은 칸은 다음 읽기까지 남는다', () => {
  const f = fake();
  const sound = new Sound(exe, f.player);
  sound.call(['play', 1]); // 처음부터 빈 칸(원작은 0으로 찬 버퍼): 앞 소리만 끊긴다
  f.end();
  sound.call(['loop', 6]);
  sound.call(['load', 0xd0086, 2]); // 상태 3: 끄지 않는다(상태 2일 때만 0x443f84)
  sound.call(['play', 2]); // 반복음을 끊고 낸다
  sound.call(['load', 0xd0087, 0]); // 상태 2: 먼저 끈다
  sound.call(['play', 2]); // 다른 칸을 읽어도 칸 2는 그대로
  expect(f.log).toEqual(['냄 -1', '반복 8f', '냄 86', '끔', '냄 86']);
});

it('재생기는 DATA13마다 하나만 만들고(AudioContext를 판마다 새로 만들지 않음), Web Audio가 없으면 소리 없이 돈다', () => {
  const made: unknown[] = [];
  vi.stubGlobal(
    'AudioContext',
    class {
      state = 'running';
      constructor() {
        made.push(this);
      }
      decodeAudioData() {
        return Promise.resolve({});
      }
    },
  );
  const dat = { entryCount: 2, read: () => new Uint8Array([1, 2]) } as unknown as VmDat;
  expect(webPlayer(dat)).toBe(webPlayer(dat));
  expect(made).toHaveLength(1);
  vi.stubGlobal('AudioContext', undefined);
  const silent = webPlayer({ entryCount: 0, read: () => new Uint8Array() } as unknown as VmDat);
  expect(silent.play(0x89, false, false)).toBe(true);
  vi.unstubAllGlobals();
});

it('WAV는 RIFF 길이(+ 8)까지: 한국어판 DATA13은 항목마다 131072바이트 칸을 0으로 채운다. 길이가 맞거나 RIFF가 아니면 그대로', () => {
  const wav = (riff: number, size: number) => {
    const b = new Uint8Array(size);
    b.set([0x52, 0x49, 0x46, 0x46]);
    new DataView(b.buffer).setUint32(4, riff, true);
    return b;
  };
  expect(wavBytes(wav(100, 200)).length).toBe(108);
  const exact = wav(100, 108);
  expect(wavBytes(exact)).toBe(exact);
  const notRiff = new Uint8Array(200);
  expect(wavBytes(notRiff)).toBe(notRiff);
  const short = Uint8Array.of(0x52, 0x49, 0x46, 0x46);
  expect(wavBytes(short)).toBe(short);
});
