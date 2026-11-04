"""전투 계산 정답 픽스처. 실행: pnpm oracle combat

시간 진행 픽스처처럼 준비한 전투에서 네이티얼 레벨·방향·HP·경험치·마정석 소유를 난수로 바꾸고 작업 격자와 네이티얼 능력치(0x40fe72)를
다시 만든 뒤, 공격자·대상·행동을 골라 원작 함수를 직접 부른다: 데미지 0x410fda, 데미지 경험치 0x411484, 상태 이상 경험치 0x411556,
상태 이상 지속 0x411425, 경험치 보정 0x412ca0.
"""
import os
import struct
import sys

sys.path.insert(0, os.path.dirname(__file__))
from battle import BLOCK, UNIT_COUNT, encode_block, i32, packed_block, rebuild_terrain, refresh_stats, unit  # noqa: E402
from fixture import write_fixture  # noqa: E402
from gen_advance_time import prepare  # noqa: E402
from original import read_original  # noqa: E402

DAMAGE = 0x410FDA
DAMAGE_EXP = 0x411484
STATUS_EXP = 0x411556
STATUS_MINUTES = 0x411425
CAPPED_EXP = 0x412CA0
ACTIONS = 34
CASES = 400


def signed(x: int) -> int:
    return struct.unpack('<i', struct.pack('<I', x & 0xFFFFFFFF))[0]


def make_case(exe: bytes, k: int) -> dict:
    vm, rng = prepare(exe, 6000 + k)
    count = vm.u32(UNIT_COUNT)
    for i in range(count):
        vm.write(vm.u32(unit(i) + 0x68) + 0x0A, bytes([rng.randrange(6)]))  # 방향
        vm.write(unit(i) + 0x54, struct.pack('<i', rng.randrange(101)))     # 경험치
        vm.write(unit(i) + 0x30, struct.pack('<i', rng.randrange(1, 11)))   # HP: 회복 상한·쓰러뜨림 경험치 분기
        if i >= 2:
            vm.write(unit(i) + 0x2C, struct.pack('<i', rng.randrange(3)))   # 레벨
    for n in range(i32(vm, BLOCK + 0xB9C)):
        vm.write(BLOCK + 0xA1C + n * 3 + 2, bytes([rng.randrange(3)]))     # 마정석 소유
    rebuild_terrain(vm)
    refresh_stats(vm)
    attacker, target, action = rng.randrange(count), rng.randrange(count), rng.randrange(ACTIONS)
    x, y = rng.randrange(32), rng.randrange(32)
    minutes, gain = rng.randrange(301), rng.randrange(151)
    block = packed_block(vm)
    dealt = signed(vm.call(DAMAGE, unit(attacker), action, x, y, unit(target)))
    return {'args': {'map': i32(vm, BLOCK + 0x2D4), 'block': encode_block(block), 'attacker': attacker, 'target': target,
                     'action': action, 'x': x, 'y': y, 'minutes': minutes, 'gain': gain},
            'expected': {'damage': dealt,
                         'damageExp': signed(vm.call(DAMAGE_EXP, unit(attacker), unit(target), dealt)),
                         'statusExp': signed(vm.call(STATUS_EXP, unit(attacker), unit(target), minutes)),
                         'statusMinutes': signed(vm.call(STATUS_MINUTES, unit(attacker), action)),
                         'cappedExp': signed(vm.call(CAPPED_EXP, unit(attacker), gain))}}


def main() -> None:
    exe = read_original('vmv2.exe')
    write_fixture('combat', DAMAGE, [make_case(exe, k) for k in range(CASES)])


if __name__ == '__main__':
    main()
