"""마스터 능력치(0x42dae0) 정답 픽스처. 실행: pnpm oracle master_stats"""
import os
import struct
import sys

sys.path.insert(0, os.path.dirname(__file__))
from fixture import write_fixture  # noqa: E402
from original import read_original  # noqa: E402
from vm import SCRATCH, Vm  # noqa: E402

MASTER_STATS = 0x42DAE0  # vmv2.exe: (진영 레코드*). +0x9c 마스터·+0xa0 레벨로 +0x18, +0xa4~+0xbc를 채운다


def main() -> None:
    exe = read_original('vmv2.exe')
    cases = []
    for master in range(27):
        for level in range(40):
            vm = Vm(exe)
            record = bytearray(0xC0)
            struct.pack_into('<ii', record, 0x9C, master, level)
            vm.write(SCRATCH, record)
            vm.call(MASTER_STATS, SCRATCH)
            out = vm.read(SCRATCH, 0xC0)
            stats = struct.unpack_from('<7i', out, 0xA4)
            cases.append({
                'args': {'master': master, 'level': level},
                'expected': {'maxMp': stats[0], 'attack': stats[1], 'defense': stats[2], 'magic': stats[3],
                             'magicDefense': stats[4], 'speed': stats[5], 'movement': stats[6], 'attackAction': out[0x18]},
            })
    write_fixture('masterStats', MASTER_STATS, cases)


if __name__ == '__main__':
    main()
