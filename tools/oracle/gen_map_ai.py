"""맵별 AI 표(0x44c8c3) 정답 픽스처: 맵 52개마다 원작이 DATA10에서 읽어 둔 표 네 개의 해시. 실행: pnpm oracle map_ai

0x44c8c3(맵)은 리소스(표 0x460634[맵] = DATA10 0xac + 맵 × 2)를 작업 버퍼(0x43ff60)로 읽어, 크기가 0x320c8이면
0x4ead6c(i32 32×32 × 25층), 0x4d1c70(같은 크기), 0x4ceff0(i32 25개), 0x503d70(i32 25개)로 복사한다. 아니면 0x44c5a2로 계산한다(52맵 모두 자료가 있다).
"""
import hashlib
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from boot import Booted  # noqa: E402
from fixture import write_fixture  # noqa: E402
from original import read_original  # noqa: E402

LOAD_AI = 0x44C8C3
REGIONS = {'penalty': (0x4EAD6C, 0x19000), 'value': (0x4D1C70, 0x19000), 'penaltyMax': (0x4CEFF0, 100), 'valueMax': (0x503D70, 100)}


def main() -> None:
    exe = read_original('vmv2.exe')
    cases = []
    for index in range(52):
        vm = Booted(exe)
        vm.call(LOAD_AI, index)
        cases.append({'args': {'map': index},
                      'expected': {name: hashlib.sha256(vm.read(at, size)).hexdigest() for name, (at, size) in REGIONS.items()}})
    write_fixture('mapAi', LOAD_AI, cases)


if __name__ == '__main__':
    main()
