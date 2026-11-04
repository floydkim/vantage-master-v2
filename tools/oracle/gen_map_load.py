"""맵 로드(0x4224a0) 정답 픽스처: 맵 52개를 원작 그대로 읽은 뒤 메모리의 맵 구조체·부품·격자 해시. 실행: pnpm oracle map_load"""
import hashlib
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from boot import Booted  # noqa: E402
from fixture import write_fixture  # noqa: E402
from original import read_original  # noqa: E402

LOAD_MAP = 0x4224A0     # vmv2.exe: (맵 번호) → 1이면 성공
MAP_CELL = 0x48391C     # → 칸 → 맵 구조체(2,248바이트)
PARTS_CELL = 0x483918   # → 칸 → 부품(100 × 512)
GRID_CELL = 0x483554    # → 칸 → 격자(32 × 32 u16)
WORK_GRID_CELL = 0x483560  # → 칸 → 원작이 격자를 복사해 두는 작업용 사본


def region(vm, cell: int, size: int) -> bytes:
    return vm.read(vm.u32(vm.u32(cell)), size)


def main() -> None:
    exe = read_original('vmv2.exe')
    cases = []
    for index in range(52):
        vm = Booted(exe)
        assert vm.call(LOAD_MAP, index) == 1, f'원작이 맵 {index}을 읽지 못했습니다'
        struct_bytes = region(vm, MAP_CELL, 0x8C8)
        sha = lambda data: hashlib.sha256(data).hexdigest()  # noqa: E731
        cases.append({
            'args': {'index': index},
            'expected': {
                'name': struct_bytes[:struct_bytes.index(0)].decode('ascii'),
                'struct': sha(struct_bytes),
                'parts': sha(region(vm, PARTS_CELL, 100 * 512)),
                'grid': sha(region(vm, GRID_CELL, 0x800)),
                'workGrid': sha(region(vm, WORK_GRID_CELL, 0x800)),
            },
        })
    write_fixture('mapLoad', LOAD_MAP, cases)


if __name__ == '__main__':
    main()
