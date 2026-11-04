"""걷기 연출·대기 애니메이션 정답 픽스처. 실행: pnpm oracle walk

게임 픽스처 블록을 애니메이션 옵션 0x07(원작 기본 0x77의 화면 비트)로 되살리고(screen.py), 차례 유닛 진영을 사람으로 두고 사람 입력 시작(0x4055cf → 단계 1)을 부른다.
(a) 타이머(0x403020) 16틱, (b) 차례 유닛을 골라 단계 2(이동 범위) 8틱, (c) 멈출 수 있는 칸 가운데 가장 먼 칸(또는 주어진 칸)으로 이동(0x406c5b, 끝나면 0x405fba → 단계 3)
뒤 단계가 3이 될 때까지 틱. (a)의 8째 틱 앞에는 마우스를 옮긴다(0x403d7b: 커서 칸·커서 프레임 0).
CPU 경우: 차례 표식(0x40574a)·단계 0(0x4055cf의 CPU 갈래에서 생각만 뺌)으로 8틱 뒤 CPU 결정 처리(0x406573, 대기 명령)로 걷고
이어 하기(0x4067b1)가 불리는 틱까지. 도착 칸 화면 확인(0x406ad9)은 1(보임)로 둔다.
틱마다 표시 객체 풀(빈 칸 포함)·타이머 카운터·단계를, 몇 틱은 겹 목록(0x43d636) 뒤 전장 칩 줄 CRC32를 담는다.
0x40546d는 부르지 않는다: 차례 시작 지형 피해(0x403a62)는 엔진 규칙이고 화면 연출과 무관하다.
"""
import base64
import json
import os
import sys
import zlib

sys.path.insert(0, os.path.dirname(__file__))
from battle import encode_block, packed_block  # noqa: E402
from fixture import GOLDEN, write_fixture  # noqa: E402
from gen_screen import rows  # noqa: E402
from original import read_original  # noqa: E402
from screen import COMPOSE, SKY_FRAME, SKY_SCROLL, SPRITE_COUNT, SPRITES, WATER_FRAME, draw_field, resume_screen_battle  # noqa: E402

TIMER = 0x403020
INPUT_START = 0x4055CF      # 사람이면 어두운 팔레트·단계 1
LOAD_UI_GRAPHICS = 0x422F9A
SET_PHASE = 0x40484B
MOVE = 0x406C5B             # (x, y, 이어 하기)
AFTER_MOVE = 0x405FBA       # 단계 3
ACTOR = 0x476B04
SELECTED = 0x476B30
PHASE = 0x476AF4
CONTROL = 0x45E0EC          # → 진영 0x18바이트: +0 제어(0 사람, 1 CPU, 2 상대)
B20, BA8, CURSOR_FRAME = 0x476B20, 0x476BA8, 0x476AD4
RANGE = 0x4C4BF0            # 이동 범위 작업 버퍼, 칸마다 0x1f바이트(+0x12 & 8 = 멈출 수 있음)
POINTER = 0x403D7B          # (px, py, 버튼) 마우스 이동
CURSOR_CELL = 0x476B78       # x, +4 y(칸 밖이면 −1)
TURN_MARKER = 0x40574A
CPU_DECISION = 0x406573      # (메시지 u16 A | u16 B << 16)
VISIBLE = 0x406AD9
RUN_ACTION = 0x4067B1        # 걷기 뒤 이어 하기
CELL_BOX = 0x40646B          # (x, y, 반경, 받을 곳) 칸 둘레 픽셀 상자(왼, 위, 오른, 아래)
OPTIONS = 0x07             # 원작 기본 0x77에서 음악 비트(0x10·0x20·0x40, 되살리기가 MCI를 부름)를 뺀 화면 비트(1 하늘, 2 물, 4 대기)
EFFECTS = 0x47A3A8          # 연출 객체 0x7c바이트(+0x28 & 0x80000000 = 끝남), 개수 0x47a3a4
EFFECT_COUNT = 0x47A3A4
SOUND = 0x443D19            # (번호) 효과음


def snapshot(vm, draw: bool) -> dict:
    out = {
        'pool': [vm.read(SPRITES + i * 0x16, 0x16).hex() for i in range(vm.u32(SPRITE_COUNT))],
        'b20': vm.u32(B20), 'ba8': vm.u32(BA8), 'cursorFrame': vm.u32(CURSOR_FRAME), 'water': vm.u32(WATER_FRAME),
        'skyFrame': vm.u32(SKY_FRAME), 'skyScroll': [vm.u32(SKY_SCROLL + 4 * r) for r in range(20)],
        'phase': vm.u32(PHASE),
    }
    if draw:
        vm.call(COMPOSE, limit=2_000_000_000)
        out['field'] = rows(draw_field(vm))
    return out


def tick(vm, draw: bool) -> dict:
    vm.call(TIMER, limit=2_000_000_000)
    return snapshot(vm, draw)


def start(exe: bytes, block: bytes, map_index: int):
    vm = resume_screen_battle(exe, block, map_index, OPTIONS)
    vm.stub_function(SOUND, 1, lambda vm, n: 0)  # 효과음(MCI)은 화면과 무관
    packed = encode_block(packed_block(vm))
    # 차례 시작 화면 이동(0x4147b3 → 0x4165bb)은 창 스크롤 대역에서 끝나지 않는다. 원작은 그것이 끝난 틱에 입력 시작(0x40546d)을 부르므로 끝난 것으로 둔다
    for i in range(vm.u32(EFFECT_COUNT)):
        vm.set_u32(EFFECTS + i * 0x7C + 0x28, vm.u32(EFFECTS + i * 0x7C + 0x28) | 0x80000000)
    vm.set_u32(EFFECT_COUNT, 0)
    return vm, packed


def make_case(exe: bytes, label: str, block: bytes, map_index: int, to=None) -> dict:
    vm, packed = start(exe, block, map_index)
    table = vm.u32(CONTROL)
    for side in (0, 1):
        vm.set_u32(table + side * 0x18, 0)
    actor = vm.u32(ACTOR)
    x, y = vm.read(vm.u32(actor + 0x68), 2)
    vm.call(LOAD_UI_GRAPHICS, limit=2_000_000_000)
    vm.call(INPUT_START, limit=2_000_000_000)
    assert vm.u32(PHASE) == 1
    idle = []
    pointer = None
    for t in range(16):
        if t == 7:  # 차례 유닛 표시 객체에서 두 칩 줄 아래로 마우스를 옮긴다
            sprite = vm.read(vm.u32(actor + 0x68), 4)
            vm.call(POINTER, (sprite[2] + 1) * 24, (sprite[3] + 4) * 12, 0, limit=2_000_000_000)
            cx, cy = vm.u32(CURSOR_CELL), vm.u32(CURSOR_CELL + 4)
            pointer = None if cx == 0xFFFFFFFF else [cx, cy]
        vm.call(TIMER, limit=2_000_000_000)
        idle.append(snapshot(vm, t in (5, 8)))
    vm.set_u32(SELECTED, actor)
    vm.call(SET_PHASE, 2, limit=2_000_000_000)
    ranged = [tick(vm, False) for _ in range(8)]
    stops = [(cx, cy) for cy in range(32) for cx in range(32) if vm.read(RANGE + (cy * 32 + cx) * 0x1F + 0x12, 1)[0] & 8]
    if to is None:
        to = max(stops, key=lambda c: ((c[0] - x) * 2 + (c[1] & 1) - (y & 1)) ** 2 + (c[1] - y) ** 2)
    assert tuple(to) in stops, (to, '멈출 수 없는 칸')
    vm.call(MOVE, to[0], to[1], AFTER_MOVE, limit=2_000_000_000)
    walk = []
    while vm.u32(PHASE) != 3:
        assert len(walk) < 200, '걷기가 끝나지 않음'
        vm.call(TIMER, limit=2_000_000_000)
        walk.append(snapshot(vm, len(walk) in (0, 3, 7)))
    print(label, (x, y), '→', to, len(walk), flush=True)
    return {'label': label, 'map': map_index, 'block': packed, 'to': list(to), 'pointer': pointer, 'idle': idle, 'ranged': ranged, 'walk': walk}


def make_cpu_case(exe: bytes, label: str, block: bytes, map_index: int, to) -> dict:
    vm, packed = start(exe, block, map_index)
    vm.stub_function(VISIBLE, 3, lambda vm, *a: 1)
    continued = []
    vm.stub_function(RUN_ACTION, 0, lambda vm: continued.append(1) or 0)
    vm.call(LOAD_UI_GRAPHICS, limit=2_000_000_000)  # 원작은 CPU 생각이 표식 그림 페이지를 작업 버퍼로 덮을 수 있다(스펙: 따라 하지 않음)
    vm.call(TURN_MARKER, limit=2_000_000_000)
    vm.call(SET_PHASE, 0, limit=2_000_000_000)
    idle = [tick(vm, t == 5) for t in range(8)]
    vm.call(CPU_DECISION, to[0] | to[1] << 5, limit=2_000_000_000)  # 대기 명령(종류 0, 방향 0)
    walk = []
    while not continued:
        assert len(walk) < 200, '걷기가 끝나지 않음'
        vm.call(TIMER, limit=2_000_000_000)
        walk.append(snapshot(vm, len(walk) in (0, 7)))
    out = vm._bump('heap', 16)
    boxes = []
    for r in (0, 1, 2):
        vm.call(CELL_BOX, to[0], to[1], r, out)
        boxes.append([int.from_bytes(vm.read(out + 4 * i, 4), 'little', signed=True) for i in range(4)])
    print(label, 'CPU →', to, len(walk), boxes, flush=True)
    return {'label': label, 'map': map_index, 'block': packed, 'to': list(to), 'cpu': True, 'boxes': boxes, 'idle': idle, 'walk': walk}


def main() -> None:
    exe = read_original('vmv2.exe')
    with open(os.path.join(GOLDEN, 'games.json')) as f:
        games = json.load(f)['cases']
    cases = []
    block = lambda g, k: zlib.decompress(base64.b64decode(games[g]['expected']['blocks'][k]))  # noqa: E731
    # 걷기 셋(서로 다른 맵), 비행 둘(0x415a11), 내리막 둘(0x415829 높이 유지), 지형 0xb 위를 지나는 비행(그림자 끔)
    for g, k, to in ((0, 0, None), (2, 0, None), (3, 20, None), (0, 3, None), (4, 2, None), (0, 11, (8, 14)), (2, 6, (16, 13)), (1, 27, (16, 21))):
        cases.append(make_case(exe, f'게임 {g} 블록 {k}', block(g, k), games[g]['args']['map'], to))
    # CPU 이동(0x406573): 걷기, 0xb 위 비행
    for g, k, to in ((2, 6, (16, 14)), (4, 2, (26, 8))):
        cases.append(make_cpu_case(exe, f'게임 {g} 블록 {k} CPU', block(g, k), games[g]['args']['map'], to))
    with open(os.path.join(GOLDEN, 'screen.json')) as f:
        status = next(c for c in json.load(f)['cases'] if '상태 이상' in c['args']['label'])
    cases.append(make_case(exe, status['args']['label'], zlib.decompress(base64.b64decode(status['args']['block'])), 3))
    write_fixture('walk', TIMER, cases)


if __name__ == '__main__':
    main()
