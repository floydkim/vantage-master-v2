"""타이틀 장면(장면 1) 정답 픽스처. 실행: pnpm oracle title

그래픽을 켠 원작으로 AVI를 건너뛴 경로(상태 0 → 0x42608f → 장면 1 → 0x426c24 → 0x426c7c)를 만들고, 48ms 콜백 0x426ca9 첫 틱에 메뉴를 띄운다.
해독 메모 notes_title.md §2~§4.
- palette: DIB 색 표 10~245
- title: 마우스 위 −1·0~5(0x42697e)마다 DIB 32줄 띠 CRC. 돌아오는 경로(0x425fa0)의 DIB가 같은지
- hit: 판정 0x4269d0 격자
- glint: 첫 틱(T0 = 1) 뒤 콜백을 틱마다 불러 바뀐 틱의 띠 CRC(틱 2~230, 395~430)
- click: 항목 −1·0~5의 효과음(0x426a3a, 다음 장면 함수는 대역)
"""
import os
import sys
import zlib

sys.path.insert(0, os.path.dirname(__file__))
from boot import Booted  # noqa: E402
from fixture import write_fixture  # noqa: E402
from original import read_original  # noqa: E402
from screen import PALETTE, install_gdi, palette, thiscall  # noqa: E402

STATE, OBJ, BITS, HOVER = 0x483E98, 0x483EAC, 0x483E9C, 0x483EA0
TICK = 0x426CA9
COUNTER = 0x503DEC  # 16ms 카운터(48ms 콜백은 3씩)
EXE = read_original('vmv2.exe')


def boot(path='skip'):
    vm = Booted(EXE)
    install_gdi(vm)
    vm.sounds, vm.bgm = [], []
    vm.stub_function(0x443D19, 1, lambda vm, n: vm.sounds.append(n) or 0)
    vm.stub_function(0x443770, 1, lambda vm, n: vm.bgm.append(n) or 0)
    thiscall(vm, 0x42EB50, PALETTE, 0x5000)
    vm.call(0x423B2F, limit=2_000_000_000)
    if path == 'return':
        vm.call(0x425FA0, limit=8_000_000_000)
    else:
        vm.set_u32(STATE, 0)
        assert vm.call(0x42608F, limit=2_000_000_000) == 1
        vm.set_u32(0x503FC8, 1)
        vm.call(0x426C24, limit=4_000_000_000)
        vm.call(0x426C7C, limit=4_000_000_000)
    tick(vm)
    return vm


def tick(vm):
    vm.set_u32(COUNTER, (vm.u32(COUNTER) - 3) & 0xFFFFFFFF)
    vm.call(TICK, limit=8_000_000_000)


def dib(vm) -> bytes:
    return vm.read(vm.u32(BITS), 768 * 512)


def bands(img: bytes) -> list:
    return [zlib.crc32(img[r * 768:(r + 32) * 768]) for r in range(0, 512, 32)]


def signed(v):
    return v - (1 << 32) if v >> 31 else v


def main() -> None:
    cases = []
    vm = boot()
    base = dib(vm)
    cases.append({'kind': 'palette', 'args': {}, 'expected': {'colors': palette(vm)[40:246 * 4].hex(), 'state': vm.u32(STATE), 'bgm': vm.bgm}})
    obj = vm.u32(OBJ)
    for h in range(-1, 6):
        thiscall(vm, 0x42697E, obj, 0x150, 0x150 + 20 * h + 4 if h >= 0 else 10, 0)
        cases.append({'kind': 'title', 'args': {'hover': h}, 'expected': {'hover': signed(vm.u32(HOVER)), 'bands': bands(dib(vm))}})
    thiscall(vm, 0x42697E, obj, 10, 10, 0)
    points = []
    for x in (0, 315, 316, 380, 451, 452, 767):
        for y in (0, 335, 336, 351, 352, 355, 356, 371, 372, 376, 391, 396, 411, 416, 431, 436, 451, 452, 511):
            points.append([x, y, signed(vm.call(0x4269D0, x, y))])
    cases.append({'kind': 'hit', 'args': {}, 'expected': {'points': points}})
    vm2 = boot('return')
    cases.append({'kind': 'return', 'args': {}, 'expected': {'sameDib': dib(vm2) == base, 'bgm': vm2.bgm, 'state': vm2.u32(STATE)}})
    # 반짝임: 틱 1 = 메뉴가 뜬 틱(T0)
    ticks = []
    last = bands(dib(vm))
    for t in range(2, 431):
        tick(vm)
        if 230 < t < 395:
            continue
        now = bands(dib(vm))
        if now != last or t in (2, 230, 395, 430):
            ticks.append([t, now])
        last = now
    cases.append({'kind': 'glint', 'args': {'t0': 1}, 'expected': {'ticks': ticks}})
    # 클릭(0x426a3a): 효과음, 부른 다음 장면 함수(대역, 0을 돌려줌: 대화 상자 Cancel·실패), 클릭 뒤 마우스 위, 타이틀이 닫혔는지, 프레임 DestroyWindow
    clicks = {}
    for item in (-1, 0, 1, 2, 3, 4, 5):
        v = boot()
        v.called = []
        for at, n in ((0x426727, 1), (0x450E35, 0), (0x450ED7, 0), (0x44F2E0, 2), (0x441C62, 0), (0x44198D, 1)):
            v.stub_function(at, n, (lambda at: lambda vm, *a: vm.called.append(at) or (0xFFFFFFFF if at == 0x426727 else 0))(at))
        v.destroyed = 0
        for full in [k for k in v._api_names.values() if k.endswith('!DestroyWindow')]:
            v.stub_api(full, 1, lambda vm, h: setattr(vm, 'destroyed', vm.destroyed + 1) or 1)
        v.sounds.clear()
        y = 0x150 + 20 * item + 4 if item >= 0 else 0x150 + 17
        thiscall(v, 0x426A3A, v.u32(OBJ), 0x150, y, 0)
        clicks[str(item)] = {'sounds': list(v.sounds), 'called': v.called, 'hover': signed(v.u32(HOVER)), 'closed': v.u32(OBJ) == 0, 'destroyed': v.destroyed}
    cases.append({'kind': 'click', 'args': {}, 'expected': {'clicks': clicks}})
    write_fixture('title', 0x426235, cases)


if __name__ == '__main__':
    main()
