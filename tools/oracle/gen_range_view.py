"""범위 보기(유닛 메뉴 → 입력 단계 8~0x14) 정답 픽스처. 실행: pnpm oracle range_view

gen_ui_screen처럼 게임 블록을 그래픽 되살리기로 올리고, 유닛 셋(차례 유닛, 적 마스터, 효과 반경 마법이 있는 유닛)마다 원작 UI 길을 그대로 밟는다:
단계 1에서 유닛 오른쪽 누름(0x4045ee 1: 0x476b30, 0x476b90, 단계 7 0x404c02 — 팝업 창 0x419a11만 대역) → 항목(단계 8~0xf) → 오른쪽 누름(단계 7).
칸을 눌러 들어가는 단계는 원작 왼쪽 누름(0x403fb0)처럼 앞 단계의 보이는 칸(유닛 칸이 아닌 것 가운데 가운데 것)을 0x476b88(0x10·0x13·0xe → 0x14)
또는 0x476b18(0x11·0x12·0x13 → 0x14)에 두고 이어 들어가고, 오른쪽 누름으로 앞 단계를 거쳐 돌아온다. 단계 8에서 칸을 누르면 가상 배치(0x405bb2 → 0x405a6e)
뒤 단계 7이고, 그 자리에서 다시 범위를 본다(첫 유닛은 다른 유닛이 선 칸에도). 끝에 단계 7 오른쪽 누름(0x405e1d: 0x405bb2, 단계 1, 0x4027e3).
장면마다(단계 1·7 포함) 칩 줄 CRC32, 표시 객체 풀, 어둡게 할 칸, DIB 색 표(gen_ui_screen.scene)와 도움말 문구(0x424fed 인자, 문자열 주소).
"""
import base64
import json
import os
import sys
import zlib

sys.path.insert(0, os.path.dirname(__file__))
from battle import encode_block, packed_block  # noqa: E402
from fixture import GOLDEN, write_fixture  # noqa: E402
from gen_attack import patch_block  # noqa: E402
from gen_ui_screen import ACTOR, CURSOR_ON, DIM, LOAD_UI_GRAPHICS, SELECTED, SET_CURSOR, SET_PHASE, scene  # noqa: E402
from original import read_original  # noqa: E402
from screen import resume_screen_battle  # noqa: E402

HELP_TEXT = 0x424FED     # (문자열) 도움말 창 문구
HAS_RANGED_SPELL = 0x4115DC  # (유닛) 행동 +9가 0이 아닌 마법이 있는가
LOOK = 0x476B88          # 단계 0x10·0x13 칸(x, +4 y)
AIM = 0x476B18           # 단계 0x11·0x12·0x14 칸
SAVED = 0x476B90          # 이동 전 위치 객체(0x4045ee 1이 둔다)
CLICK = 0x476AC8          # 누른 칸 x, +4 y
PLACE = 0x405A6E          # 고른 유닛을 누른 칸에 가상으로 세움
UNPLACE = 0x405BB2        # 가상 배치 되돌리기
DARK_PALETTE = 0x4027E3
POPUP_MENU = 0x419A11     # 유닛 메뉴 팝업 창(대역)
PHASE = 0x476AF4
UNITS = 0x478E10
UNIT_COUNT = 0x47A398
CASES = ((0, 0), (0, -2), (1, 10), (1, 26), (2, 6), (2, -2), (3, 20), (4, 5), (4, 12), (5, -2))  # (게임, 블록: 음수는 끝에서). 1·26, 2·6, 4·5, 4·12는 효과 반경 마법 네이티얼
ACTIONS = 0x465908          # 행동 표 0x14바이트: +8 범위 종류, +0xa 효과 반경
# 게임에 없는 효과 반경 1 포물선(범위 종류 1, 행동 27 Gia-Bro): 게임 0 블록 3의 차례 네이티얼(칸 2) 종류를 4로(gen_attack.patch_block)
RETYPED = ((0, 3, ('type', 2, 4)),)


def visible(vm, skip: tuple) -> list:
    dim = vm.read(DIM, 0x1000)
    return [(i % 32, i // 32) for i in range(1024) if dim[i * 4] == 0 and (i % 32, i // 32) != skip]


def make_case(exe: bytes, label: str, block: bytes, map_index: int) -> dict:
    vm = resume_screen_battle(exe, block, map_index)
    packed = encode_block(packed_block(vm))
    texts = []
    vm.stub_function(HELP_TEXT, 1, lambda vm, p: texts.append(p) or 0)
    vm.stub_function(POPUP_MENU, 1, lambda vm, p: 0)
    vm.call(LOAD_UI_GRAPHICS, limit=2_000_000_000)
    actor = vm.u32(ACTOR)
    x, y = vm.read(vm.u32(actor + 0x68), 2)
    cursor = (x, min(y + 2, 31))
    vm.call(SET_PHASE, 1, limit=2_000_000_000)
    vm.call(SET_CURSOR, *cursor, limit=2_000_000_000)
    vm.call(CURSOR_ON, 1, 1, limit=2_000_000_000)
    units = [UNITS + i * 0x6C for i in range(vm.u32(UNIT_COUNT))]
    alive = [u for u in units if not int.from_bytes(vm.read(u, 2), 'little') & 0x8000]
    side = lambda u: vm.read(u + 4, 1)[0]  # noqa: E731
    master = lambda u: not int.from_bytes(vm.read(u, 2), 'little') & 0x4000  # noqa: E731
    spells = lambda u: vm.u32(u + 0xC)  # noqa: E731
    picks = [actor]
    picks += [u for u in alive if master(u) and side(u) != side(actor)][:1]
    area = lambda u: any(vm.read(ACTIONS + vm.u32(u + 0x10 + 4 * i) * 0x14 + 0xA, 1)[0] and vm.read(ACTIONS + vm.u32(u + 0x10 + 4 * i) * 0x14 + 8, 1)[0] != 5 for i in range(spells(u)))  # noqa: E731
    picks += ([u for u in alive if area(u) and u not in picks] or [u for u in alive if not master(u) and spells(u) and u not in picks])[:1]
    scenes = []
    state = {'unit': None, 'look': None, 'aim': None, 'placed': None}

    def record() -> list:
        scene(vm, scenes, {'unit': units.index(state['unit']) if state['unit'] else None, 'phase': vm.u32(PHASE), 'look': state['look'], 'aim': state['aim'], 'placed': state['placed']})
        scenes[-1]['expected']['text'] = texts[-1] if texts else None
        unit = state['unit']
        cells = visible(vm, tuple(vm.read(vm.u32(unit + 0x68), 2))) if unit else []
        return cells[len(cells) // 2] if cells else None

    def enter(phase: int, look=None, aim=None) -> list:
        for at, key, cell in ((LOOK, 'look', look), (AIM, 'aim', aim)):
            if cell:
                vm.set_u32(at, cell[0])
                vm.set_u32(at + 4, cell[1])
                state[key] = list(cell)
        texts.clear()
        vm.call(SET_PHASE, phase, limit=2_000_000_000)
        return record()

    def open_menu(unit: int) -> None:
        # 단계 1에서 유닛 오른쪽 누름(0x4045ee 1): 단계 7, 위치 객체를 0x476b90에 둔다
        vm.set_u32(SELECTED, unit)
        state['unit'] = unit
        enter(7)
        vm.write(SAVED, vm.read(vm.u32(unit + 0x68), 0x16))

    def place(cell) -> None:
        # 단계 8에서 칸 누름(0x403fb0 8): 가상 배치를 되돌리고(0x405bb2) 그 칸에 세운 뒤(0x405a6e) 단계 7
        vm.set_u32(CLICK, cell[0])
        vm.set_u32(CLICK + 4, cell[1])
        vm.call(UNPLACE, limit=2_000_000_000)
        vm.call(PLACE, limit=2_000_000_000)
        home = list(vm.read(SAVED, 2))
        state['placed'] = None if list(cell) == home else list(cell)
        enter(7)

    def close_menu() -> None:
        # 단계 7에서 오른쪽 누름(0x405e1d): 되돌리고 단계 1, 어두운 칸 다시(0x4027e3)
        texts.clear()
        vm.call(UNPLACE, limit=2_000_000_000)
        vm.call(SET_PHASE, 1, limit=2_000_000_000)
        vm.call(DARK_PALETTE, limit=2_000_000_000)
        state.update(unit=None, placed=None)
        record()

    def views(ranged: bool, all_views: bool) -> None:
        for phase in ((8, 9, 0xA, 0xF) if all_views else (9,)):
            enter(phase)
            enter(7)  # 오른쪽 누름(0x4045ee 8~0xf)
        cell = enter(0xB)
        if ranged and cell:
            enter(0x10, look=cell)
            enter(0xB)
        enter(7)
        cell = enter(0xC)
        if cell:
            enter(0x11, aim=cell)
            enter(0xC)
        enter(7)
        if not all_views:
            return
        cell = enter(0xD)
        if cell:
            enter(0x12, aim=cell)
            enter(0xD)
        enter(7)
        cell = enter(0xE)
        if cell and ranged:
            cell = enter(0x13, look=cell)
            if cell:
                enter(0x14, aim=cell)
                enter(0x13)
            enter(0xE)
        elif cell:
            enter(0x14, look=cell)
            enter(0xE)
        enter(7)

    others = [u for u in alive if u not in picks]
    for n, unit in enumerate(picks):
        ranged = vm.call(HAS_RANGED_SPELL, unit, limit=2_000_000_000)
        open_menu(unit)
        views(ranged, True)
        cell = enter(8)
        if cell:
            place(cell)
            views(ranged, False)
        if n == 0 and others:
            enter(8)
            place(tuple(vm.read(vm.u32(others[0] + 0x68), 2)))  # 다른 유닛이 선 칸: 그 유닛을 숨긴다
            enter(0xA)
            enter(7)
        close_menu()
    print(label, len(scenes), flush=True)
    return {'label': label, 'map': map_index, 'block': packed, 'cursor': list(cursor), 'scenes': scenes}


def main() -> None:
    exe = read_original('vmv2.exe')
    with open(os.path.join(GOLDEN, 'games.json')) as f:
        games = json.load(f)['cases']
    cases = []
    for g, k in CASES:
        blocks = games[g]['expected']['blocks']
        k = k % len(blocks)
        block = zlib.decompress(base64.b64decode(blocks[k]))
        cases.append(make_case(exe, f'게임 {g} 블록 {k}', block, games[g]['args']['map']))
    for g, k, patch in RETYPED:
        block = patch_block(zlib.decompress(base64.b64decode(games[g]['expected']['blocks'][k])), patch)
        cases.append(make_case(exe, f'게임 {g} 블록 {k}(칸 {patch[1]} 종류 {patch[2]})', block, games[g]['args']['map']))
    write_fixture('rangeView', SET_PHASE, cases)


if __name__ == '__main__':
    main()
