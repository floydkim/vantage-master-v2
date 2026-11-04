"""이동 범위(0x4404c9) 정답 픽스처. 실행: pnpm oracle movement_range

시간 진행 픽스처처럼 소환하고 값을 흔든 전투(gen_advance_time.prepare)에서 유닛 방향과 마정석 소유도 난수로 바꾸고 작업 격자·그래프를
다시 만든 뒤, 유닛 하나의 이동 범위를 원작으로 계산한다. 작업 버퍼(0x4c4bf0, 0x7c00바이트)는 SHA-256과 도달 칸 목록만 담는다.
뒤쪽 경우는 실행 중 이동력(유닛 +0x48)을 11~40으로 키운다. 비용 11 이상에서 칸의 비용별 배열이 +0x13 바이트를 덮는 원작 동작을 확인한다
(실제 이동력은 최대 7).
"""
import hashlib
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from battle import BLOCK, UNIT_COUNT, encode_block, gather_units, i32, packed_block, rebuild_terrain, unit  # noqa: E402
from fixture import write_fixture  # noqa: E402
from gen_advance_time import prepare  # noqa: E402
from original import read_original  # noqa: E402

MOVEMENT_RANGE = 0x4404C9
WORK = 0x4C4BF0
WORK_SIZE = 0x7C00
CASES = 300
HIGH_MOVEMENT_CASES = 20


def make_case(exe: bytes, k: int, high_movement: bool = False) -> dict:
    vm, rng = prepare(exe, 2000 + k)
    count = vm.u32(UNIT_COUNT)
    for i in range(count):
        vm.write(vm.u32(unit(i) + 0x68) + 0x0A, bytes([rng.randrange(6)]))  # 방향
    for n in range(i32(vm, BLOCK + 0xB9C)):
        vm.write(BLOCK + 0xA1C + n * 3 + 2, bytes([rng.randrange(3)]))     # 마정석 소유
    rebuild_terrain(vm)
    gather_units(vm, rng)  # 멈출 수 있는 칸에 모아 이동이 실제로 일어나게
    mover = rng.randrange(count)
    movement = rng.randrange(11, 41) if high_movement else None
    if movement is not None:
        vm.write(unit(mover) + 0x48, movement.to_bytes(4, 'little'))
    block = packed_block(vm)
    vm.call(MOVEMENT_RANGE, unit(mover))
    work = vm.read(WORK, WORK_SIZE)
    reached = [[work[c * 31], work[c * 31 + 1]] for c in range(1024) if work[c * 31 + 0x12] & 8]
    args = {'map': i32(vm, BLOCK + 0x2D4), 'block': encode_block(block), 'mover': mover}
    if movement is not None:
        args['movement'] = movement
    return {'args': args,
            'expected': {'work': hashlib.sha256(work).hexdigest(), 'reached': reached}}


def main() -> None:
    exe = read_original('vmv2.exe')
    cases = [make_case(exe, k) for k in range(CASES)]
    cases += [make_case(exe, CASES + k, high_movement=True) for k in range(HIGH_MOVEMENT_CASES)]
    write_fixture('movementRange', MOVEMENT_RANGE, cases)


if __name__ == '__main__':
    main()
