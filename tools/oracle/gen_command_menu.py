"""명령 메뉴 그림 정답 픽스처. 실행: pnpm oracle command_menu

그래픽을 켠 새 전투(맵 3)의 명령 메뉴 객체(0x4800d4, 0x419820)에 켬 조합 16개마다 0x41a3ad(켬, 마스터, 진영, 마법 목록, 소환 목록)를
부르고, 가리킴(−1과 켜진 항목마다)을 +0x14에 둔 뒤 다시 그림(0x41a73f). 메뉴 DIB(+0x18, 80 × 132, 위에서 아래)의 줄마다 CRC32를 담는다.
"""
import os
import struct
import sys
import zlib

sys.path.insert(0, os.path.dirname(__file__))
from fixture import write_fixture  # noqa: E402
from original import read_original  # noqa: E402
from screen import start_screen_battle, thiscall  # noqa: E402

MENU = 0x4800D4
SET_MENU = 0x41A3AD
REDRAW = 0x41A73F
FLAGS = 0x0FFF0C00          # 켬 i32 4개를 둘 빈 자리(thiscall 도우미 페이지)
W, H = 80, 132


def main() -> None:
    vm = start_screen_battle(read_original('vmv2.exe'), 3)
    menu = vm.u32(MENU)
    cases = []
    for bits in range(16):
        enabled = [(bits >> i) & 1 for i in range(4)]
        vm.write(FLAGS, struct.pack('<4i', *enabled))
        thiscall(vm, SET_MENU, menu, FLAGS, 1, 0, 0, 0)
        for hover in [-1] + [i for i in range(4) if enabled[i]]:
            vm.set_u32(menu + 0x14, hover & 0xFFFFFFFF)
            thiscall(vm, REDRAW, menu)
            image = vm.read(vm.u32(menu + 0x18), W * H)
            cases.append({'args': {'enabled': enabled, 'hover': hover}, 'expected': {'rows': [zlib.crc32(image[r * W:(r + 1) * W]) for r in range(H)]}})
    write_fixture('commandMenu', REDRAW, cases)


if __name__ == '__main__':
    main()
