"""시간 진행(0x4022d7) 정답 픽스처. 실행: pnpm oracle advance_time

원작 프리 배틀을 첫 시간 진행 직전까지 준비하고(battle.py) 네이티얼을 소환(0x40f910)한 뒤, OA·상태 이상·MP·시각·누적 시각·
수위·Used MP를 시드 고정 난수로 흔든다. 그 상태의 블록(입력)과 0x4022d7(경과 분)을 실행한 뒤의 블록(정답)을 담는다.

실행 전에 연출 대기열(64칸)을 비워 둔다(battle.quiet_screen).
경과 분은 실제 차례 간격 범위(360분 이하)로 둔다. 원작은 한 번에 오래 진행하며 MP 부족이 거듭되면 연출 대기열이 넘쳐 멈춘다.
"""
import os
import random
import struct
import sys

sys.path.insert(0, os.path.dirname(__file__))
from battle import (BLOCK, SUMMON, UNIT_COUNT, encode_block, i32, packed_block, quiet_screen, set_i32,  # noqa: E402
                    side_state, start_free_battle, unit)
from fixture import write_fixture  # noqa: E402
from original import read_original  # noqa: E402
from vm import OracleFault  # noqa: E402

ADVANCE_TIME = 0x4022D7
APPLY_WATER_LEVEL = 0x42562E
CASES = 300
BROKEN_UPKEEP_CASES = 20  # 유지 MP가 네이티얼과 어긋난 손상 블록: 지난 희생자 재사용 경로(원작이 멈추는 경우는 건너뜀)


def prepare(exe: bytes, k: int, ai: bool = False):
    """시드 k로 소환하고 값을 흔든 전투(vm)와, 이어 쓸 난수. ai면 맵별 AI 자료도 읽는다"""
    rng = random.Random(k)
    vm = start_free_battle(exe, k % 52, (rng.randrange(27), rng.randrange(27)), (rng.randrange(40), rng.randrange(40)), ai=ai)
    for side in (0, 1):
        for _ in range(rng.randrange(7)):
            assert vm.call(SUMMON, unit(side), rng.randrange(1, 25), rng.randrange(32), rng.randrange(32)) != 0
    for i in range(vm.u32(UNIT_COUNT)):
        set_i32(vm, unit(i) + 0x4C, rng.randrange(200))                      # OA
        if rng.random() < 0.3:                                               # 상태 이상: 남은 분, 상태 비트(위 비트는 남아야 함)
            set_i32(vm, unit(i) + 0x50, rng.randrange(1, 200))
            vm.write(unit(i) + 0x58, struct.pack('<H', rng.randrange(1, 8) | rng.choice((0, 0x100))))
    sides = vm.u32(0x45E0E8)
    for side in (0, 1):
        max_mp = i32(vm, sides + side * 0xC0 + 0xA4)
        set_i32(vm, side_state(vm, side) + 4, rng.choice((rng.randrange(max_mp + 1), rng.randrange(20))))  # MP: 0~최대, 또는 부족하기 쉬운 값
        set_i32(vm, BLOCK + 0xBB0 + side * 0xE4, rng.randrange(1000))                                  # Used MP
    set_i32(vm, BLOCK + 0x2D8, rng.randrange(1440))                                                      # 하루 중 시각
    set_i32(vm, BLOCK + 0xBAC, rng.choice((rng.randrange(0x22CE0), 0x22CE0 - rng.randrange(1, 300))))   # 누적 시각
    level = rng.choice((-1, 0, 0, 1))
    set_i32(vm, BLOCK + 0xBA0, level)
    vm.call(APPLY_WATER_LEVEL)
    if level != 0:
        set_i32(vm, BLOCK + 0xBA8, rng.randrange(1, 150))  # 물이 돌아올 때까지 남은 분
    quiet_screen(vm)
    return vm, rng


def make_case(exe: bytes, k: int) -> dict:
    vm, rng = prepare(exe, k)
    minutes = rng.choice((0, rng.randrange(1, 60), rng.randrange(60, 361)))
    before = packed_block(vm)
    deficit = vm.call(ADVANCE_TIME, minutes)
    return {'args': {'block': encode_block(before), 'minutes': minutes},
            'expected': {'block': encode_block(packed_block(vm)), 'deficit': deficit}}


def make_broken_upkeep_case(exe: bytes, k: int):
    """유지 MP를 실제 네이티얼보다 크게 두고 MP를 낮춘다. 원작이 초기화되지 않은 희생자·연출 대기열 넘침·끝나지 않는 반복으로 멈추면 None"""
    vm, rng = prepare(exe, 5000 + k)
    for side in (0, 1):
        at = side_state(vm, side)
        set_i32(vm, at + 0x10, i32(vm, at + 0x10) + rng.randrange(10, 60))  # 유지 MP
        set_i32(vm, at + 4, rng.randrange(10))                              # MP
    minutes = rng.randrange(60, 241)
    before = packed_block(vm)
    try:
        deficit = vm.call(ADVANCE_TIME, minutes, limit=2_000_000)  # 정상 진행은 수십만 명령 안에 끝난다
    except (OracleFault, RuntimeError):
        return None
    return {'args': {'block': encode_block(before), 'minutes': minutes},
            'expected': {'block': encode_block(packed_block(vm)), 'deficit': deficit}}


def main() -> None:
    exe = read_original('vmv2.exe')
    cases = [make_case(exe, k) for k in range(CASES)]
    broken = (make_broken_upkeep_case(exe, k) for k in range(200))
    cases += [c for c in broken if c][:BROKEN_UPKEEP_CASES]
    write_fixture('advanceTime', ADVANCE_TIME, cases)


if __name__ == '__main__':
    main()
