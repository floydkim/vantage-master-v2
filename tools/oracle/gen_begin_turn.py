"""차례 진행(0x40536c) 정답 픽스처. 실행: pnpm oracle begin_turn

0x40536c는 HP가 1 미만인 네이티얼을 정리하고(0x412843), OA + 상태 이상 남은 분이 가장 작은 유닛을 고른 뒤(0x4129fb) 그만큼 시간을
진행한다(0x4022d7). MP가 모자라 네이티얼을 없앴으면 다음 프레임에 처음부터 다시 한다. 픽스처는 다음 처리기(0x476b2c)가 0x40536c가
아닐 때까지 되풀이한 뒤의 블록과 차례를 받은 유닛(압축 레코드 순서)을 담는다.
경우: 전투 시작 직후(맵 52개 × 기본·변형 진영)와, 시간 진행 픽스처처럼 흔들고 네이티얼 일부의 HP를 0으로 둔 상태.
"""
import os
import random
import sys

sys.path.insert(0, os.path.dirname(__file__))
from battle import BLOCK, UNIT_COUNT, UNITS, UNIT_SIZE, encode_block, packed_block, quiet_screen, set_i32, start_free_battle, unit  # noqa: E402
from fixture import write_fixture  # noqa: E402
from gen_advance_time import prepare  # noqa: E402
from original import read_original  # noqa: E402

BEGIN_TURN = 0x40536C
NEXT_HANDLER = 0x476B2C  # 다음 프레임에 부를 처리기
ACTOR = 0x476B04         # 차례를 받은 유닛
SHAKEN = 200


def run(vm) -> dict:
    before = packed_block(vm)
    passes = 0
    while True:
        vm.call(BEGIN_TURN)
        passes += 1
        if vm.u32(NEXT_HANDLER) != BEGIN_TURN:
            break
    slot = (vm.u32(ACTOR) - UNITS) // UNIT_SIZE
    actor = sum(1 for i in range(slot) if not vm.u32(unit(i)) & 0x8000)  # 빈 칸을 건너뛴 압축 레코드 순서
    return {'args': {'block': encode_block(before)}, 'expected': {'block': encode_block(packed_block(vm)), 'actor': actor, 'passes': passes}}


def main() -> None:
    exe = read_original('vmv2.exe')
    cases = []
    for map_index in range(52):
        for masters, levels in (((0, 1), (24, 24)), ((map_index % 27, (map_index + 13) % 27), (map_index * 7 % 40, map_index * 11 % 40))):
            vm = start_free_battle(exe, map_index, masters, levels)
            quiet_screen(vm)
            cases.append(run(vm))
    for k in range(SHAKEN):
        vm, rng = prepare(exe, 1000 + k)
        if rng.random() < 0.5:
            set_i32(vm, BLOCK + 0x2D8, rng.randrange(24) * 60 + 59)  # 곧 정각: MP 처리가 일어나기 쉽게
        for i in range(2, vm.u32(UNIT_COUNT)):
            if rng.random() < 0.25:
                set_i32(vm, unit(i) + 0x30, 0)  # 공격 등으로 쓰러져 아직 정리되지 않은 네이티얼
        cases.append(run(vm))
    write_fixture('beginTurn', BEGIN_TURN, cases)


if __name__ == '__main__':
    main()
