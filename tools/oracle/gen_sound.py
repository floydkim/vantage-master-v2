"""효과음 호출 정답 픽스처. 실행: pnpm oracle sound

gen_attack·gen_magic·gen_turn의 경우를 그대로 다시 돌리며 효과음 함수 넷의 대역을 기록기로 바꾼다:
0x443d19(번호) 'ui', 0x443e38(번호) 'loop', 0x443f0a(리소스, 칸) 'load', 0x443f4b(칸) 'play'.
틱은 시작한 타이머(0x403020) 호출 수 − 1이다(CPU 결정·걷기 시작은 −1). 원래 정답 파일은 덮어쓰지 않는다.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import gen_attack  # noqa: E402
import gen_magic  # noqa: E402
import gen_turn  # noqa: E402
from fixture import write_fixture  # noqa: E402
from gen_walk import TIMER  # noqa: E402
from vm import Vm  # noqa: E402

NAMES = {0x443D19: 'ui', 0x443E38: 'loop', 0x443F0A: 'load', 0x443F4B: 'play'}
calls: list = []
ticks = [0]

stub_function = Vm.stub_function
call = Vm.call


def recording_stub(self, address, nargs, handler):
    if address in NAMES:
        handler = lambda vm, *a, name=NAMES[address]: calls.append([ticks[0] - 1, name, *a]) or 0  # noqa: E731
    stub_function(self, address, nargs, handler)


def counting_call(self, address, *args, **kw):
    if address == TIMER:
        ticks[0] += 1
    return call(self, address, *args, **kw)


Vm.stub_function = recording_stub
Vm.call = counting_call


def recorded(make_case, kind):
    def wrapped(*a, **kw):
        calls.clear()
        ticks[0] = 0
        case = make_case(*a, **kw)
        return {'label': case['label'], 'kind': kind, 'calls': list(calls)}
    return wrapped


def main() -> None:
    cases = []
    for mod, kind in ((gen_attack, 'attack'), (gen_magic, 'magic'), (gen_turn, 'turn')):
        mod.make_case = recorded(mod.make_case, kind)
        mod.write_fixture = lambda name, fn, got: cases.extend(got)
        mod.main()
    write_fixture('sound', 0x443D19, cases)


if __name__ == '__main__':
    main()
