"""이동 실행(0x41377b → 걷기 연출 0x415829, 비행 0x415a11) 정답 픽스처. 실행: pnpm oracle move

이동 범위 픽스처처럼 준비한 전투에서 유닛 하나의 이동 범위(0x4404c9)를 구하고, 멈출 수 있는 칸 하나를 골라 원작 연출을 칸이 비워질
때까지 직접 불러 옮긴다(제자리면 0x406c5b처럼 그대로). 이동 전후 블록을 담는다.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from battle import BLOCK, EFFECT_COUNT, UNIT_COUNT, encode_block, gather_units, i32, packed_block, rebuild_terrain, unit  # noqa: E402
from fixture import write_fixture  # noqa: E402
from gen_advance_time import prepare  # noqa: E402
from original import read_original  # noqa: E402

MOVEMENT_RANGE = 0x4404C9
START_WALK = 0x41377B
WALKS = (0x415829, 0x415A11)  # 걷기, 비행
EFFECTS = 0x47A3A8            # 연출 대기열: 0x7c바이트 × 64, +0x28의 0x80000000 = 빈 칸
WORK = 0x4C4BF0
CASES = 300


def make_case(exe: bytes, k: int) -> dict:
    vm, rng = prepare(exe, 3000 + k)
    count = vm.u32(UNIT_COUNT)
    for i in range(count):
        vm.write(vm.u32(unit(i) + 0x68) + 0x0A, bytes([rng.randrange(6)]))  # 방향
    for n in range(i32(vm, BLOCK + 0xB9C)):
        vm.write(BLOCK + 0xA1C + n * 3 + 2, bytes([rng.randrange(3)]))     # 마정석 소유
    rebuild_terrain(vm)
    gather_units(vm, rng)  # 멈출 수 있는 칸에 모아 이동이 실제로 일어나게
    mover = rng.randrange(count)
    vm.call(MOVEMENT_RANGE, unit(mover))
    work = vm.read(WORK, 0x7C00)
    x, y = rng.choice([(work[c * 31], work[c * 31 + 1]) for c in range(1024) if work[c * 31 + 0x12] & 8])
    before = packed_block(vm)
    position = vm.u32(unit(mover) + 0x68)
    if tuple(vm.read(position, 2)) != (x, y):
        vm.call(START_WALK, unit(mover), x, y)
        slot = next(EFFECTS + i * 0x7C for i in range(vm.u32(EFFECT_COUNT))
                    if vm.u32(EFFECTS + i * 0x7C) in WALKS and not vm.u32(EFFECTS + i * 0x7C + 0x28) & 0x80000000)
        for _ in range(1000):
            if vm.u32(slot + 0x28) & 0x80000000:
                break
            vm.call(vm.u32(slot), slot, 1, 1)
        else:
            raise AssertionError('이동 연출이 끝나지 않았습니다')
    return {'args': {'map': i32(vm, BLOCK + 0x2D4), 'block': encode_block(before), 'mover': mover, 'to': [x, y]},
            'expected': {'block': encode_block(packed_block(vm))}}


def main() -> None:
    exe = read_original('vmv2.exe')
    write_fixture('move', START_WALK, [make_case(exe, k) for k in range(CASES)])


if __name__ == '__main__':
    main()
