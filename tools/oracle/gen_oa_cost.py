"""OA 비용(0x4113da) 정답 픽스처. 실행: pnpm oracle oa_cost"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from fixture import write_fixture  # noqa: E402
from original import read_original  # noqa: E402
from vm import Vm  # noqa: E402

OA_COST = 0x4113DA  # vmv2.exe: (속도, 이동함, 행동 번호) → OA


def main() -> None:
    exe = read_original('vmv2.exe')
    cases = []
    for speed in range(21):
        for moved in (False, True):
            for action in range(34):
                result = Vm(exe).call(OA_COST, speed, 1 if moved else 0, action)
                cases.append({'args': {'speed': speed, 'moved': moved, 'action': action},
                              'expected': result if result < 0x80000000 else result - 0x100000000})
    write_fixture('oaCost', OA_COST, cases)


if __name__ == '__main__':
    main()
