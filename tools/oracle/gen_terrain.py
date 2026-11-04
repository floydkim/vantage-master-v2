"""작업 격자(0x4071bd)와 지형 그래프(0x440210) 정답 픽스처. 실행: pnpm oracle terrain

원작 프리 배틀을 준비한 뒤 물높이(−1·0·1)와 마정석 소유를 시드 고정 난수로 바꾸고 작업 격자와 그래프를 다시 만든다.
그래프는 이동 타입마다 0x7c00바이트라 SHA-256만 담는다.
"""
import base64
import hashlib
import os
import random
import sys
import zlib

sys.path.insert(0, os.path.dirname(__file__))
from battle import BLOCK, GRAPHS, WORK_GRID, i32, rebuild_terrain, set_i32, start_free_battle  # noqa: E402
from fixture import write_fixture  # noqa: E402
from original import read_original  # noqa: E402

GRAPH_SIZE = 0x7C00


def make_case(exe: bytes, map_index: int, level: int) -> dict:
    rng = random.Random(map_index * 3 + level)
    vm = start_free_battle(exe, map_index)
    owners = [rng.randrange(3) for _ in range(i32(vm, BLOCK + 0xB9C))]
    for n, owner in enumerate(owners):
        vm.write(BLOCK + 0xA1C + n * 3 + 2, bytes([owner]))
    set_i32(vm, BLOCK + 0xBA0, level)
    rebuild_terrain(vm)
    grid = vm.read(vm.u32(vm.u32(WORK_GRID)), 0x800)
    graphs = [hashlib.sha256(vm.read(GRAPHS + t * GRAPH_SIZE, GRAPH_SIZE)).hexdigest() for t in range(5)]
    return {'args': {'map': map_index, 'waterLevel': level, 'owners': owners},
            'expected': {'grid': base64.b64encode(zlib.compress(grid, 9)).decode(), 'graphs': graphs}}


def main() -> None:
    exe = read_original('vmv2.exe')
    write_fixture('terrain', 0x440210, [make_case(exe, m, level) for m in range(52) for level in (-1, 0, 1)])


if __name__ == '__main__':
    main()
