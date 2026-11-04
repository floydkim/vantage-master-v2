"""re/state-map.md의 유닛 압축 레코드 배치를 원작 압축 함수로 확인한다. 실행: pnpm oracle-check"""
import os
import random
import struct
import sys

sys.path.insert(0, os.path.dirname(__file__))
from original import read_original  # noqa: E402
from vm import SCRATCH, Vm  # noqa: E402

PACK_UNITS = 0x4071EA       # vmv2.exe: 실행 중 유닛 표 → 상태 블록의 압축 레코드
UNITS = 0x478E10            # 실행 중 유닛 표: 108바이트 × 최대 51
UNIT_SIZE = 0x6C
UNIT_COUNT = 0x47A398       # 유닛 표에서 쓰는 칸 수(int)
MOVING_UNIT = 0x476B30      # 이동 중인 유닛 포인터(없으면 0)
MOVING_OBJ = 0x476B90       # 이동 중인 유닛의 이동 전 위치 객체
BLOCK = 0x4CC810            # 상태 블록(세이브 블록) 시작
RECORDS = BLOCK + 0x2E0     # 압축 레코드 36바이트 × 50
RECORD_SIZE = 0x24
PACKED_COUNT = BLOCK + 0x9E8

# 압축 레코드 오프셋: (크기, 출처, 출처 오프셋). 출처 'obj' = 유닛의 위치 객체(유닛+0x68이 가리킴)
FIELDS = {
    0x00: (1, 'obj', 0x00), 0x01: (1, 'obj', 0x01), 0x02: (1, 'obj', 0x0A), 0x03: (1, 'obj', 0x0B),
    0x04: (1, 'obj', 0x12), 0x06: (2, 'unit', 0x02), 0x08: (1, 'unit', 0x04), 0x09: (1, 'unit', 0x09),
    0x0C: (4, 'unit', 0x2C), 0x10: (4, 'unit', 0x30), 0x14: (4, 'unit', 0x4C), 0x18: (4, 'unit', 0x50),
    0x1C: (4, 'unit', 0x54), 0x20: (2, 'unit', 0x58),
}
PADDING = [0x05, 0x0A, 0x0B, 0x22, 0x23]  # 원작이 쓰지 않는 바이트


def main() -> None:
    rng = random.Random(20261015)
    vm = Vm(read_original('vmv2.exe'))
    vm.write(RECORDS, b'\xAA' * (RECORD_SIZE * 50))
    alive = [0, 2, 3]  # 1번 칸은 빈 칸(플래그 0x8000)
    units, objs = {}, {}
    for i in range(4):
        unit = bytearray(rng.randbytes(UNIT_SIZE))
        struct.pack_into('<H', unit, 0, 0x8000 if i not in alive else rng.randrange(0x8000))
        obj_at = SCRATCH + i * 0x100
        objs[i] = rng.randbytes(0x16)
        vm.write(obj_at, objs[i])
        struct.pack_into('<I', unit, 0x68, obj_at)
        units[i] = bytes(unit)
        vm.write(UNITS + i * UNIT_SIZE, unit)
    vm.set_u32(UNIT_COUNT, 4)
    moving_obj = rng.randbytes(0x16)
    vm.write(MOVING_OBJ, moving_obj)
    vm.set_u32(MOVING_UNIT, UNITS + 3 * UNIT_SIZE)  # 3번 유닛은 이동 중: 이동 전 위치가 저장돼야 한다

    vm.call(PACK_UNITS)

    assert vm.u32(PACKED_COUNT) == len(alive), f'압축 개수 {vm.u32(PACKED_COUNT)} != {len(alive)}'
    for n, i in enumerate(alive):
        rec = vm.read(RECORDS + n * RECORD_SIZE, RECORD_SIZE)
        sources = {'unit': units[i], 'obj': moving_obj if i == 3 else objs[i]}
        for off, (size, src, src_off) in FIELDS.items():
            got, want = rec[off:off + size], sources[src][src_off:src_off + size]
            assert got == want, f'레코드 {n} +{off:#04x}: {got.hex()} != {src}+{src_off:#04x} {want.hex()}'
        for off in PADDING:
            assert rec[off] == 0xAA, f'레코드 {n} +{off:#04x}는 원작이 쓰지 않는 바이트여야 합니다'
    print(f'상태 지도 확인 통과: 유닛 압축 레코드 필드 {len(FIELDS)}개, 빈 바이트 {len(PADDING)}개')


if __name__ == '__main__':
    main()
