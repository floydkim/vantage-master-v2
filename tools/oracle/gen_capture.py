"""마정석 점령(0x401616 판정, 0x401401 점령) 정답 픽스처. 실행: pnpm oracle capture

시간 진행 픽스처처럼 준비한 전투에서 마정석 소유를 난수로 바꾸고 작업 격자를 다시 만든 뒤, 마정석 칸(대부분) 또는 아무 칸과 진영을
골라 점령할 수 있는지 묻고, 마정석이면 점령한다. 점령 전후 블록과 점령 뒤 작업 격자를 담는다.
"""
import base64
import os
import sys
import zlib

sys.path.insert(0, os.path.dirname(__file__))
from battle import BLOCK, WORK_GRID, encode_block, i32, packed_block, rebuild_terrain  # noqa: E402
from fixture import write_fixture  # noqa: E402
from gen_advance_time import prepare  # noqa: E402
from original import read_original  # noqa: E402

CAN_CAPTURE = 0x401616
CAPTURE = 0x401401
CASES = 200


def make_case(exe: bytes, k: int) -> dict:
    vm, rng = prepare(exe, 4000 + k)
    stones = [tuple(vm.read(BLOCK + 0xA1C + n * 3, 2)) for n in range(i32(vm, BLOCK + 0xB9C))]
    for n in range(len(stones)):
        vm.write(BLOCK + 0xA1C + n * 3 + 2, bytes([rng.randrange(3)]))
    for side in (0, 1):  # 회복 배수를 소유와 맞춘다(2 + 보유 수)
        owned = sum(1 for n in range(len(stones)) if vm.read(BLOCK + 0xA1C + n * 3 + 2, 1)[0] == side + 1)
        vm.write(BLOCK + 0x9EC + side * 0x18 + 0xC, (2 + owned).to_bytes(4, 'little'))
    rebuild_terrain(vm)
    x, y = rng.choice(stones) if stones and rng.random() < 0.8 else (rng.randrange(32), rng.randrange(32))
    side = rng.randrange(2)
    before = packed_block(vm)
    can = vm.call(CAN_CAPTURE, x, y, side) & 0xFF
    is_stone = (x, y) in stones
    if is_stone:
        vm.call(CAPTURE, x, y, side)
    grid = vm.read(vm.u32(vm.u32(WORK_GRID)), 0x800)
    return {'args': {'map': i32(vm, BLOCK + 0x2D4), 'block': encode_block(before), 'x': x, 'y': y, 'side': side, 'stone': is_stone},
            'expected': {'canCapture': can, 'block': encode_block(packed_block(vm)),
                         'grid': base64.b64encode(zlib.compress(grid, 9)).decode()}}


def main() -> None:
    exe = read_original('vmv2.exe')
    write_fixture('capture', CAPTURE, [make_case(exe, k) for k in range(CASES)])


if __name__ == '__main__':
    main()
