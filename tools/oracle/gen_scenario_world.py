"""시나리오 월드·결과 END 정답 픽스처. 실행: pnpm oracle scenario_world

그래픽을 켠 원작으로 Master making(0x426d90 대역)을 건너뛴 시나리오 시작을 만든다.
0x450da0(모드 0·1)·0x450e35(Expert) → 이름(0x483efc)·0x42d190(마스터 9) → 0x45102d(월드 창들).
- world: 모드·맵 플래그(0x475b98 → 블록 +0x198)·고른 맵·마우스 위·프레임마다 지도 + 0x452175, 32줄 띠 CRC
- select: 0x4514a2(맵, 0) 뒤 맵 정보 DIB 20줄 띠 CRC(깬 맵 덮개·보상 아이템)·DIB 색 표·적 진영(진영 1) 레코드·마스터 정보 편집 가능(+8)
- click: 시나리오 월드에서 마스터 정보 누르기(0x42bd5e: 아이콘·초상·조종 칸)와 맵 정보 누르기(0x42aa8f: 열린 맵·깬 맵의 READY, 시간 제한).
  소리, READY(0x45042d 대역) 불림, 편집 상자(0x483ef8), 진영 0·1 목록·조종
- end: 결과 창 END(0x408034). 0x407fae(결과 창 닫기)·0x44fd31(월드로)·0x424dca는 대역이다.
  이긴 진영 0x476bd4, 전투 통계(0x476bd0이 가리키는 곳), 진영 상태 0 +0xc를 둔다.
  다음(0x504008), 장면 종류(0x48341c), 0x44fd31을 불렀는지, 블록의 맵 플래그·통계 59칸·진영 0 레코드를 담는다.
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

EXE = read_original('vmv2.exe')
SCENARIO, EXPERT, MAKE_MASTER = 0x450DA0, 0x450E35, 0x426D90
MODE, NAME, PLAYER, OPEN_WORLD = 0x5061CC, 0x483EFC, 0x42D190, 0x45102D
FLAGS = 0x475B98           # → 블록 +0x198
SELECT = 0x4514A2          # (맵, 강제)
WORLD, WORLD_BITS, DRAW_WORLD = 0x5061EC, 0x5061E0, 0x452175
SELECTED = 0x5061E8
MAP_INFO, MAP_INFO_BITS, DRAW_MAP_INFO = 0x483EDC, 0x483ED8, 0x429EEC
MASTER_INFO = 0x483EF4
SIDES, SIDE_STATES = 0x45E0E8, 0x45E0EC
END, WINNER, BATTLE_STATS, KIND, DEFERRED = 0x408034, 0x476BD4, 0x476BD0, 0x48341C, 0x504008
BLOCK = 0x4CC810


def bands(img: bytes, width: int, rows: int) -> list:
    return [zlib.crc32(img[r * width:(r + rows) * width]) for r in range(0, len(img) // width, rows)]


def boot(mode: int):
    vm = Booted(EXE)
    install_gdi(vm)
    vm.sounds, vm.bgm, vm.called = [], [], []
    vm.stub_function(0x443D19, 1, lambda vm, n: vm.sounds.append(n) or 0)
    vm.stub_function(0x443770, 1, lambda vm, n: vm.bgm.append(n) or 0)
    vm.stub_function(MAKE_MASTER, 0, lambda vm: 1)
    thiscall(vm, 0x42EB50, PALETTE, 0x5000)
    vm.call(0x423B2F, limit=2_000_000_000)
    if mode == 2:
        vm.call(EXPERT, limit=4_000_000_000)
    else:
        vm.set_u32(vm.u32(MODE), mode)
        vm.call(SCENARIO, limit=4_000_000_000)
    vm.write(NAME, b'Floyd\0')
    vm.call(PLAYER, 9)
    vm.call(OPEN_WORLD, limit=8_000_000_000)
    return vm


def set_flags(vm, flags: list) -> None:
    vm.write(vm.u32(FLAGS), struct.pack('<52i', *flags))


def world_image(vm) -> bytes:
    obj, bits = vm.u32(WORLD), vm.u32(WORLD_BITS)
    vm.write(bits, vm.read(vm.u32(obj + 0x3C), 0x60000))
    thiscall(vm, DRAW_WORLD, obj, bits)
    return vm.read(bits, 768 * 512)


def side(vm, n: int) -> str:
    return vm.read(vm.u32(SIDES) + n * 0xC0, 0xC0).hex()


def flags_of(mode: int, cleared: list, opened: list) -> list:
    f = [0] * 52
    for m in opened:
        f[m] = 1
    for m in cleared:
        f[m] = 2
    return f


START = {0: flags_of(0, [], range(4)), 1: flags_of(1, [], range(4)), 2: flags_of(2, [], [30])}
MIDDLE = {0: flags_of(0, [0, 2], range(8)), 1: flags_of(1, [0, 2], range(8)), 2: flags_of(2, [30, 31], [32])}


def main() -> None:
    cases = []
    for mode in (0, 1, 2):
        vm = boot(mode)
        obj = vm.u32(WORLD)
        for name, flags in (('start', START[mode]), ('middle', MIDDLE[mode])):
            set_flags(vm, flags)
            for sel, hover, frame in ((-1, -1, 0), (0 if mode != 2 else 30, -1, 3), (2 if mode != 2 else 31, 1 if mode != 2 else 32, 5)):
                vm.set_u32(vm.u32(SELECTED), sel & 0xFFFFFFFF)
                vm.set_u32(obj + 0x48, hover & 0xFFFFFFFF)
                vm.set_u32(obj + 0x44, frame)
                cases.append({'kind': 'world', 'args': {'mode': mode, 'flags': flags, 'selected': sel, 'hover': hover, 'frame': frame},
                              'expected': {'bands': bands(world_image(vm), 768, 32)}})
        set_flags(vm, MIDDLE[mode])
        vm.set_u32(vm.u32(SELECTED), 0xFFFFFFFF)
        for m in ((0, 2, 4, 26) if mode != 2 else (30, 32, 37)):
            vm.sounds.clear()
            vm.call(SELECT, m, 0, limit=4_000_000_000)
            mi = vm.u32(MAP_INFO)
            vm.set_u32(mi + 0x1C, 0xFFFFFFFF)
            vm.set_u32(mi + 0x20, 0)
            thiscall(vm, DRAW_MAP_INFO, mi)
            cases.append({'kind': 'select', 'args': {'mode': mode, 'flags': MIDDLE[mode], 'map': m},
                          'expected': {'bands': bands(vm.read(vm.u32(MAP_INFO_BITS), 308 * 340), 308, 20), 'colors': palette(vm)[40:246 * 4].hex(),
                                       'enemy': side(vm, 1), 'editable': vm.u32(vm.u32(MASTER_INFO) + 8), 'sounds': list(vm.sounds)}})
    # 결과 END: (모드, 플래그, 고른 맵, 이긴 진영)
    every = flags_of(0, [m for m in range(30) if m != 29], [29])
    for mode, flags, sel, winner in ((0, START[0], 0, 0), (0, flags_of(0, [0], range(4)), 1, 0), (0, MIDDLE[0], 1, 0), (0, MIDDLE[0], 1, 1), (0, MIDDLE[0], 1, 0xFFFFFFFF), (0, MIDDLE[0], 0, 0),
                                     (1, flags_of(1, list(range(26)), [26, 27, 28, 29]), 26, 0), (1, every, 29, 0),
                                     (2, START[2], 30, 0), (2, flags_of(2, list(range(30, 37)), [37]), 37, 0)):
        vm = boot(mode)
        set_flags(vm, flags)
        vm.set_u32(vm.u32(SELECTED), sel)
        vm.set_u32(WINNER, winner)
        stats = vm._bump('heap', 4 * (1 + 2 * 0x39))
        values = [(k * 13 + 5) % 97 for k in range(1 + 2 * 0x39)]
        vm.write(stats, struct.pack(f'<{len(values)}i', *values))
        vm.set_u32(BATTLE_STATS, stats)
        vm.set_u32(vm.u32(SIDE_STATES) + 0xC, 7)
        vm.stub_function(0x407FAE, 0, lambda vm: vm.called.append('close') or 0)
        vm.stub_function(0x44FD31, 0, lambda vm: vm.called.append('world') or 0)
        vm.stub_function(0x424DCA, 0, lambda vm: vm.called.append('help') or 0)
        before = side(vm, 0)
        vm.call(END, limit=8_000_000_000)
        cases.append({'kind': 'end', 'args': {'mode': mode, 'flags': flags, 'selected': sel, 'winner': struct.unpack('<i', struct.pack('<I', winner))[0],
                                                'stats': values, 'days': 7 - 2, 'side': before},
                      'expected': {'next': vm.u32(DEFERRED), 'kind': struct.unpack('<i', vm.read(KIND, 4))[0], 'called': vm.called,
                                   'flags': list(struct.unpack('<52i', vm.read(vm.u32(FLAGS), 52 * 4))),
                                   'stats': list(struct.unpack('<59i', vm.read(BLOCK + 0xD78, 59 * 4))), 'side': side(vm, 0)}})
    # 누르기: Normal, 맵 플래그 MIDDLE(맵 0·2 깸), 맵 1(열림)·맵 0(깸)을 고른 뒤
    for m in (1, 0):
        vm = boot(1)
        set_flags(vm, MIDDLE[1])
        vm.started = 0
        vm.stub_function(0x45042D, 0, lambda vm: setattr(vm, 'started', vm.started + 1) or 0)
        vm.call(SELECT, m, 0, limit=4_000_000_000)
        mi, ms = vm.u32(MAP_INFO), vm.u32(MASTER_INFO)
        clicks = []
        for name, fn, obj, x, y in (('mapInfo READY', 0x42AA8F, mi, 240, 230), ('mapInfo SHORT', 0x42AA8F, mi, 240, 255),
                                    ('masterInfo 아이콘', 0x42BD5E, ms, 30, 100), ('masterInfo 초상', 0x42BD5E, ms, 40, 30), ('masterInfo 조종', 0x42BD5E, ms, 100, 290)):
            vm.sounds.clear()
            before = [side(vm, 0), side(vm, 1), vm.u32(vm.u32(SIDE_STATES)), vm.u32(vm.u32(SIDE_STATES) + 0x18)]
            started = vm.started
            thiscall(vm, fn, obj, x, y, limit=4_000_000_000)
            after = [side(vm, 0), side(vm, 1), vm.u32(vm.u32(SIDE_STATES)), vm.u32(vm.u32(SIDE_STATES) + 0x18)]
            clicks.append({'name': name, 'x': x, 'y': y, 'sounds': list(vm.sounds), 'started': vm.started - started,
                           'edit': vm.u32(0x483EF8) != 0, 'changed': before != after,
                           'hover': struct.unpack('<i', vm.read((mi if fn == 0x42AA8F else ms) + (0x1C if fn == 0x42AA8F else 0xC), 4))[0]})
            vm.set_u32(0x483EF8, 0)
        cases.append({'kind': 'click', 'args': {'mode': 1, 'flags': MIDDLE[1], 'map': m}, 'expected': {'clicks': clicks}})
    write_fixture('scenarioWorld', 0x45102D, cases)


if __name__ == '__main__':
    main()
