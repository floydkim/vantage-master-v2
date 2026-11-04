"""전장 화면 정답 픽스처. 실행: pnpm oracle screen

그래픽을 켠 원작(screen.py)에서 상태를 만들고, 겹 목록(0x43d636)과 칩 그리기(0x43ef06)로 전장 DIB(1560 × 1008, 확대 1)를 떠낸다.
입력은 상태 블록(유닛 압축 0x4071ea 뒤), 물 애니메이션 프레임, 하늘 틱 수(0x43d535를 부른 횟수). 정답은 칩 줄(12픽셀 줄 84개)마다
CRC32를 지형만(표시 객체를 숨김)과 전체로, DIB 색 표 10~245번(RGBQUAD), 표시 객체 풀.
- 맵마다: 새 전투(마스터 0·1, 레벨 24) → 마정석 k를 k % 3(0 그대로, 1 진영 0, 2 진영 1)로 점령(0x40124c: 원작은 겹 목록을 고쳐 쓴다)
- 게임 픽스처(games.json) 6판 × 5시점: 블록을 되살리기(0x401899)로
- 물이 있는 맵 4개의 시작 블록에 물높이 −1·+1, 맵 3 시작 블록에 상태 이상(한 유닛씩): 블록을 고쳐 되살리기로
물 프레임은 경우 번호 % 4, 하늘 틱은 (경우 번호 × 7) % 40.
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
from screen import (COMPOSE, FIELD_W, CHIP_H, SPRITE_COUNT, SPRITES, WATER_FRAME, draw_field, hide_sprites, palette,  # noqa: E402
                    resume_screen_battle, start_screen_battle)

MAPS = 52
CAPTURE = 0x40124C          # (x, y, 진영) 마정석 점령: 작업 격자 + 겹 목록 고쳐 쓰기(0x43c374)
SKY_TICK = 0x43D535
STONES = 0x45E0E0           # → 마정석 표(3바이트: x, y, 소유), 개수는 *0x476ab0
STONE_COUNT = 0x476AB0
PARTS = 0x483918            # →→ 부품 표(100바이트), +0x63 플래그: 4 물이 오르면 +4, 8 물이 내리면 −4
GRID = 0x483554             # →→ 맵 원래 격자(u16 32 × 32)
WATER = 0xBA0               # 블록: 물높이, 단계(0·1·2), 물이 돌아올 때까지 남은 분
UNITS = 0x2E0               # 블록: 유닛 압축 레코드 0x24바이트, +0x18 상태 이상 남은 분, +0x20 상태 이상 비트


def capture(vm) -> None:
    table, count = vm.u32(STONES), vm.u32(vm.u32(STONE_COUNT))
    for k in range(count):
        x, y, _ = vm.read(table + k * 3, 3)
        if k % 3:
            vm.call(CAPTURE, x, y, k % 3 - 1, limit=2_000_000_000)


def has_water(vm) -> bool:
    parts, grid = vm.u32(vm.u32(PARTS)), vm.u32(vm.u32(GRID))
    ids = struct.unpack('<1024H', vm.read(grid, 2048))
    return any(vm.read(parts + i * 100 + 0x63, 1)[0] & 0xC for i in set(ids))


def rows(field: bytes) -> list:
    size = FIELD_W * CHIP_H
    return [zlib.crc32(field[i:i + size]) for i in range(0, len(field), size)]


def shoot(vm, label: str, map_index: int, n: int) -> dict:
    water, ticks = n % 4, n * 7 % 40
    for _ in range(ticks):
        vm.call(SKY_TICK, limit=2_000_000_000)
    vm.set_u32(WATER_FRAME, water)
    block = encode_block(packed_block(vm))
    vm.call(COMPOSE, limit=2_000_000_000)
    field = rows(draw_field(vm))
    pool = [vm.read(SPRITES + i * 0x16, 0x16).hex() for i in range(vm.u32(SPRITE_COUNT))]
    hide_sprites(vm)
    terrain = rows(draw_field(vm))
    print(n, label, flush=True)
    return {'args': {'label': label, 'map': map_index, 'block': block, 'water': water, 'skyTicks': ticks},
            'expected': {'terrain': terrain, 'field': field, 'dib': palette(vm)[40:246 * 4].hex(), 'pool': pool}}


def edited(block: bytes, edits) -> bytes:
    b = bytearray(block)
    for at, value in edits:
        b[at:at + 4] = struct.pack('<i', value)
    return bytes(b)


def main() -> None:
    exe = read_original('vmv2.exe')
    cases, starts = [], {}
    for m in range(MAPS):
        vm = start_screen_battle(exe, m)
        starts[m] = (packed_block(vm), has_water(vm))
        capture(vm)
        cases.append(shoot(vm, f'맵 {m} 점령', m, len(cases)))
    with open(os.path.join(GOLDEN, 'games.json')) as f:
        games = json.load(f)['cases']
    for g, game in enumerate(games):
        blocks = game['expected']['blocks']
        n = len(blocks)
        for k in sorted({0, n // 4, n // 2, 3 * n // 4, n - 1}):
            block = zlib.decompress(base64.b64decode(blocks[k]))
            vm = resume_screen_battle(exe, block, game['args']['map'])
            cases.append(shoot(vm, f'게임 {g} 블록 {k}', game['args']['map'], len(cases)))
    for m in [m for m in range(MAPS) if starts[m][1]][:4]:
        for level, step in ((-1, 0), (1, 2)):
            vm = resume_screen_battle(exe, edited(starts[m][0], ((WATER, level), (WATER + 4, step), (WATER + 8, 600))), m)
            cases.append(shoot(vm, f'맵 {m} 물높이 {level}', m, len(cases)))
    for bits in ((1, 0), (0, 2), (4, 0)):  # 한 유닛만: 둘 다 걸리면 첫 차례 진행이 남은 분을 다 써 버린다
        status = [(UNITS + i * 0x24 + 0x18, 600 if b else 0) for i, b in enumerate(bits)] + [(UNITS + i * 0x24 + 0x20, b) for i, b in enumerate(bits)]
        vm = resume_screen_battle(exe, edited(starts[3][0], status), 3)
        cases.append(shoot(vm, f'맵 3 상태 이상 {bits}', 3, len(cases)))
    write_fixture('screen', 0x43EF06, cases)


if __name__ == '__main__':
    main()
