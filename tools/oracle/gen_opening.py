"""오프닝 애니메이션(엔진 0x4887d8) 정답 픽스처. 실행: pnpm oracle opening (약 8분)

그래픽을 켠 원작으로 타이틀 창 0x42608f → 장면 1 → 0x426c24(엔진 준비, 1장 그림) → 0x426c54(AVI가 끝까지 돈 경우)를 만들고,
48ms 콜백 0x426ca9를 틱마다(16ms 카운터 −3) 부른다. 해독 메모 notes_title.md §5.
- 틱마다: 상태 0x483e98, 대본 칸((0x4886d4 − 0x473388) / 8), 엔진 스텝 수(+0xe44), CRC32(DIB 768 × 512), CRC32(DIB 색 표 10~245)
- 장면이 바뀌는 틱: DIB 32줄 띠 CRC
- 난수 상태 0x475da0(처음·끝), BGM·효과음 호출
DUMP=틱,틱… 이면 그 틱의 DIB + 색 표(RGBQUAD 256)를 OUT_DIR(기본 original/opening-dump, git 제외)에 dib_<틱>.bin으로 쓴다(디버그)
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
TICKS = 1860
DUMP = {int(t) for t in os.environ.get('DUMP', '').split(',') if t}
OUT_DIR = os.environ.get('OUT_DIR', 'original/opening-dump')  # pnpm oracle은 저장소 맨 위에서 돈다


def bands(img: bytes) -> list:
    return [zlib.crc32(img[r * 768:(r + 32) * 768]) for r in range(0, 512, 32)]


def main() -> None:
    vm = Booted(read_original('vmv2.exe'))
    install_gdi(vm)
    vm.sounds, vm.bgm, vm.tick = [], [], 0
    vm.stub_function(0x443D19, 1, lambda vm, n: vm.sounds.append([vm.tick, n]) or 0)
    vm.stub_function(0x443770, 1, lambda vm, n: vm.bgm.append([vm.tick, n]) or 0)
    thiscall(vm, 0x42EB50, PALETTE, 0x5000)
    vm.call(0x423B2F, limit=2_000_000_000)
    vm.set_u32(STATE, 0)
    assert vm.call(0x42608F, limit=2_000_000_000) == 1
    vm.set_u32(0x503FC8, 1)
    vm.call(0x426C24, limit=4_000_000_000)
    rand0 = vm.u32(RAND)
    vm.call(0x426C54, limit=4_000_000_000)
    ticks, scenes = [], []
    last_script = None
    if DUMP:
        os.makedirs(OUT_DIR, exist_ok=True)
    for t in range(1, TICKS + 1):
        vm.tick = t
        vm.set_u32(COUNTER, max(vm.u32(COUNTER) - 3, 0))
        vm.call(0x426CA9, limit=8_000_000_000)
        img = vm.read(vm.u32(BITS), 768 * 512)
        pal = palette(vm)
        script = (vm.u32(SCRIPT) - SCRIPT_BASE) // 8 if vm.u32(SCRIPT) >= SCRIPT_BASE else -1
        ticks.append([vm.u32(STATE), script, vm.u32(ENGINE + 0xE44), zlib.crc32(img), zlib.crc32(pal[40:246 * 4])])
        if script != last_script:
            scenes.append({'tick': t, 'script': script, 'bands': bands(img)})
            last_script = script
        if t in DUMP:
            open(os.path.join(OUT_DIR, f'dib_{t}.bin'), 'wb').write(img + pal)
        if t % 100 == 0:
            print(t, vm.u32(STATE), script, flush=True)
    cases = [{'kind': 'natural', 'args': {'ticks': TICKS},
              'expected': {'ticks': ticks, 'scenes': scenes, 'rand': [rand0, vm.u32(RAND)], 'bgm': vm.bgm, 'sounds': vm.sounds}}]
    write_fixture('opening', 0x426C54, cases)


if __name__ == '__main__':
    main()
