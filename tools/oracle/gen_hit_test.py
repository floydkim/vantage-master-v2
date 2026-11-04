"""전장 칸·방향 판정 정답 픽스처. 실행: pnpm oracle hit_test

픽셀(확대 1, 전장 DIB 좌표) → 칸(0x4031c5, 못 고르면 −1), 칸 둘레 픽셀 → 방향(0x4033ee). 판정은 작업 격자(물높이·마정석)와
부품 표만 본다. 맵 52개는 새 전투, 게임 픽스처 블록 6개(물높이 ±1 포함)는 되살리기로.
"""
import base64
import json
import os
import random
import sys
import zlib

sys.path.insert(0, os.path.dirname(__file__))
from battle import encode_block, packed_block, restore_battle, start_free_battle  # noqa: E402
from fixture import GOLDEN, write_fixture  # noqa: E402
from original import read_original  # noqa: E402
from unicorn.x86_const import UC_X86_REG_EDX  # noqa: E402

CELL_AT = 0x4031C5
DIRECTION_AT = 0x4033EE
FIELD_W, FIELD_H = 1560, 1008
GAME_BLOCKS = ((0, 7), (2, 0), (2, 18), (3, 56), (4, 6), (5, 19))
POINTS = 100


def s32(v: int) -> int:
    return v - (1 << 32) if v & 0x80000000 else v


def probe(vm, label: str, rng) -> dict:
    cells = []
    for _ in range(POINTS):
        px, py = rng.randrange(FIELD_W), rng.randrange(FIELD_H)
        x = s32(vm.call(CELL_AT, px, py))
        y = s32(vm.uc.reg_read(UC_X86_REG_EDX))
        cells.append([px, py, x, y])
    directions = []
    for _ in range(POINTS):
        x, y = rng.randrange(32), rng.randrange(32)
        px, py = (y & 1) * 24 + x * 48 + 24 + rng.randrange(-60, 61), y * 24 + rng.randrange(-40, 200)
        directions.append([px, py, x, y, vm.call(DIRECTION_AT, px, py, x, y)])
    print(label, sum(1 for c in cells if c[2] >= 0), flush=True)
    return {'args': {'label': label, 'block': encode_block(packed_block(vm)), 'cells': [c[:2] for c in cells], 'directions': [d[:4] for d in directions]},
            'expected': {'cells': [c[2:] for c in cells], 'directions': [d[4] for d in directions]}}


def main() -> None:
    exe = read_original('vmv2.exe')
    rng = random.Random(0x4031C5)
    cases = [probe(start_free_battle(exe, m), f'맵 {m}', rng) for m in range(52)]
    with open(os.path.join(GOLDEN, 'games.json')) as f:
        games = json.load(f)['cases']
    for g, k in GAME_BLOCKS:
        block = zlib.decompress(base64.b64decode(games[g]['expected']['blocks'][k]))
        cases.append(probe(restore_battle(exe, block), f'게임 {g} 블록 {k}', rng))
    write_fixture('hitTest', CELL_AT, cases)


if __name__ == '__main__':
    main()
