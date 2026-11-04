import { describe, expect, it, vi } from 'vitest';
import { battleTrack, Bgm, type BgmDevice, readBgmTable } from '../../src/ui/sound/bgm.ts';
import { readGolden } from '../engine/block.ts';
import { exe, mapOf } from './screenCases.ts';

type Step = ['play', number, boolean?] | ['ended', number, number, boolean?] | ['apply'] | ['halt'] | ['set', number, number];
interface Case {
  readonly kind: 'sequence' | 'table';
  readonly args: { start?: { options: number; device: number; current: number; playing: number }; steps?: Step[] };
  readonly expected: { steps?: { calls: string[]; current: number; playing: number }[]; table?: { cd: number; files: string[]; loop: number }[] };
}
const cases = readGolden<Case>('bgm');
const table = readBgmTable(exe);

// 원작 MCI 대역과 같은 이름으로 부른 것을 적는 가짜 장치. ok는 단계마다 고른 성공·실패
function devices(log: string[], ok: { value: boolean }): { cd: BgmDevice; midi: BgmDevice; sc88: BgmDevice } {
  return {
    cd: { play: () => (log.push('cdPlay'), ok.value), replay: () => (log.push('cdPlay'), ok.value), stop: () => log.push('cdStop'), open: () => log.push('cdOpen'), close: () => log.push('cdClose') },
    midi: { play: () => (log.push('midiPlay'), ok.value), replay: () => (log.push('midiReplay'), ok.value), stop: () => log.push('midiClose') },
    sc88: { play: () => (log.push('sc88Play'), ok.value), replay: () => (log.push('sc88Replay'), ok.value), stop: () => log.push('sc88Close') },
  };
}

describe('BGM(0x443770·0x443847·0x44372e)', () => {
  it('곡 표 0x4742f0: CD 트랙·파일 이름·반복', () => {
    expect(table).toEqual(cases.find((k) => k.kind === 'table')!.expected.table!.map((t) => ({ cd: t.cd, files: t.files, loop: t.loop !== 0 })));
  });

  it('곡 바꾸기·같은 곡·끝 알림(반복은 다시, 비반복은 멈추고 −1)·BGM 끔·장치·재생 실패', () => {
    for (const c of cases.filter((k) => k.kind === 'sequence')) {
      const log: string[] = [];
      const ok = { value: true };
      const { start } = c.args;
      const bgm = new Bgm(table, devices(log, ok), start!.options, start!.device);
      c.args.steps!.forEach((s, i) => {
        log.length = 0;
        if (s[0] === 'play') {
          ok.value = s[2] ?? true;
          bgm.play(s[1]);
        } else if (s[0] === 'ended') {
          ok.value = s[3] ?? true;
          // 0x443847(성공 플래그, 장치 id): 지금 장치(CD 9, MIDI 7)에서 온 성공 알림만
          bgm.ended((s[1] & 1) === 1 && s[2] === (bgm.device === 0 ? 9 : 7));
        } else if (s[0] === 'apply') {
          ok.value = true;
          bgm.apply();
        } else if (s[0] === 'halt') {
          ok.value = true;
          bgm.soundOk(bgm.options, bgm.device, { stop: true, restart: false }); // 0x443511 OK의 멈춤·CD 닫기(쓰기·적용은 다음 단계)
        } else bgm.configure(s[1], s[2]);
        const want = c.expected.steps![i];
        expect({ calls: [...log], current: bgm.current, playing: bgm.playing ? 1 : 0 }, `${JSON.stringify(start)} ${i} ${JSON.stringify(s)}`).toEqual(want);
      });
    }
  });

  it('전투 곡은 맵 구조체 +0x2c(0x401a0c): 맵마다 전장 곡 9~18', () => {
    for (let m = 0; m < 52; m++) {
      const t = battleTrack(mapOf(m));
      expect(t >= 9 && t <= 18, `맵 ${m}: ${t}`).toBe(true);
    }
  });
});

describe('BGM 끝·깨우기', () => {
  it('프로그램 끝(0x44371a): 지금 곡을 멈추고 −1, CD 닫기', () => {
    const log: string[] = [];
    const bgm = new Bgm(table, devices(log, { value: true }), 0x10, 1);
    bgm.play(8);
    log.length = 0;
    bgm.close();
    expect({ log, current: bgm.current, playing: bgm.playing }).toEqual({ log: ['midiClose', 'cdClose'], current: -1, playing: false });
  });

  it('Sound OK로 MIDI → CD(0x443511): 옛 장치를 먼저 멈추고 CD 닫기, 그다음 장치를 바꿔 CD 열고 틀기', () => {
    const log: string[] = [];
    const bgm = new Bgm(table, devices(log, { value: true }), 0x10, 1);
    bgm.play(8);
    log.length = 0;
    bgm.soundOk(0x10, 0, { stop: true, restart: true });
    expect(log).toEqual(['midiClose', 'cdClose', 'cdOpen', 'cdPlay']);
  });

  it('틀지 못한 곡(열기 실패)의 끝 알림은 무시한다(0x443847: 틀고 있음 확인)', () => {
    const log: string[] = [];
    const ok = { value: false };
    const bgm = new Bgm(table, devices(log, ok), 0x10, 1);
    bgm.play(8);
    log.length = 0;
    ok.value = true;
    bgm.ended(true);
    expect({ log, current: bgm.current, playing: bgm.playing }).toEqual({ log: [], current: 8, playing: false });
  });

  it('곡 끝 알림은 지금 요청한 곡이 틀고 있을 때만(멈춘 뒤·다음 곡을 여는 동안 온 옛 곡 알림은 버림)', async () => {
    const { MidiDevice } = await import('../../src/ui/sound/midiPlayer.ts');
    const d = new MidiDevice(table);
    const ended: number[] = [];
    d.onEnded = () => ended.push(1);
    d.stop();
    d.songEnded(); // 멈춘 뒤 온 알림
    expect(ended).toEqual([]);
  });


});

describe('장치 3 = SC-88(원작 MCI sequencer의 S8 파일 자리, 리메이크는 SC-88 녹음)', () => {
  it('틀기·반복(끝 알림에 처음부터 replay)·멈춤이 SC-88 장치로 간다', () => {
    const log: string[] = [];
    const bgm = new Bgm(table, devices(log, { value: true }), 0x10, 3);
    bgm.play(1);
    bgm.ended(true);
    bgm.play(8);
    expect(log).toEqual(['sc88Play', 'sc88Replay', 'sc88Close', 'sc88Play']);
  });
});

describe('CD 장치(0x443973: MCI cdaudio로 그 트랙 한 곡)', () => {
  const settle = () => new Promise((r) => setTimeout(r));
  // 오디오 요소 대역: 부른 것을 적고 이벤트를 손으로 낸다
  function fakeAudio() {
    const listeners = new Map<string, () => void>();
    const log: string[] = [];
    const a = {
      src: '',
      currentTime: 5,
      volume: 1,
      play: () => (log.push(`play ${a.src} @${a.currentTime}`), Promise.resolve()),
      pause: () => void log.push('pause'),
      addEventListener: (type: string, f: () => void) => void listeners.set(type, f),
      emit: (type: string) => listeners.get(type)?.(),
      log,
    };
    return a;
  }

  it('곡 번호 → 표의 CD 트랙 파일(/CDDA/TRACKnn.mp3)을 처음부터, 끝 알림은 지금 곡만, 파일이 없으면 실패를 알림', async () => {
    const { RecordingDevice } = await import('../../src/ui/sound/recordingPlayer.ts');
    const a = fakeAudio();
    const d = new RecordingDevice(table, 'CDDA', () => a);
    const ended: number[] = [];
    const failed: number[] = [];
    d.onEnded = () => ended.push(1);
    d.onFailed = (t) => failed.push(t);
    expect(d.play(8)).toBe(true); // 타이틀(CD 트랙 15)
    await settle(); // 주소는 원본 출처에서 비동기로
    expect(a.log).toEqual(['play /CDDA/TRACK15.mp3 @0']);
    a.emit('ended');
    expect(ended).toEqual([1]);
    d.stop();
    a.emit('ended'); // 멈춘 뒤 온 알림은 버림
    expect(ended).toEqual([1]);
    d.play(10); // 전투(CD 트랙 3)
    await settle();
    a.emit('error'); // 파일 없음
    expect(failed).toEqual([10]);
  });

  it('자동 재생 제한(NotAllowedError)이면 첫 사용자 동작 — 마우스 pointerdown·터치·펜 pointerup·키 — 에 다시 튼다(click은 늦음), 한 번만', async () => {
    const { RecordingDevice } = await import('../../src/ui/sound/recordingPlayer.ts');
    const target = new EventTarget();
    vi.stubGlobal('window', target);
    try {
      for (const gesture of ['pointerdown', 'pointerup', 'keydown']) {
        const a = fakeAudio();
        let blocked = true;
        const play = a.play;
        a.play = () => (blocked ? (play(), Promise.reject({ name: 'NotAllowedError' })) : play());
        new RecordingDevice(table, 'CDDA', () => a).play(8);
        await new Promise((r) => setTimeout(r));
        blocked = false;
        target.dispatchEvent(new Event('click'));
        expect(a.log, gesture).toHaveLength(1);
        target.dispatchEvent(new Event(gesture));
        target.dispatchEvent(new Event(gesture));
        expect(a.log, gesture).toEqual(['play /CDDA/TRACK15.mp3 @0', 'play /CDDA/TRACK15.mp3 @0']);
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('SC-88 녹음도 같은 트랙 번호의 파일(/SC88/TRACKnn.mp3)', async () => {
    const { RecordingDevice } = await import('../../src/ui/sound/recordingPlayer.ts');
    const a = fakeAudio();
    new RecordingDevice(table, 'SC88', () => a).play(8);
    await settle();
    expect(a.log).toEqual(['play /SC88/TRACK15.mp3 @0']);
  });
});

describe('MIDI 장치(0x443b26: MCI sequencer)', () => {
  it('사운드폰트를 받기 전에 AudioContext와 깨우기를 준비한다(사파리는 사용자 동작 안에서만 소리를 허락: 실행 아이콘을 누르는 그 동작이 깨우게), 사운드폰트가 없으면 닫는다', async () => {
    const { MidiDevice } = await import('../../src/ui/sound/midiPlayer.ts');
    const made: { resumed: number; closed: boolean }[] = [];
    vi.stubGlobal(
      'AudioContext',
      class {
        state = 'suspended';
        resumed = 0;
        closed = false;
        constructor() {
          made.push(this);
        }
        resume() {
          this.resumed++;
          return Promise.resolve();
        }
        close() {
          this.closed = true;
          return Promise.resolve();
        }
        addEventListener() {}
      },
    );
    const target = new EventTarget();
    vi.stubGlobal('window', target);
    let answer: (r: Response) => void = () => {};
    vi.stubEnv('BASE_URL', './'); // 하위 경로 배포(GitHub Pages)
    const asked: string[] = [];
    vi.stubGlobal('fetch', (url: string) => (asked.push(url), new Promise<Response>((ok) => (answer = ok))));
    try {
      new MidiDevice(table).prefetch();
      expect(asked).toEqual(['./GeneralUser-GS.sf2']);
      expect(made).toHaveLength(1); // 사운드폰트(32MB)를 받는 중에도
      target.dispatchEvent(new Event('pointerdown'));
      expect(made[0].resumed).toBe(1);
      answer(new Response('', { status: 404 }));
      await new Promise((r) => setTimeout(r));
      expect(made[0].closed).toBe(true);
      target.dispatchEvent(new Event('keydown'));
      expect(made[0].resumed).toBe(1); // 닫은 뒤엔 깨우기도 뗀다
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });
});
