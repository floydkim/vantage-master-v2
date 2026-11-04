"""사거리(0x41074b)와 효과 범위(0x410d77) 정답 픽스처. 실행: pnpm oracle range

시간 진행 픽스처처럼 준비한 전투에서 작업 격자를 다시 만든 뒤, 원점(유닛 칸 또는 아무 칸)·대상 칸(대개 가까이)·행동을 골라 원작 함수를
직접 부른다. 범위 종류 1(포물선)은 부동소수 계산을 거친다. 대상 칸은 효과 반경 근처·사거리 근처·아무 칸에서 고르고,
유닛을 사이에 둔 쌍(시야를 유닛이 가리는 분기)을 더한다.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from battle import BLOCK, UNIT_COUNT, encode_block, i32, packed_block, rebuild_terrain, unit  # noqa: E402
from fixture import write_fixture  # noqa: E402
from gen_advance_time import prepare  # noqa: E402
from original import read_original  # noqa: E402

IN_RANGE = 0x41074B
IN_AREA = 0x410D77
CASES = 120
PAIRS = 25  # 경우마다 고르는 (원점, 대상, 행동) 수
THROUGH_UNIT_PAIRS = 10  # 유닛을 사이에 둔 쌍: 시야를 유닛이 가리는 분기
SIGHT_ACTIONS = (2, 3, 4, 5, 6, 7, 8, 9, 27, 21, 33)  # 범위 종류 1(포물선)·2(직선 시야)
STEP_X = ((-1, -1, 0, 1, 0, -1), (-1, 0, 1, 1, 1, 0))  # [y & 1][방향]
STEP_Y = (0, -1, -1, 0, 1, 1)


def walk(x: int, y: int, d: int, n: int):
    for _ in range(n):
        x, y = x + STEP_X[y & 1][d], y + STEP_Y[d]
    return (x, y) if 0 <= x < 32 and 0 <= y < 32 else None


def make_case(exe: bytes, k: int) -> dict:
    vm, rng = prepare(exe, 7000 + k)
    rebuild_terrain(vm)
    count = vm.u32(UNIT_COUNT)
    block = packed_block(vm)
    pairs = []
    for _ in range(PAIRS):
        if rng.random() < 0.5:
            x, y = vm.read(vm.u32(unit(rng.randrange(count)) + 0x68), 2)
        else:
            x, y = rng.randrange(32), rng.randrange(32)
        r = rng.random()
        if r < 0.3:    # 효과 반경(1·2) 안팎
            tx, ty = min(max(x + rng.randrange(-2, 3), 0), 31), min(max(y + rng.randrange(-2, 3), 0), 31)
        elif r < 0.85:
            tx, ty = min(max(x + rng.randrange(-8, 9), 0), 31), min(max(y + rng.randrange(-8, 9), 0), 31)
        else:
            tx, ty = rng.randrange(32), rng.randrange(32)
        action = rng.randrange(34)
        pairs.append([x, y, tx, ty, action, vm.call(IN_RANGE, x, y, action, tx, ty) & 0xFF, vm.call(IN_AREA, action, x, y, tx, ty) & 0xFF])
    for _ in range(THROUGH_UNIT_PAIRS):
        ux, uy = vm.read(vm.u32(unit(rng.randrange(count)) + 0x68), 2)
        d = rng.randrange(6)
        origin, target = walk(ux, uy, (d + 3) % 6, rng.randrange(1, 4)), walk(ux, uy, d, rng.randrange(1, 4))
        if origin and target:
            (x, y), (tx, ty), action = origin, target, rng.choice(SIGHT_ACTIONS)
            pairs.append([x, y, tx, ty, action, vm.call(IN_RANGE, x, y, action, tx, ty) & 0xFF, vm.call(IN_AREA, action, x, y, tx, ty) & 0xFF])
    return {'args': {'map': i32(vm, BLOCK + 0x2D4), 'block': encode_block(block)}, 'expected': {'pairs': pairs}}


def main() -> None:
    exe = read_original('vmv2.exe')
    write_fixture('range', IN_RANGE, [make_case(exe, k) for k in range(CASES)])


if __name__ == '__main__':
    main()
