"""프리 모드 월드 장면 정답 픽스처(월드 창·맵 정보 창·마스터 정보 창). 실행: pnpm oracle world

그래픽을 켠 원작으로 프리 모드 메뉴(0x450ed7 → 0x45102d → 0x4516f4)를 그대로 돌린다. 효과음(0x443d19)은 기록 대역이다.
- 월드 DIB(768 × 512): 고른 맵 × 마우스 위 × 깜빡임 프레임마다 지도 복사 + 0x452175, 32줄 띠 CRC. 점 판정 0x452385 경계.
- 맵 정보 DIB(308 × 340): 맵 0~51을 0x4514a2(맵, 0)로 고른 뒤, 맵 3에서 마우스 위 × 프레임 × 시간 제한(0x429db7). 20줄 띠 CRC. 판정 0x42ab35.
- 마스터 정보 DIB(416 × 416): 마우스 위 H마다 0x42b5c2, 토글(0x42b4ab)·조종(0x42b502) 뒤 목록·조종, 16줄 띠 CRC. 판정 0x42bef4(편집 가능 1·0).
- 팔레트: 맵을 고르기 전과 뒤(DIB 색 표 10~245)
"""
import os
import struct
import sys
import zlib

sys.path.insert(0, os.path.dirname(__file__))
from boot import Booted  # noqa: E402
from fixture import write_fixture  # noqa: E402
from original import read_original  # noqa: E402
from screen import PALETTE, install_gdi, palette, thiscall  # noqa: E402

FREE_MODE = 0x450ED7
SELECT = 0x4514A2          # (맵, 강제)
WORLD = 0x5061EC
WORLD_BITS = 0x5061E0
DRAW_WORLD = 0x452175
HIT_WORLD = 0x452385
SELECTED = 0x5061E8        # → 블록 +0x2d4
MAP_INFO = 0x483EDC
MAP_INFO_BITS = 0x483ED8
DRAW_MAP_INFO = 0x429EEC
HIT_MAP_INFO = 0x42AB35
TIME_LIMIT = 0x429DB7
MASTER_INFO = 0x483EF4
MASTER_INFO_BITS = 0x483EE8
DRAW_MASTER_INFO = 0x42B5C2
HIT_MASTER_INFO = 0x42BEF4
TOGGLE = 0x42B4AB          # (진영 × 30 + 아이템)
CONTROLLER = 0x42B502      # (진영)
SIDES = 0x45E0E8
SIDE_STATES = 0x45E0EC
POINTS = 0x4759F8


def bands(img: bytes, width: int, rows: int) -> list:
    return [zlib.crc32(img[r * width:(r + rows) * width]) for r in range(0, len(img) // width, rows)]


def boot():
    vm = Booted(read_original('vmv2.exe'))
    install_gdi(vm)
    vm.sounds = []
    vm.stub_function(0x443D19, 1, lambda vm, n: vm.sounds.append(n) or 0)
    thiscall(vm, 0x42EB50, PALETTE, 0x5000)
    vm.call(0x423B2F, limit=2_000_000_000)
    vm.call(FREE_MODE, limit=4_000_000_000)
    return vm


def world_image(vm) -> bytes:
    obj, bits = vm.u32(WORLD), vm.u32(WORLD_BITS)
    vm.write(bits, vm.read(vm.u32(obj + 0x3C), 0x60000))
    thiscall(vm, DRAW_WORLD, obj, bits)
    return vm.read(bits, 768 * 512)


def colors(vm) -> str:
    return palette(vm)[40:246 * 4].hex()


def side_lists(vm) -> list:
    out = []
    for s in (0, 1):
        r = vm.u32(SIDES) + s * 0xC0
        out.append({'spells': list(struct.unpack('<7i', vm.read(r + 0x1C, 28))), 'natials': list(struct.unpack('<25i', vm.read(r + 0x38, 100))),
                    'controller': vm.u32(vm.u32(SIDE_STATES) + s * 0x18)})
    return out


def main() -> None:
    vm = boot()
    cases = [{'kind': 'palette', 'args': {'map': None}, 'expected': {'colors': colors(vm)}}]
    obj = vm.u32(WORLD)
    for sel in (-1, 3, 51):
        for hover, frame in ((-1, 0), (-1, 3), (0, 0), (0, 5), (3, 7), (51, 1), (51, 7)):
            vm.set_u32(vm.u32(SELECTED), sel & 0xFFFFFFFF)
            vm.set_u32(obj + 0x48, hover & 0xFFFFFFFF)
            vm.set_u32(obj + 0x44, frame)
            cases.append({'kind': 'world', 'args': {'selected': sel, 'hover': hover, 'frame': frame}, 'expected': {'bands': bands(world_image(vm), 768, 32)}})
    points = []
    for i in range(52):
        x, y = struct.unpack('<2i', vm.read(POINTS + i * 8, 8))
        for dx, dy in ((-8, -8), (7, 7), (-9, 0), (8, 0), (0, -9), (0, 8)):
            points.append([x + dx, y + dy, struct.unpack('<i', struct.pack('<I', thiscall(vm, HIT_WORLD, obj, x + dx, y + dy)))[0]])
    cases.append({'kind': 'worldHit', 'args': {}, 'expected': {'points': points}})
    vm.set_u32(vm.u32(SELECTED), 0xFFFFFFFF)
    vm.set_u32(obj + 0x48, 0xFFFFFFFF)
    vm.set_u32(obj + 0x44, 0)
    for m in range(52):
        vm.sounds.clear()
        vm.call(SELECT, m, 0, limit=4_000_000_000)
        mi = vm.u32(MAP_INFO)
        vm.set_u32(mi + 0x1C, 0xFFFFFFFF)
        vm.set_u32(mi + 0x20, 0)
        thiscall(vm, DRAW_MAP_INFO, mi)
        cases.append({'kind': 'mapInfo', 'args': {'map': m, 'hover': -1, 'frame': 0, 'timeLimit': 3},
                      'expected': {'bands': bands(vm.read(vm.u32(MAP_INFO_BITS), 308 * 340), 308, 20), 'sounds': list(vm.sounds), 'colors': colors(vm)}})
    vm.call(SELECT, 3, 0, limit=4_000_000_000)
    mi = vm.u32(MAP_INFO)
    for hover, frame in ((0, 0), (0, 5), (-1, 5), (2, 0), (5, 3)):
        vm.set_u32(mi + 0x1C, hover & 0xFFFFFFFF)
        vm.set_u32(mi + 0x20, frame)
        thiscall(vm, DRAW_MAP_INFO, mi)
        cases.append({'kind': 'mapInfo', 'args': {'map': 3, 'hover': hover, 'frame': frame, 'timeLimit': 3}, 'expected': {'bands': bands(vm.read(vm.u32(MAP_INFO_BITS), 308 * 340), 308, 20)}})
    vm.set_u32(mi + 0x1C, 0xFFFFFFFF)
    vm.set_u32(mi + 0x20, 0)
    for tl in (0, 1, 2, 2, 3):
        vm.sounds.clear()
        vm.call(TIME_LIMIT, tl, limit=400_000_000)
        cases.append({'kind': 'mapInfo', 'args': {'map': 3, 'hover': -1, 'frame': 0, 'timeLimit': tl}, 'expected': {'bands': bands(vm.read(vm.u32(MAP_INFO_BITS), 308 * 340), 308, 20), 'sounds': list(vm.sounds)}})
    points = []
    for x in (87, 88, 215, 216, 219, 220, 267, 268):
        for y in (219, 220, 243, 244, 247, 248, 259, 260, 265, 266, 267, 268, 285, 286, 327, 328):
            points.append([x, y, struct.unpack('<i', struct.pack('<I', thiscall(vm, HIT_MAP_INFO, mi, x, y)))[0]])
    cases.append({'kind': 'mapInfoHit', 'args': {}, 'expected': {'points': points}})
    ms = vm.u32(MASTER_INFO)
    for h in (-1, 0, 1, 2, 7, 25, 31, 32, 33, 34, 57, 63):
        vm.set_u32(ms + 0xC, h & 0xFFFFFFFF)
        thiscall(vm, DRAW_MASTER_INFO, ms)
        cases.append({'kind': 'masterInfo', 'args': {'hover': h, 'editable': 1}, 'expected': {'bands': bands(vm.read(vm.u32(MASTER_INFO_BITS), 416 * 416), 416, 16)}})
    vm.set_u32(ms + 0xC, 0xFFFFFFFF)
    for step in ([('toggle', 4)], [('toggle', 0), ('toggle', 4)], [('toggle', 30 + 26), ('toggle', 30 + 24)], [('controller', 0), ('controller', 1)], [('controller', 1)]):
        vm.sounds.clear()
        for kind, n in step:
            vm.call(TOGGLE if kind == 'toggle' else CONTROLLER, n, limit=400_000_000)
        cases.append({'kind': 'masterInfo', 'args': {'hover': -1, 'editable': 1, 'steps': [list(s) for s in step]},
                      'expected': {'bands': bands(vm.read(vm.u32(MASTER_INFO_BITS), 416 * 416), 416, 16), 'sides': side_lists(vm), 'sounds': list(vm.sounds)}})
    points = []
    for editable in (1, 0):
        vm.set_u32(ms + 8, editable)
        for x in (15, 16, 23, 24, 47, 48, 135, 136, 175, 176, 239, 240, 264, 359, 360, 399, 400):
            for y in (15, 16, 91, 92, 93, 94, 129, 130, 273, 274, 281, 282, 297, 298):
                points.append([editable, x, y, struct.unpack('<i', struct.pack('<I', thiscall(vm, HIT_MASTER_INFO, ms, x, y)))[0]])
    vm.set_u32(ms + 8, 1)
    cases.append({'kind': 'masterInfoHit', 'args': {}, 'expected': {'points': points}})
    print(len(cases), flush=True)
    write_fixture('world', DRAW_WORLD, cases)


if __name__ == '__main__':
    main()
