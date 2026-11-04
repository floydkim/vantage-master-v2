"""창 배치 정답 픽스처(월드 0x4510ca → 전투 0x40e392·0x40e3be, 창 배치 다시 0x40e4cd의 계산). 실행: pnpm oracle layout

게임 블록을 그래픽 되살리기로 올린 뒤 GetSystemMetrics를 Win98 기본 배색 값(캡션 19, 대화 틀 3, 크기 틀 4, 스크롤 16, 메뉴 19)으로,
MDI 클라이언트 GetClientRect를 주어진 크기로 대역한다. 도움말 창 켬(블록 +0x288)·채팅 창 켬(+0x294)을 바꿔 가며 월드 배치를 부르고,
이어 전장 확대가 −1인 상태에서 전투 배치(0x40e392)를 부른다. 블록 +0x268~+0x2d3의 배치 값을 남긴다.
"""
import base64
import json
import os
import struct
import sys
import zlib

sys.path.insert(0, os.path.dirname(__file__))
from fixture import GOLDEN, write_fixture  # noqa: E402
from original import read_original  # noqa: E402
from screen import resume_screen_battle  # noqa: E402

WORLD_LAYOUT = 0x4510CA
BATTLE_LAYOUT = 0x40E392
BLOCK = 0x4CC810
WIN98 = {4: 19, 7: 3, 8: 3, 0x20: 4, 0x21: 4, 2: 16, 3: 16, 0xF: 19}
# 배치 값을 가리키는 전역 포인터(0x450aaa·0x4297ca·0x42ac5a·0x424b5a·0x417c6a·0x40e36a·0x40e383·0x40ac2a·0x40d43a가 둔다)
POINTERS = {0x5061E4: 0x268, 0x483ED4: 0x278, 0x483EE4: 0x280, 0x483E40: 0x28C, 0x4800C8: 0x298, 0x478DF0: 0x2A8, 0x478DF4: 0x2AC, 0x476BF0: 0x2C0, 0x478DE8: 0x2CC}
HELP_WINDOW = 0x483E44
CHAT_WINDOW = 0x4800CC
HELP_ON = 0x288
CHAT_ON = 0x294
# 1280×1024·1024×768·800×600·640×480 화면에서 최대화한 프레임의 MDI 클라이언트(높이 − 캡션 − 메뉴)와 좁은 경우들
SIZES = ((1280, 986), (1024, 730), (800, 562), (640, 442), (600, 400), (1100, 450), (900, 700), (500, 300))


def stub(vm, name: str, nargs: int, handler) -> None:
    for full in [k for k in vm._api_names.values() if k.endswith('!' + name)]:
        vm.stub_api(full, nargs, handler)


def make_case(exe: bytes, block: bytes, map_index: int, size: tuple, help_on: int, chat_on: int) -> dict:
    vm = resume_screen_battle(exe, block, map_index)
    w, h = size
    stub(vm, 'GetSystemMetrics', 1, lambda vm, i: WIN98.get(i, 0))
    stub(vm, 'GetClientRect', 2, lambda vm, hwnd, out: (vm.write(out, struct.pack('<iiii', 0, 0, w, h)), 1)[1])
    vm.unstub_function(WORLD_LAYOUT)  # screen.py가 한 번 부른 뒤 막아 둔다
    for pointer, offset in POINTERS.items():
        vm.set_u32(pointer, BLOCK + offset)
    vm.set_u32(BLOCK + HELP_ON, help_on)
    vm.set_u32(BLOCK + CHAT_ON, chat_on)
    vm.call(WORLD_LAYOUT, limit=200_000_000)
    world = list(struct.unpack('<27i', vm.read(BLOCK + 0x268, 0x6C)))
    for window in (HELP_WINDOW, CHAT_WINDOW):  # 대역 핸들 창의 가짜 사각형(0x424bdb·0x417d0e)으로 덮지 않게: 사용자가 옮기지 않은 경우
        vm.set_u32(window, 0)
    vm.call(BATTLE_LAYOUT, limit=200_000_000)
    battle = list(struct.unpack('<27i', vm.read(BLOCK + 0x268, 0x6C)))
    return {'args': {'client': [w, h], 'help': help_on, 'chat': chat_on}, 'expected': {'world': world, 'battle': battle}}


def main() -> None:
    exe = read_original('vmv2.exe')
    with open(os.path.join(GOLDEN, 'games.json')) as f:
        game = json.load(f)['cases'][0]
    block = zlib.decompress(base64.b64decode(game['expected']['blocks'][0]))
    cases = [make_case(exe, block, game['args']['map'], size, help_on, chat_on) for size in SIZES for help_on, chat_on in ((1, 0), (0, 0), (1, 1))]
    write_fixture('layout', WORLD_LAYOUT, cases)


if __name__ == '__main__':
    main()
