"""BGM 상태 기계(0x443770 곡 바꾸기·0x443847 끝 알림·0x44372e 설정 적용) 정답 픽스처. 실행: pnpm oracle bgm

MCI를 부르는 함수는 기록 대역이다: CD 재생 0x443973, MIDI 열고 재생 0x443b26, MIDI 다시 0x443beb, CD 멈춤 0x443a62, MIDI 닫기 0x443c5a,
CD 닫기 0x443a95, CD 열기 0x4438ed. 대역의 성공·실패를 단계마다 고른다. 장치 id는 CD 0x4cd69c = 9, MIDI 0x4cd694 = 7.
단계마다 부른 것, 지금 곡 0x4cd698, 틀고 있음 0x4cd690을 적는다. 해독 메모 notes_options.md §3.5
"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from boot import Booted  # noqa: E402
from fixture import write_fixture  # noqa: E402
from original import read_original  # noqa: E402

OPT, DEVICE, CURRENT, PLAYING, CD_ID, MIDI_ID = 0x503FF0, 0x4CD688, 0x4CD698, 0x4CD690, 0x4CD69C, 0x4CD694
STUBS = {0x443973: 'cdPlay', 0x443B26: 'midiPlay', 0x443BEB: 'midiReplay', 0x443A62: 'cdStop', 0x443C5A: 'midiClose', 0x443A95: 'cdClose', 0x4438ED: 'cdOpen'}
EXE = read_original('vmv2.exe')


def signed(v):
    return v - (1 << 32) if v >> 31 else v


def run(start, steps):
    vm = Booted(EXE)
    vm.calls = []
    vm.ok = True
    for at, name in STUBS.items():
        n = 1 if name == 'cdOpen' else 0
        vm.stub_function(at, n, (lambda name: lambda vm, *a: vm.calls.append(name) or (1 if vm.ok else 0))(name))
    vm.set_u32(OPT, (vm.u32(OPT) & 0xFFFF0000) | start['options'])
    vm.set_u32(DEVICE, start['device'])
    vm.set_u32(CURRENT, start['current'] & 0xFFFFFFFF)
    vm.set_u32(PLAYING, start['playing'])
    vm.set_u32(CD_ID, 9)
    vm.set_u32(MIDI_ID, 7)
    out = []
    for step in steps:
        vm.calls = []
        kind = step[0]
        if kind == 'play':
            vm.ok = step[2] if len(step) > 2 else True
            vm.call(0x443770, step[1] & 0xFFFFFFFF)
        elif kind == 'ended':  # (성공 플래그, 장치 id)
            vm.ok = step[3] if len(step) > 3 else True
            vm.call(0x443847, step[1], step[2])
        elif kind == 'apply':
            vm.ok = True
            vm.call(0x44372E)
        elif kind == 'halt':  # Sound OK(0x443511)에서 장치가 바뀌면 쓰기 전에 멈춤(0x44364c → 0x44380e)·CD 닫기(0x443651 → 0x443a95)
            vm.ok = True
            vm.call(0x44380E)
            vm.call(0x443A95)
        elif kind == 'set':  # 옵션·장치를 바꾼다(Sound 대화 상자 OK의 비트·장치 쓰기)
            vm.set_u32(OPT, (vm.u32(OPT) & 0xFFFF0000) | step[1])
            vm.set_u32(DEVICE, step[2])
        out.append({'calls': vm.calls, 'current': signed(vm.u32(CURRENT)), 'playing': vm.u32(PLAYING)})
    return {'kind': 'sequence', 'args': {'start': start, 'steps': steps}, 'expected': {'steps': out}}


def main():
    midi = {'options': 0x77, 'device': 1, 'current': -1, 'playing': 0}
    cd = {'options': 0x77, 'device': 0, 'current': -1, 'playing': 0}
    off = {'options': 0x67, 'device': 1, 'current': -1, 'playing': 0}
    cases = [
        # 타이틀 → 건너뜀 → 월드 → 같은 곡 → 전투 → 결과(이김) → 월드
        run(midi, [['play', 0], ['play', 8], ['play', 1], ['play', 1], ['play', 12], ['play', 2], ['play', 1]]),
        # 끝 알림: 반복 곡(1)은 다시, 비반복(0)은 멈추고 −1, 다른 장치 id·실패 플래그·다시 실패
        run(midi, [['play', 1], ['ended', 1, 7], ['ended', 1, 9], ['ended', 0, 7], ['ended', 1, 7, False], ['play', 1], ['play', 0], ['ended', 1, 7], ['ended', 1, 7]]),
        # 재생 실패 뒤 같은 곡 다시 부르기
        run(midi, [['play', 3, False], ['play', 3], ['play', -1]]),
        # BGM 끈 동안: 곡 번호만, 다시 켜면 그 곡(0x44372e)
        run(off, [['play', 1], ['play', 12], ['set', 0x77, 1], ['apply'], ['set', 0x67, 1], ['apply'], ['play', 2]]),
        # CD 장치: 재생·끝 알림(반복은 CD 다시)·적용(CD 열기)
        run(cd, [['play', 1], ['ended', 1, 9], ['play', 0], ['ended', 1, 9], ['apply'], ['play', 8, False]]),
        # 장치 바꿈: MIDI → CD → MIDI(Sound OK는 멈춤·CD 닫기 뒤 장치를 쓰고 적용)
        run(midi, [['play', 1], ['halt'], ['set', 0x77, 0], ['apply'], ['halt'], ['set', 0x77, 1], ['apply']]),
    ]
    b = Booted(EXE)
    table = []
    for i in range(19):  # 곡 표 0x4742f0: CD 트랙, GM·GS·S8 파일 이름, 반복
        at = 0x4742F0 + i * 0x14
        files = [b.read(b.u32(at + 4 + 4 * k), 16).split(b'\0')[0].decode('latin1') for k in range(3)]
        table.append({'cd': b.u32(at), 'files': files, 'loop': b.u32(at + 0x10)})
    cases.append({'kind': 'table', 'args': {}, 'expected': {'table': table}})
    write_fixture('bgm', 0x443770, cases)


if __name__ == '__main__':
    main()
