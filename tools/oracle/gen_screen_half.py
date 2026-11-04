"""전장 확대 x /2 정답 픽스처. 실행: pnpm oracle screen_half

그래픽을 켠 원작(screen.py)에서 전투를 만들고, 표식 그림(0x476bb0)·연출 그림(0x476bb4) 플래그와 어두운 칸(0x4027e3)을 정한 뒤 확대를
x /2로 바꾼다(0x40e762(0): 0x40ee74가 반 크기 칩 시트 0x483f44를 채우고, 0x40f03c가 전장 창을 칩 12 × 6으로). 겹 목록(0x43d636)을 짓고
칩 그리기(0x43ef06)를 받을 곳 780폭으로 불러 반 크기 전장(780 × 504)을 떠낸다.
정답: 반 시트 페이지(16칩 × 72바이트)마다 CRC32(칩 0 ~ 0x4020), 전장 6픽셀 줄 84개 CRC32(지형만·전체), 바꿀 때의 논리 팔레트(LOGPALETTE).
마지막 경우는 x /2인 채 그림을 읽고(0x4226eb 플래그 0) 그 페이지의 반 시트·온 시트 CRC를 더 남긴다.
"""
import base64
import json
import os
import sys
import zlib

sys.path.insert(0, os.path.dirname(__file__))
from battle import SET_TIME, encode_block, packed_block  # noqa: E402
from fixture import GOLDEN, write_fixture  # noqa: E402
from gen_screen import capture  # noqa: E402
from original import read_original  # noqa: E402
from screen import BATTLE_WINDOW, CHIPS_X, CHIPS_Y, COMPOSE, DRAW_CHIP, FIELD_BITS, PALETTE, hide_sprites, resume_screen_battle, start_screen_battle, thiscall  # noqa: E402

SET_ZOOM = 0x40E762
DARKEN = 0x4027E3
TIME = 0x476AD8              # → 하루 중 시각(분)
HALF = 0x483F44             # → 반 크기 칩 시트(칩 12 × 6 = 72바이트)
FULL = 0x483F48             # → 온 크기 칩 시트(칩 0x120바이트)
MARKERS = 0x476BB0          # 커서·표식 그림이 읽혀 있다(입력 시작 0x40546d가 1, 명령 실행 0x406d13이 0)
EFFECTS = 0x476BB4          # UI 페이지에 연출 그림(명령 실행이 1, 다음 차례 0x40623b가 0)
LOAD_PAGE = 0x4226EB        # (리소스, 페이지, 플래그)
CHIP_W, CHIP_H = 12, 6
FIELD_W = CHIPS_X * CHIP_W
SHEET_CHIPS = 0x1000 + 0x2C6 * 16 + 0x3C0
PAGE = 16 * CHIP_W * CHIP_H
LOADED = 0xE0


def half_pages(vm) -> list:
    sheet = vm.read(vm.u32(HALF), SHEET_CHIPS * CHIP_W * CHIP_H)
    return [zlib.crc32(sheet[i:i + PAGE]) for i in range(0, len(sheet), PAGE)]


def draw_half(vm) -> list:
    window, bits = vm.u32(BATTLE_WINDOW), vm.u32(FIELD_BITS)
    for y in range(CHIPS_Y):
        for x in range(CHIPS_X):
            thiscall(vm, DRAW_CHIP, window, bits + FIELD_W * CHIP_H * y + CHIP_W * x, x, y, CHIP_W * (CHIPS_X - 1))
    field = vm.read(bits, FIELD_W * CHIP_H * CHIPS_Y)
    size = FIELD_W * CHIP_H
    return [zlib.crc32(field[i:i + size]) for i in range(0, len(field), size)]


def stub_window_apis(vm) -> None:
    """0x40f03c·0x442aea의 스크롤 막대 호출(창이 대역이라 아무 일도 없다)"""
    for name, nargs in (('ShowScrollBar', 3), ('GetScrollPos', 2), ('GetScrollRange', 4), ('GetScrollInfo', 3), ('EnableScrollBar', 3)):
        for full in [k for k in vm._api_names.values() if k.endswith('!' + name)]:
            vm.stub_api(full, nargs, lambda vm, *a: 1)


def shoot(vm, label: str, map_index: int, n: int, load: tuple | None = None, time_after: bool = False) -> dict:
    stub_window_apis(vm)
    markers, effects = ((1, 0), (0, 1), (0, 0))[n % 3]
    dark = n % 2 == 1
    if dark:
        vm.call(DARKEN, limit=2_000_000_000)
    vm.set_u32(MARKERS, markers)
    vm.set_u32(EFFECTS, effects)
    block = encode_block(packed_block(vm))
    logical = vm.read(vm.u32(PALETTE + 8) + 4, 1024).hex()  # LOGPALETTE 항목(0x4825c8 + 4, 0x4232a9가 읽는 곳)
    vm.call(SET_ZOOM, 0, limit=4_000_000_000)
    expected = {'half': half_pages(vm), 'logical': logical}
    if load:
        resource, page = load
        if time_after:  # x /2인 동안 시각이 바뀐 뒤 읽기: 줄이기는 읽는 그때의 논리 팔레트로(0x42325f → 0x4232a9)
            vm.call(SET_TIME, (vm.u32(vm.u32(TIME)) + 600) % 1440, limit=2_000_000_000)
            expected['loadLogical'] = vm.read(vm.u32(PALETTE + 8) + 4, 1024).hex()
        vm.call(LOAD_PAGE, resource, page, 0, limit=2_000_000_000)
        at = (0x1000 + page * 16)
        expected['loaded'] = {  # 유닛 그림 한 벌(칩 0xe0개)
            'half': zlib.crc32(vm.read(vm.u32(HALF) + at * CHIP_W * CHIP_H, LOADED * CHIP_W * CHIP_H)),
            'full': zlib.crc32(vm.read(vm.u32(FULL) + at * 0x120, LOADED * 0x120)),
        }
    vm.call(COMPOSE, limit=2_000_000_000)
    expected['field'] = draw_half(vm)
    hide_sprites(vm)
    expected['terrain'] = draw_half(vm)
    print(n, label, flush=True)
    args = {'label': label, 'map': map_index, 'block': block, 'markers': markers, 'effects': effects, 'dark': dark}
    if load:
        args['load'] = list(load)
    if time_after:
        args['timeAfter'] = True
    return {'args': args, 'expected': expected}


def main() -> None:
    exe = read_original('vmv2.exe')
    cases = []
    for m in (0, 3, 8, 20, 33, 45):
        vm = start_screen_battle(exe, m)
        capture(vm)
        cases.append(shoot(vm, f'맵 {m} 점령', m, len(cases)))
    with open(os.path.join(GOLDEN, 'games.json')) as f:
        games = json.load(f)['cases']
    for g in (0, 2, 4):
        blocks = games[g]['expected']['blocks']
        block = zlib.decompress(base64.b64decode(blocks[len(blocks) // 2]))
        vm = resume_screen_battle(exe, block, games[g]['args']['map'])
        cases.append(shoot(vm, f'게임 {g} 블록 {len(blocks) // 2}', games[g]['args']['map'], len(cases)))
    vm = start_screen_battle(exe, 3)
    cases.append(shoot(vm, '맵 3 x /2 중 읽기', 3, len(cases), load=(0xF, 0x200)))
    vm = start_screen_battle(exe, 3)
    cases.append(shoot(vm, '맵 3 x /2 뒤 시각이 바뀌고 읽기', 3, len(cases), load=(0x1002C, 0x200), time_after=True))
    write_fixture('screenHalf', SET_ZOOM, cases)


if __name__ == '__main__':
    main()
