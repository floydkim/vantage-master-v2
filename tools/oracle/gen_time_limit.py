"""전투 중 시간 제한 정답 픽스처. 실행: pnpm oracle time_limit

게임 픽스처 블록을 그래픽을 켠 되살리기(screen.py)로 올린 뒤 원작 함수를 그대로 부른다. timeGetTime은 정해 준 시각을 돌려준다.
- start: 차례 유닛이 마스터·네이티얼인 블록에 시간 제한 0~3을 넣고 사람 입력 시작 0x4055cf → 켬·L(초)·R(1/6초)·연장 칸 진영
- tick: 타이머 전역을 직접 두고 시각 열마다 0x407926(p) → R·L·연장·켬·효과음·강제 Stand by(0x406cd2)·돌려준 값
- strip: 시간 제한 1에서 (켬, R, 연장 칸 값)마다 0x40b50d → 창 DIB 줄 300~339 CRC(같은 창에 이어 그림)
- shownSide: 조종 넷에서 되살린 뒤 연장 아이콘 진영(0x476af0: 0x401d98 → 0x40536c)
"""
import base64
import json
import os
import sys
import zlib

sys.path.insert(0, os.path.dirname(__file__))
from fixture import GOLDEN, write_fixture  # noqa: E402
from original import read_original  # noqa: E402
from screen import resume_screen_battle, thiscall  # noqa: E402

START_INPUT = 0x4055CF
TICK = 0x407926
ON = 0x476ADC
REMAIN = 0x476AE0
LIMIT = 0x476B34
START = 0x476B80
EXT_PTR = 0x476B00      # → 차례 진영의 연장 칸
SHOWN = 0x476AF0        # → 아이콘에 보일 연장 칸(없으면 0)
WARN = 0x476B5C         # 경고 플래그 넷
PHASE = 0x476AF4
ACTOR = 0x476B04
EXT = 0x4CD674          # 블록 +0xe64
BLOCK_TIME_LIMIT = 0x4CC824  # 블록 +0x14
SIDE_STATES = 0x9EC     # 블록 안 진영 상태(24바이트 × 2)
STATUS = 0x476C00
BITS = 0x476BE8
W, PITCH = 260, 0x104
SOUND = 0x443D19


def blocks():
    with open(os.path.join(GOLDEN, 'games.json')) as f:
        game = json.load(f)['cases'][0]
    return game['args']['map'], [zlib.decompress(base64.b64decode(b)) for b in game['expected']['blocks']]


def resume(exe, block: bytes, map_index: int, time_limit: int, controllers=(0, 0)):
    b = bytearray(block)
    b[0x14:0x18] = time_limit.to_bytes(4, 'little')
    ext = [1, 3, 5, 0][time_limit]
    b[0xE64:0xE6C] = ext.to_bytes(4, 'little') * 2
    for s, c in enumerate(controllers):
        b[SIDE_STATES + s * 0x18:SIDE_STATES + s * 0x18 + 4] = c.to_bytes(4, 'little')
    vm = resume_screen_battle(exe, bytes(b), map_index)
    vm.now = 0
    for full in [k for k in vm._api_names.values() if k.endswith('!timeGetTime')]:
        vm.stub_api(full, 0, lambda vm: vm.now)
    vm.sounds = []
    vm.stub_function(SOUND, 1, lambda vm, n: vm.sounds.append(n) or 0)
    vm.forced = 0
    vm.stub_function(0x406CD2, 2, lambda vm, a, b: setattr(vm, 'forced', vm.forced + 1) or 0)
    for address in (0x418451, 0x4183AD, 0x44F801, 0x406560):  # 채팅 기록·네트워크(프리 배틀에서 안 보임)
        vm.stub_function(address, 0, lambda vm, *a: 0)
    return vm


def is_master(vm) -> bool:
    return not int.from_bytes(vm.read(vm.u32(ACTOR), 2), 'little') & 0x4000


def side_of(vm, pointer: int):
    return None if pointer == 0 else (pointer - EXT) // 4


def start_cases(exe, map_index, all_blocks) -> list:
    out, seen = [], set()
    for k, block in enumerate(all_blocks):
        vm = resume(exe, block, map_index, 0)
        kind = is_master(vm)
        if kind in seen:
            continue
        seen.add(kind)
        for tl in range(4):
            vm.set_u32(BLOCK_TIME_LIMIT, tl)
            vm.set_u32(ON, 0)
            vm.now = 5000
            vm.call(START_INPUT, limit=2_000_000_000)
            out.append({'kind': 'start', 'args': {'block': k, 'timeLimit': tl, 'master': kind},
                        'expected': {'on': vm.u32(ON), 'limit': vm.u32(LIMIT), 'remaining': vm.u32(REMAIN), 'start': vm.u32(START),
                                     'side': side_of(vm, vm.u32(EXT_PTR)), 'sounds': list(vm.sounds)}})
            vm.sounds.clear()
        if len(seen) == 2:
            break
    return out


def tick_case(vm, time_limit: int, limit: int, extensions: int, start: int, steps: list) -> dict:
    vm.set_u32(BLOCK_TIME_LIMIT, time_limit)
    vm.set_u32(EXT, extensions)
    vm.set_u32(EXT_PTR, EXT)
    vm.set_u32(ON, 1)
    vm.set_u32(START, start)
    vm.set_u32(LIMIT, limit)
    vm.set_u32(REMAIN, limit * 6)
    vm.set_u32(PHASE, 3)
    for k in range(4):
        vm.set_u32(WARN + 4 * k, 0)
    out = []
    for now, p in steps:
        vm.now = now & 0xFFFFFFFF
        vm.sounds.clear()
        vm.forced = 0
        ret = vm.call(TICK, p, limit=2_000_000_000)
        out.append({'remaining': vm.u32(REMAIN), 'limit': vm.u32(LIMIT), 'extensions': vm.u32(EXT), 'on': vm.u32(ON),
                    'sounds': list(vm.sounds), 'forced': vm.forced, 'ret': ret})
    return {'kind': 'tick', 'args': {'timeLimit': time_limit, 'limit': limit, 'extensions': extensions, 'start': start, 'steps': steps},
            'expected': {'steps': out}}


def tick_cases(exe, map_index, block) -> list:
    vm = resume(exe, block, map_index, 0)
    s = 1000
    return [
        # SHORT 마스터 30초, 연장 1: 10초·3·2·1초 경고, 만료 → 연장(30초), 다시 10초 경고, 연장 없이 만료 → 강제
        tick_case(vm, 0, 30, 1, s, [[s + t, 1] for t in (0, 1000, 19900, 20000, 20200, 25000, 26900, 27000, 28000, 29000, 29500, 29999,
                                                         30000, 31000, 50000, 59000, 59999, 60000, 60048)]),
        # MIDDLE 60초, 연장 3: 걷는 중(p = 0) 만료마다 연장, 다 쓰면 R = 0이어도 멈추지 않다가 p = 1에 강제
        tick_case(vm, 1, 60, 3, s, [[s + t, 0] for t in (0, 60000, 120000, 180000, 240000, 240048)] + [[s + 241000, 1]]),
        # LONG 120초, 연장 5: 큰 건너뜀(연장 셋 한꺼번에), 다시 넘침(남은 연장보다 많음 → 0)
        tick_case(vm, 2, 120, 5, s, [[s, 1], [s + 165000, 1], [s + 1000000, 1]]),
        # SHORT 네이티얼 15초: timeGetTime 감김, ×6 넘침(약 716초 넘게 멈춤)
        tick_case(vm, 0, 15, 1, 0xFFFFF000, [[0xFFFFF000 + 0x1800, 1], [0xFFFFF000 + 14000, 1]]),
        tick_case(vm, 2, 60, 5, s, [[s + 800000, 0], [s + 800048, 1]]),
    ]


def strip_case(exe, map_index, block) -> dict:
    vm = resume(exe, block, map_index, 1, controllers=(0, 1))
    st = vm.u32(STATUS)
    steps, rows = [], []
    combos = [(1, r, 3) for r in (400, 361, 360, 359, 358, 357, 200, 17, 6, 1, 0)] + [(1, 200, e) for e in (5, 4, 2, 1, 0)] + [(0, 200, 0), (0, 0, 3), (1, 359, 3)]
    for on, r, ext in combos:
        vm.set_u32(EXT, ext)
        vm.set_u32(SHOWN, EXT)
        vm.set_u32(ON, on)
        vm.set_u32(REMAIN, r)
        thiscall(vm, 0x40B50D, st, limit=2_000_000_000)
        image = vm.read(vm.u32(BITS), PITCH * 340)
        steps.append([on, r, ext])
        rows.append([zlib.crc32(image[y * PITCH:y * PITCH + W]) for y in range(300, 340)])
    vm.set_u32(SHOWN, 0)
    thiscall(vm, 0x40B50D, st, limit=2_000_000_000)
    image = vm.read(vm.u32(BITS), PITCH * 340)
    steps.append([1, 359, None])
    rows.append([zlib.crc32(image[y * PITCH:y * PITCH + W]) for y in range(300, 340)])
    return {'kind': 'strip', 'args': {'timeLimit': 1, 'steps': steps}, 'expected': {'rows': rows}}


def shown_cases(exe, map_index, block) -> list:
    out = []
    for controllers in ((0, 1), (1, 0), (0, 0), (1, 1)):
        vm = resume(exe, block, map_index, 1, controllers=controllers)
        actor_side = vm.read(vm.u32(ACTOR) + 4, 1)[0]
        out.append({'kind': 'shownSide', 'args': {'controllers': list(controllers), 'actorSide': actor_side}, 'expected': {'side': side_of(vm, vm.u32(SHOWN))}})
    return out


def main() -> None:
    exe = read_original('vmv2.exe')
    map_index, all_blocks = blocks()
    cases = start_cases(exe, map_index, all_blocks)
    print('start', len(cases), flush=True)
    cases += tick_cases(exe, map_index, all_blocks[0])
    print('tick', flush=True)
    cases.append(strip_case(exe, map_index, all_blocks[0]))
    cases += shown_cases(exe, map_index, all_blocks[0])
    for c in cases:
        if c['kind'] in ('strip',):
            c['args']['block'] = 0
            c['args']['map'] = map_index
    write_fixture('timeLimit', TICK, cases)


if __name__ == '__main__':
    main()
