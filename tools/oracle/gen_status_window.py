"""전투 상태 창(Information window, CBattleStatus) 정답 픽스처. 실행: pnpm oracle status_window

게임 픽스처 블록과 screen 픽스처의 상태 이상 블록을 그래픽을 켠 되살리기(screen.py)로 올린다. 첫 차례 준비(0x401b12)가 창을 만들어
처음 그리고(0x40ace3 → 0x40b12a), 차례 진행이 커서를 차례 유닛 칸에 두며 다시 그린다(0x403c8e → 0x40aefd → 0x40b50d).
장면: (0) 그대로, (1) 커서 = 차례 유닛, (2) 다른 유닛, (3) 유닛 없는 칸, (4) 물 프레임 2로 (3)과 같은 칸, (5) 칸 밖.
장면마다 창 DIB(*0x476be8, 260 × 340, 줄 간격 0x104)의 줄 CRC32. 맵 이름표(0x5061f0[맵], 실행 중에 채움)도 담는다.
"""
import base64
import json
import os
import sys
import zlib

sys.path.insert(0, os.path.dirname(__file__))
from battle import encode_block, packed_block  # noqa: E402
from fixture import GOLDEN, write_fixture  # noqa: E402
from original import read_original  # noqa: E402
from screen import WATER_FRAME, resume_screen_battle  # noqa: E402

SET_CURSOR_INFO = 0x40AEFD   # (x, y, 유닛) 상태 창의 커서 칸·유닛, 다시 그림
UNIT_AT = 0x40FF5C           # (x, y) → 유닛 또는 0
ACTOR = 0x476B04
UNITS = 0x478E10             # 실행 중 유닛 표 0x6c바이트, 개수 0x47a398
UNIT_COUNT = 0x47A398
BITS = 0x476BE8              # → 창 DIB 비트
MAP_LABELS = 0x5061F0
W, H, PITCH = 260, 340, 0x104


def rows(vm) -> list:
    bits = vm.u32(BITS)
    image = vm.read(bits, PITCH * H)
    return [zlib.crc32(image[r * PITCH:r * PITCH + W]) for r in range(H)]


def cstr(vm, at: int) -> str:
    b = vm.read(at, 64)
    return b[:b.index(0)].decode('latin1')


def make_case(exe: bytes, label: str, block: bytes, map_index: int) -> dict:
    vm = resume_screen_battle(exe, block, map_index)
    packed = encode_block(packed_block(vm))
    actor = vm.u32(ACTOR)
    ax, ay = vm.read(vm.u32(actor + 0x68), 2)
    units = [UNITS + i * 0x6C for i in range(vm.u32(UNIT_COUNT)) if not int.from_bytes(vm.read(UNITS + i * 0x6C, 2), 'little') & 0x8000]
    other = next(u for u in units if u != actor)
    ox, oy = vm.read(vm.u32(other + 0x68), 2)
    empty = next((x, y) for d in range(1, 32) for (x, y) in ((ax, ay + d), (ax + d, ay), (ax, ay - d)) if 0 <= x < 32 and 0 <= y < 32 and vm.call(UNIT_AT, x, y) == 0)
    scenes = [{'cursor': None, 'unit': None, 'water': 0, 'rows': rows(vm)}]

    def scene(x: int, y: int, unit: int, water: int = 0) -> None:
        vm.set_u32(WATER_FRAME, water)
        vm.call(SET_CURSOR_INFO, x & 0xFFFFFFFF, y & 0xFFFFFFFF, unit, limit=2_000_000_000)
        slot = (unit - UNITS) // 0x6C if unit else None
        scenes.append({'cursor': [x, y] if x >= 0 else None, 'unit': slot, 'water': water, 'rows': rows(vm)})

    scene(ax, ay, actor)
    scene(ox, oy, other)
    scene(*empty, 0)
    scene(*empty, 0, 2)
    scene(-1, -1, 0)
    print(label, len(scenes), flush=True)
    return {'label': label, 'map': map_index, 'block': packed, 'mapLabel': cstr(vm, vm.u32(MAP_LABELS + map_index * 4)), 'scenes': scenes}


def main() -> None:
    exe = read_original('vmv2.exe')
    cases = []
    with open(os.path.join(GOLDEN, 'games.json')) as f:
        games = json.load(f)['cases']
    for g, game in enumerate(games):
        blocks = game['expected']['blocks']
        for k in (0, len(blocks) // 2, len(blocks) - 2):
            cases.append(make_case(exe, f'게임 {g} 블록 {k}', zlib.decompress(base64.b64decode(blocks[k])), game['args']['map']))
    with open(os.path.join(GOLDEN, 'screen.json')) as f:
        for c in (c for c in json.load(f)['cases'] if '상태 이상' in c['args']['label']):
            cases.append(make_case(exe, c['args']['label'], zlib.decompress(base64.b64decode(c['args']['block'])), 3))
    write_fixture('statusWindow', SET_CURSOR_INFO, cases)


if __name__ == '__main__':
    main()
