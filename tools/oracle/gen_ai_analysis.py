"""CPU AI 분석 단계 정답 픽스처: 진영 분석(0x44b207)과 유닛 가중치(0x445d57 생각, 0x446106 결정). 실행: pnpm oracle ai_analysis

시간 진행 픽스처처럼 준비한 전투(소환, OA·상태 이상·MP·시각·물높이를 흔듦)에서 네이티얼 레벨·HP와 예전 가중치(유닛 +0x60·+0x64)도 흔든 뒤,
행동 주체(0x4cda50)를 정하고 0x44b207(0)·0x44b207(1)·0x445d57()을 부른다. 진영 점수(0x4ead64)·상태 이상 위협(0x4cefe8)과
칸마다 가중치를 적고, 0x446106()을 부른 뒤 가중치를 다시 적는다. 원작 반복은 풀기 마법 네이티얼에서 끝나 그 뒤 칸은 예전 가중치를 둔다.
"""
import os
import struct
import sys

sys.path.insert(0, os.path.dirname(__file__))
from battle import BLOCK, UNIT_COUNT, encode_block, i32, packed_block, refresh_stats, set_i32, unit  # noqa: E402
from fixture import write_fixture  # noqa: E402
from gen_advance_time import prepare  # noqa: E402
from original import read_original  # noqa: E402

SIDE_ANALYSIS = 0x44B207
THINK_WEIGHTS = 0x445D57
DECIDE_WEIGHTS = 0x446106
ACTOR = 0x4CDA50
SCORES = 0x4EAD64
THREATS = 0x4CEFE8
CASES = 300


def weights(vm) -> list:
    return [None if vm.u32(unit(i)) & 0x8000 else [i32(vm, unit(i) + 0x60), i32(vm, unit(i) + 0x64)] for i in range(vm.u32(UNIT_COUNT))]


def make_case(exe: bytes, k: int) -> dict:
    vm, rng = prepare(exe, 12000 + k)
    count = vm.u32(UNIT_COUNT)
    for i in range(count):
        if vm.u32(unit(i)) & 0x8000:
            continue
        if i >= 2:
            set_i32(vm, unit(i) + 0x2C, rng.randrange(3))  # 레벨
        set_i32(vm, unit(i) + 0x30, rng.randrange(1, 11))  # HP(풀기 마법은 HP > 2인 유닛만 셈)
        if rng.random() < 0.5:  # 예전 생각이 남긴 가중치
            set_i32(vm, unit(i) + 0x60, rng.randrange(1, 40000))
            set_i32(vm, unit(i) + 0x64, rng.randrange(1, 40000))
    refresh_stats(vm)
    live = [i for i in range(count) if not vm.u32(unit(i)) & 0x8000]
    actor = rng.choice(live)
    before = weights(vm)
    block = packed_block(vm)
    holes = [i for i in range(count) if vm.u32(unit(i)) & 0x8000]
    vm.set_u32(ACTOR, unit(actor))
    for side in (0, 1):
        vm.call(SIDE_ANALYSIS, side)
    vm.call(THINK_WEIGHTS)
    think = weights(vm)
    vm.call(DECIDE_WEIGHTS)
    return {'args': {'map': i32(vm, BLOCK + 0x2D4), 'block': encode_block(block), 'holes': holes, 'actor': actor, 'weights': before},
            'expected': {'scores': [i32(vm, SCORES), i32(vm, SCORES + 4)], 'threats': [i32(vm, THREATS), i32(vm, THREATS + 4)],
                         'think': think, 'decide': weights(vm)}}


def main() -> None:
    exe = read_original('vmv2.exe')
    write_fixture('aiAnalysis', SIDE_ANALYSIS, [make_case(exe, k) for k in range(CASES)])


if __name__ == '__main__':
    main()
