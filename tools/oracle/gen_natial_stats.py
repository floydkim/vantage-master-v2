"""네이티얼 능력치 계산 정답 픽스처. 실행: pnpm oracle natial_stats"""
import os
import struct
import sys

sys.path.insert(0, os.path.dirname(__file__))
from fixture import write_fixture  # noqa: E402
from original import read_original  # noqa: E402
from vm import SCRATCH, Vm  # noqa: E402

NATIAL_STATS = 0x40FE72  # vmv2.exe: (유닛*, 밝기 또는 -1). 유닛 +0x34~+0x44, +0x5c를 채운다
TABLE = 0x4749D8         # 네이티얼 종류 표: 종류 × 0x58
RECORD_SIZE = 0x58


def main() -> None:
    exe = read_original('vmv2.exe')
    cases = []
    for natial in range(1, 25):
        for level in range(3):
            for light in range(3):
                vm = Vm(exe)
                preference = vm.read(TABLE + natial * RECORD_SIZE + 0x45, 1)[0]
                unit = bytearray(0x6C)
                struct.pack_into('<H', unit, 0x02, natial)  # 종류
                unit[0x06] = preference                      # 낮밤 성향: 되살리기(0x40fc66)가 표에서 복사해 두는 값
                struct.pack_into('<i', unit, 0x2C, level)    # 레벨 0~2
                vm.write(SCRATCH, unit)
                vm.call(NATIAL_STATS, SCRATCH, light)
                out = vm.read(SCRATCH, 0x6C)
                i32 = lambda o: struct.unpack_from('<i', out, o)[0]  # noqa: E731
                cases.append({
                    'args': {'natial': natial, 'level': level, 'light': light},
                    'expected': {'attack': i32(0x34), 'defense': i32(0x38), 'magic': i32(0x3C),
                                 'magicDefense': i32(0x40), 'speed': i32(0x44), 'expValue': i32(0x5C)},
                })
    write_fixture('natialStats', NATIAL_STATS, cases)


if __name__ == '__main__':
    main()
