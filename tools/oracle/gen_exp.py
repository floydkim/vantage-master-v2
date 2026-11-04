"""경험치 반영(0x4147f2 → 연출 0x4167a4 → 0x412cc9) 정답 픽스처. 실행: pnpm oracle exp

시간 진행 픽스처처럼 준비한 전투에서 네이티얼 하나의 레벨·경험치를 난수로 두고, 얻은 경험치(음수 포함)를 원작 경험치 연출을 끝까지
돌려 반영한다. 전후 블록을 담는다.
"""
import os
import struct
import sys

sys.path.insert(0, os.path.dirname(__file__))
from battle import BLOCK, EFFECT_COUNT, UNIT_COUNT, encode_block, i32, packed_block, refresh_stats, unit  # noqa: E402
from fixture import write_fixture  # noqa: E402
from gen_advance_time import prepare  # noqa: E402
from original import read_original  # noqa: E402

START_EXP = 0x4147F2
EXP_EFFECT = 0x4167A4
EFFECTS = 0x47A3A8
CASES = 200


def make_case(exe: bytes, k: int) -> dict:
    seed = 8000 + k
    while True:  # 네이티얼이 있는 전투가 나올 때까지 시드를 넘긴다
        vm, rng = prepare(exe, seed)
        if vm.u32(UNIT_COUNT) > 2:
            break
        seed += 1000
    target = rng.randrange(2, vm.u32(UNIT_COUNT))
    vm.write(unit(target) + 0x2C, struct.pack('<i', rng.randrange(3)))    # 레벨
    vm.write(unit(target) + 0x54, struct.pack('<i', rng.randrange(101)))  # 경험치
    refresh_stats(vm)
    gain = rng.randrange(-20, 151)
    before = packed_block(vm)
    vm.call(START_EXP, unit(target), gain)
    slot = next(EFFECTS + i * 0x7C for i in range(vm.u32(EFFECT_COUNT))
                if vm.u32(EFFECTS + i * 0x7C) == EXP_EFFECT and not vm.u32(EFFECTS + i * 0x7C + 0x28) & 0x80000000)
    for _ in range(1000):
        if vm.u32(slot + 0x28) & 0x80000000:
            break
        vm.call(EXP_EFFECT, slot, 1, 1)
    else:
        raise AssertionError('경험치 연출이 끝나지 않았습니다')
    return {'args': {'block': encode_block(before), 'unit': target, 'gain': gain}, 'expected': {'block': encode_block(packed_block(vm))}}


def main() -> None:
    exe = read_original('vmv2.exe')
    write_fixture('exp', START_EXP, [make_case(exe, k) for k in range(CASES)])


if __name__ == '__main__':
    main()
