import { describe, expect, it } from 'vitest';
import { readDialog } from '../../src/formats/dialogs.ts';
import { Sound } from '../../src/ui/battle/sound.ts';
import { radioGroup } from '../../src/ui/frame/dialogLayout.ts';
import { bgmDevices, customizeApply, customizeInit, DEFAULT_OPTIONS, fallbackDevice, optionClickSounds, readOptions, savedDevice, soundApply, soundInit, usableDevice } from '../../src/ui/frame/options.ts';
import { readGolden } from '../engine/block.ts';
import { exe } from './screenCases.ts';

interface Case {
  readonly kind: 'customize' | 'sound' | 'clicks';
  readonly args: { options?: number; scene?: number; pick?: number[] | null; gs?: number; device?: number };
  readonly expected: { template?: number; initial?: number[]; options?: number; calls?: string[]; water?: number; device?: number; sounds?: Record<string, number[]> };
}
const cases = readGolden<Case>('options');

describe('Customize(0x44ee63)·Sound(0x443511)', () => {
  it('Customize: 처음 라디오·생각 방식 켬, OK 적용(비트 8·7·6·4·0), 전투 중 끈 하늘·물 되돌리기, Cancel은 그대로', () => {
    for (const c of cases.filter((k) => k.kind === 'customize')) {
      const { options, scene, pick } = c.args;
      const label = JSON.stringify(c.args);
      expect(c.expected.template, label).toBe(0x7b);
      const init = customizeInit(options!, scene!);
      expect([init.pattern, init.animation, init.patternEnabled ? 1 : 0], label).toEqual(c.expected.initial);
      if (!pick) {
        expect([c.expected.options, c.expected.calls], label).toEqual([options, []]);
        continue;
      }
      const r = customizeApply(options!, scene!, pick[0] as 0 | 1, pick[1] as 0 | 1 | 2 | 3);
      const calls = [...(r.resetSky ? ['skyOff'] : []), ...(r.resetWater ? ['waterRedraw'] : []), 'flush'];
      expect([r.options, calls, r.resetWater ? 0 : 2], label).toEqual([c.expected.options, c.expected.calls, c.expected.water]);
    }
  });

  it('Sound: 템플릿(GS 파일이 있으면 0x7a), 처음 체크·장치, OK 적용(비트 0x10·0x20, 장치), 멈춤·다시 틀기', () => {
    for (const c of cases.filter((k) => k.kind === 'sound')) {
      const { options, gs, device, pick } = c.args;
      const label = JSON.stringify(c.args);
      const init = soundInit(options!, device!, gs === 1);
      expect([init.template, init.bgm ? 1 : 0, init.effects ? 1 : 0, init.device], label).toEqual([c.expected.template, ...c.expected.initial!]);
      if (!pick) {
        expect([c.expected.options, c.expected.device, c.expected.calls], label).toEqual([options, device, []]);
        continue;
      }
      const r = soundApply(options!, device!, pick[0] === 1, pick[1] === 1, pick[2]);
      const calls = [...(r.stop ? ['stop', 'closeCd'] : []), ...(r.restart ? ['apply'] : [])];
      expect([r.options, r.device, calls], label).toEqual([c.expected.options, c.expected.device, c.expected.calls]);
    }
  });

  it('클릭 소리: 라디오·체크는 4(0x44edf1·0x4434b3), OK·Cancel·다른 id는 처리기 소리 없음', () => {
    const want = cases.find((k) => k.kind === 'clicks')!.expected.sounds!;
    for (const [key, sounds] of Object.entries(want)) {
      const [handler, id] = key.split(' ').map((v) => Number.parseInt(v, 16));
      expect(optionClickSounds(handler === 0x44edf1 ? 0x7b : 0x79, id), key).toEqual(sounds);
    }
  });

  it('자동 라디오 묶음은 WS_GROUP 경계(CheckRadioButton 범위)', () => {
    const customize = readDialog(exe, 0x7b);
    expect(radioGroup(customize, 0x961)).toEqual([0x960, 0x961, 0x962, 0x963]);
    expect(radioGroup(customize, 0xbc2)).toEqual([0xbc1, 0xbc2]);
    expect(radioGroup(readDialog(exe, 0x79), 0x9c7)).toEqual([0x9c6, 0x9c7]);
  });

  it('효과음 비트 0x20이 꺼져 있으면 일반·반복·연출 효과음이 상태도 바꾸지 않는다(0x443d19 등 맨 앞)', () => {
    const played: number[] = [];
    const sound = new Sound(exe, { play: (e) => (played.push(e), true), stop: () => played.push(-1) });
    expect(DEFAULT_OPTIONS & 0x20).toBe(0x20);
    sound.effects = false;
    sound.call(['ui', 1]);
    sound.call(['loop', 9]);
    sound.call(['load', 0x123, 0]);
    sound.call(['play', 0]);
    expect(played).toEqual([]);
    sound.effects = true;
    sound.call(['ui', 1]);
    expect(played.length).toBe(1);
  });

  it('저장소가 없으면 옵션 0x77(0x44e181), BGM 장치는 MIDI(사용자 결정 9: 브라우저 재생이 기본, 원작 기본 CD는 쓰지 않음)', () => {
    expect(readOptions()).toEqual({ options: 0x77, device: 1 });
  });

  it('저장한 장치 GS(2)는 GS 파일이 없어 MIDI(1)로(0x44369a), CD·MIDI·SC-88(녹음)은 그대로', () => {
    expect([0, 1, 2, 3].map(usableDevice)).toEqual([0, 1, 1, 3]);
  });

  it('쓸 수 있는 장치(0 CD, 1 MIDI, 2 GS, 3 SC-88): CD·SC-88은 저장소에 그 곡이 있을 때만, MIDI는 늘, GS는 없음, 서버 출처(null)는 모두', () => {
    expect(bgmDevices(['VMO_WIN/vmv2.exe'])).toEqual([false, true, false, false]);
    expect(bgmDevices(['CDDA/TRACK02.mp3'])).toEqual([true, true, false, false]);
    expect(bgmDevices(['SC88/TRACK05.mp3'])).toEqual([false, true, false, true]);
    expect(bgmDevices(null)).toEqual([true, true, false, true]);
  });

  it('저장된 장치를 쓸 수 없으면 대화 상자 차례로 첫 쓸 수 있는 장치, 쓸 수 있으면 그대로', () => {
    expect(fallbackDevice(0, [false, true, false, true])).toBe(1);
    expect(fallbackDevice(3, [true, true, false, false])).toBe(0);
    expect(fallbackDevice(2, [false, true, false, false])).toBe(1);
    expect(fallbackDevice(0, [true, true, false, false])).toBe(0);
    expect(fallbackDevice(3, [false, true, false, true])).toBe(3);
  });

  it('OK 때 저장할 장치: 지금 쓰는 장치(대체됐을 수 있음)를 바꾸지 않았으면 저장된 선택 그대로(Customize OK·손대지 않은 Sound OK), 바꿨으면 고른 장치', () => {
    expect(savedDevice(1, 1, 0)).toBe(0); // CD를 저장했는데 CD 음악이 없어 MIDI로 대체된 실행
    expect(savedDevice(3, 1, 0)).toBe(3); // 직접 SC-88을 고름
    expect(savedDevice(1, 0, 0)).toBe(1); // 직접 MIDI를 고름
    expect(savedDevice(0, 0, 0)).toBe(0);
  });
});
