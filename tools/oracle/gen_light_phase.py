"""시각별 밝기 정답 픽스처. 실행: pnpm oracle light_phase"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from fixture import write_fixture  # noqa: E402
from original import read_original  # noqa: E402
from vm import SCRATCH, Vm  # noqa: E402

LIGHT_PHASE = 0x402272   # vmv2.exe: () → 0 희미함, 1 낮, 2 밤
MAP_CELL = 0x48391C      # 현재 맵 구조체를 가리키는 포인터의 주소
TIME_POINTER = 0x476AD8  # 하루 중 시각(분)을 가리키는 포인터(정적 초기화 0x401793이 0x4ccae8로 채움)
TIME = 0x4CCAE8


def phase(exe: bytes, minute: int, light_changes: bool, fixed_light: int) -> int:
    vm = Vm(exe)
    cell, map_struct = SCRATCH, SCRATCH + 0x100
    vm.set_u32(MAP_CELL, cell)
    vm.set_u32(cell, map_struct)
    vm.set_u32(map_struct + 0x34, 1 if light_changes else 0)  # 0이 아니면 시각에 따라 밝기가 바뀜("Bright Change" 0x468c4c)
    vm.set_u32(map_struct + 0x38, fixed_light)
    vm.set_u32(TIME_POINTER, TIME)
    vm.set_u32(TIME, minute)
    return vm.call(LIGHT_PHASE)


def main() -> None:
    exe = read_original('vmv2.exe')
    cases = []
    for minute in [-500, *range(-1, 1441), 2000]:
        cases.append({'args': {'minute': minute, 'lightChanges': True, 'fixedLight': 0},
                      'expected': phase(exe, minute, True, 0)})
    for fixed_light in range(3):
        for minute in (0, 600, 1300):
            cases.append({'args': {'minute': minute, 'lightChanges': False, 'fixedLight': fixed_light},
                          'expected': phase(exe, minute, False, fixed_light)})
    write_fixture('lightPhase', LIGHT_PHASE, cases)


if __name__ == '__main__':
    main()
