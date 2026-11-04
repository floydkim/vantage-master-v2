"""전장 UI 표시 정답 픽스처. 실행: pnpm oracle ui_screen

게임 픽스처 블록을 그래픽을 켠 되살리기(screen.py)로 올리고, 차례 유닛(0x476b04)으로 원작 입력 단계 진입 함수(0x40484b)를 차례로 부른다:
단계 1 + 커서(차례 유닛 칸에서 아래로 2칸, 또는 주어진 칸, 커서 프레임 0·2), 단계 2(이동 범위), 단계 4(공격), 유닛 마법 목록(+0xc·+0x10,
네이티얼 포함)의 효과 반경 없는 첫 마법 단계 4, 효과 반경 있는 첫 마법 단계 4(범위 종류 4가 아니면)·6(범위 종류 4면 중심 = 자기 칸,
아니면 사거리 안 첫 칸), 마스터면 소환 목록 첫 종류 단계 5. 장면마다 겹 목록(0x43d636) 뒤 전장 칩 줄 CRC32, 표시 객체 풀,
어둡게 할 칸(0x48e664, 칸마다 비트 하나 hex), DIB 색 표 10~245번(범위 표시 0x43d3a6이 0x4027e3으로 어두운 칸을 다시 계산)을 담는다.
게임 6판 × 3시점에 네이티얼 마법 차례 블록과, 상태 이상 유닛 위 커서 장면(screen 픽스처의 상태 이상 블록)을 더한다.
"""
import base64
import json
import os
import struct
import sys
import zlib

sys.path.insert(0, os.path.dirname(__file__))
from battle import encode_block, packed_block  # noqa: E402
from fixture import GOLDEN, write_fixture  # noqa: E402
from original import read_original  # noqa: E402
from screen import COMPOSE, SPRITE_COUNT, SPRITES, draw_field, palette, resume_screen_battle  # noqa: E402
from gen_screen import rows  # noqa: E402

SET_PHASE = 0x40484B
LOAD_UI_GRAPHICS = 0x422F9A  # DATA00 8번 → 페이지 0x2c6
SET_CURSOR = 0x403C8E       # (x, y) 커서 칸과 커서 표시 객체 위치
CURSOR_ON = 0x403B10        # (켬, 다시 그림)
IN_RANGE = 0x41074B         # (x, y, 행동, tx, ty)
ACTOR = 0x476B04
SELECTED = 0x476B30
ACTION = 0x476AE8
CENTER = 0x476AF8           # 효과 범위 중심 x, +4 y
CURSOR_FRAME = 0x476AD4
CURSOR_SPRITE = 0x476AC0
DIM = 0x48E664
NATIAL_SPELLS = ((0, 3), (1, 26), (2, 6), (3, 2), (4, 5), (4, 12))  # 네이티얼 차례: 효과 반경 없는 마법, 범위 종류 4·3의 효과 반경 마법
ACTIONS = 0x465908          # 행동 표 0x14바이트: +0 MP, +8 범위 종류, +0xa 효과 반경
SIDE_RECORDS = 0x45E0E8     # → 진영 레코드(0xc0), +0x38 소환할 수 있는 종류 목록(i32, 0 끝)


def action_byte(vm, action: int, offset: int) -> int:
    return vm.read(ACTIONS + action * 0x14 + offset, 1)[0]


def scene(vm, scenes: list, info: dict) -> None:
    vm.call(COMPOSE, limit=2_000_000_000)
    dim = vm.read(DIM, 0x1000)
    bits = bytes(sum(1 << b for b in range(8) if dim[(i * 8 + b) * 4]) for i in range(128))
    scenes.append({'args': info, 'expected': {
        'field': rows(draw_field(vm)),
        'pool': [vm.read(SPRITES + i * 0x16, 0x16).hex() for i in range(vm.u32(SPRITE_COUNT))],
        'dim': bits.hex(),
        'dib': palette(vm)[40:246 * 4].hex()}})


def make_case(exe: bytes, label: str, block: bytes, map_index: int, cursor_at=None) -> dict:
    vm = resume_screen_battle(exe, block, map_index)
    packed = encode_block(packed_block(vm))  # 장면 전에: 압축(0x4071ea)은 0x476b30 유닛의 위치를 이동 전 위치(0x476b90)에서 가져온다
    vm.call(LOAD_UI_GRAPHICS, limit=2_000_000_000)  # 사람 입력 시작(0x40546d)처럼: CPU 생각이 페이지 0x2c6~를 작업 버퍼로 덮었을 수 있다
    actor = vm.u32(ACTOR)
    x, y = vm.read(vm.u32(actor + 0x68), 2)
    cursor = cursor_at or (x, min(y + 2, 31))
    scenes = []
    vm.call(SET_PHASE, 1, limit=2_000_000_000)
    vm.call(SET_CURSOR, *cursor, limit=2_000_000_000)
    vm.call(CURSOR_ON, 1, 1, limit=2_000_000_000)
    for frame in (0, 2):
        vm.set_u32(CURSOR_FRAME, frame)
        vm.write(vm.u32(CURSOR_SPRITE) + 0xB, bytes([13 + frame]))
        scene(vm, scenes, {'phase': 1, 'cursor': [*cursor, frame]})
    vm.set_u32(CURSOR_FRAME, 0)
    vm.write(vm.u32(CURSOR_SPRITE) + 0xB, bytes([13]))
    vm.set_u32(SELECTED, actor)
    vm.call(SET_PHASE, 2, limit=2_000_000_000)
    scene(vm, scenes, {'phase': 2, 'cursor': [*cursor, 0]})
    vm.call(SET_PHASE, 3, limit=2_000_000_000)

    def act(action: int, phase: int, center=None) -> None:
        vm.set_u32(ACTION, action)
        if center:
            vm.set_u32(CENTER, center[0])
            vm.set_u32(CENTER + 4, center[1])
        vm.call(SET_PHASE, phase, limit=2_000_000_000)
        scene(vm, scenes, {'phase': phase, 'cursor': [*cursor, 0], 'action': action, 'center': list(center) if center else None})
        vm.call(SET_PHASE, 3, limit=2_000_000_000)

    act(vm.read(actor + 8, 1)[0], 4)
    spells = [vm.u32(actor + 0x10 + 4 * i) for i in range(vm.u32(actor + 0xC))]
    plain = [s for s in spells if action_byte(vm, s, 0xA) == 0 and action_byte(vm, s, 8) not in (4, 5)]
    if plain:
        act(plain[0], 4)
    area = [s for s in spells if action_byte(vm, s, 0xA) != 0 and action_byte(vm, s, 8) != 5]
    if area:
        s = area[0]
        if action_byte(vm, s, 8) == 4:
            center = (x, y)
        else:
            act(s, 4)
            center = next(((cx, cy) for cy in range(32) for cx in range(32) if vm.call(IN_RANGE, x, y, s, cx, cy)), None)
        if center:
            act(s, 6, center)
    if int.from_bytes(vm.read(actor, 2), 'little') & 0x4000 == 0:  # 마스터(유닛 +0의 0x4000 비트가 없음)
        side = vm.read(actor + 4, 1)[0]
        kinds = vm.u32(vm.u32(SIDE_RECORDS) + side * 0xC0 + 0x38)
        if kinds:
            act(kinds, 5)
    print(label, len(scenes), flush=True)
    return {'label': label, 'map': map_index, 'block': packed, 'scenes': scenes}


def main() -> None:
    exe = read_original('vmv2.exe')
    with open(os.path.join(GOLDEN, 'games.json')) as f:
        games = json.load(f)['cases']
    cases = []
    for g, game in enumerate(games):
        blocks = game['expected']['blocks']
        for k in sorted({0, len(blocks) // 2, len(blocks) - 2} | {k for gg, k in NATIAL_SPELLS if gg == g}):
            block = zlib.decompress(base64.b64decode(blocks[k]))
            cases.append(make_case(exe, f'게임 {g} 블록 {k}', block, game['args']['map']))
    with open(os.path.join(GOLDEN, 'screen.json')) as f:
        status = [c for c in json.load(f)['cases'] if '상태 이상' in c['args']['label']]
    for c in status:
        block = zlib.decompress(base64.b64decode(c['args']['block']))
        unit = next(i for i in range(struct.unpack_from('<i', block, 0x9E8)[0]) if struct.unpack_from('<H', block, 0x2E0 + i * 0x24 + 0x20)[0] & 7)
        at = block[0x2E0 + unit * 0x24:0x2E0 + unit * 0x24 + 2]
        cases.append(make_case(exe, c['args']['label'] + ' 커서', block, 3, (at[0], at[1])))
    write_fixture('uiScreen', SET_PHASE, cases)


if __name__ == '__main__':
    main()
