"""오프닝 애니메이션의 따라잡기·중간 건너뛰기 정답 픽스처. 실행: pnpm oracle opening_variants (약 15분)

gen_opening.py와 같이 시작해(0x42608f → 0x426c24 → 0x426c54) 48ms 콜백 0x426ca9를 부른다.
- catchup: 틱마다 16ms 카운터를 고르지 않게 줄인다(100~129 −62, 400 −300, 500~599 2·4 번갈아, 1000~1049 −20, 그 밖 −3, 0에서 멈춤).
  0x43307e가 뒤지면 그리지 않고 스텝을 몰아 돈다. 틱마다 [상태, 대본 칸, 스텝, CRC32(DIB), CRC32(색 표 10~245)], 메뉴(상태 2) 뒤 몇 틱까지
- skip: 틱 at에 왼쪽 클릭(0x426c7c: 0x433340으로 엔진을 타이틀 대본으로, BGM 8, 상태 1)한 직후와 그 뒤 3틱. 클릭 직후 색 16(0x10)의 RGB,
  클릭 때의 난수 상태와 끝 난수 상태, BGM 호출
"""
import os
import sys
import zlib

sys.path.insert(0, os.path.dirname(__file__))
from boot import Booted  # noqa: E402
from fixture import write_fixture  # noqa: E402
from original import read_original  # noqa: E402
from screen import PALETTE, install_gdi, palette, thiscall  # noqa: E402

STATE, BITS, COUNTER = 0x483E98, 0x483E9C, 0x503DEC
ENGINE = 0x4887D8
SCRIPT, SCRIPT_BASE = 0x4886D4, 0x473388
RAND = 0x475DA0
SKIPS = (650, 1800)  # 3장 글 카드, 로고 페이드


def drop(t: int) -> int:
    if 100 <= t < 130:
        return 62
    if t == 400:
        return 300
    if 500 <= t < 600:
        return 2 if t % 2 else 4
    if 1000 <= t < 1050:
        return 20
    return 3


def boot():
    vm = Booted(read_original('vmv2.exe'))
    install_gdi(vm)
    vm.bgm = []
    vm.stub_function(0x443D19, 1, lambda vm, n: 0)
    vm.stub_function(0x443770, 1, lambda vm, n: vm.bgm.append(n) or 0)
    thiscall(vm, 0x42EB50, PALETTE, 0x5000)
    vm.call(0x423B2F, limit=2_000_000_000)
    vm.set_u32(STATE, 0)
    assert vm.call(0x42608F, limit=2_000_000_000) == 1
    vm.set_u32(0x503FC8, 1)
    vm.call(0x426C24, limit=4_000_000_000)
    vm.call(0x426C54, limit=4_000_000_000)
    return vm


def row(vm):
    img = vm.read(vm.u32(BITS), 768 * 512)
    pal = palette(vm)
    script = (vm.u32(SCRIPT) - SCRIPT_BASE) // 8 if vm.u32(SCRIPT) >= SCRIPT_BASE else -1
    return [vm.u32(STATE), script, vm.u32(ENGINE + 0xE44), zlib.crc32(img), zlib.crc32(pal[40:246 * 4])], pal


def tick(vm, n: int) -> None:
    vm.set_u32(COUNTER, max(vm.u32(COUNTER) - n, 0))
    vm.call(0x426CA9, limit=8_000_000_000)


def catchup() -> dict:
    vm = boot()
    rand0 = vm.u32(RAND)
    ticks = []
    for t in range(1, 1700):
        tick(vm, drop(t))
        ticks.append(row(vm)[0])
        if t % 200 == 0:
            print('catchup', t, flush=True)
        if len([x for x in ticks if x[0] == 2]) > 3:
            break
    return {'kind': 'catchup', 'args': {}, 'expected': {'ticks': ticks, 'rand': [rand0, vm.u32(RAND)], 'bgm': vm.bgm}}


def skip(at: int) -> dict:
    vm = boot()
    for t in range(1, at):
        tick(vm, 3)
    rand_at = vm.u32(RAND)
    vm.call(0x426C7C, limit=4_000_000_000)
    click, pal = row(vm)
    after = []
    for _ in range(3):
        tick(vm, 3)
        after.append(row(vm)[0])
    print('skip', at, flush=True)
    return {'kind': 'skip', 'args': {'at': at},
            'expected': {'click': click, 'color16': list(pal[16 * 4:16 * 4 + 3]), 'after': after, 'rand': [rand_at, vm.u32(RAND)], 'bgm': vm.bgm}}


def main() -> None:
    write_fixture('openingVariants', 0x426C7C, [catchup()] + [skip(at) for at in SKIPS])


if __name__ == '__main__':
    main()
