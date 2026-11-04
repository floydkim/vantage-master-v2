"""대화 상자 음영 'base'(0x402902) 정답 픽스처. 실행: pnpm oracle base_shade

게임 블록을 그래픽 되살리기(resume_screen_battle)로 올리고, 정보 대화 상자 초기화가 부르는 0x402902(팔레트 0x76~0xe5 = 기본 팔레트 6~0x75번,
시각 보정 없음)를 부른 뒤 DIB 색 표 10~245번을 남긴다. 맵·시각이 다른 블록 셋. 블록은 되살린 뒤 다시 압축한 것(시험이 같은 상태로 색을 셈)
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
from screen import palette, resume_screen_battle  # noqa: E402

BASE_SHADE = 0x402902
CASES = ((0, 3), (2, 24), (4, 22))  # (게임, 블록)


def main() -> None:
    exe = read_original('vmv2.exe')
    with open(os.path.join(GOLDEN, 'games.json')) as f:
        games = json.load(f)['cases']
    cases = []
    for g, k in CASES:
        map_index = games[g]['args']['map']
        vm = resume_screen_battle(exe, zlib.decompress(base64.b64decode(games[g]['expected']['blocks'][k])), map_index)
        block = encode_block(packed_block(vm))
        before = palette(vm)[40:246 * 4].hex()
        vm.call(BASE_SHADE, limit=2_000_000_000)
        after = palette(vm)[40:246 * 4].hex()
        print(f'게임 {g} 블록 {k}', before != after, flush=True)
        cases.append({'args': {'label': f'게임 {g} 블록 {k}', 'map': map_index, 'block': block}, 'expected': {'before': before, 'dib': after}})
    write_fixture('baseShade', BASE_SHADE, cases)


if __name__ == '__main__':
    main()
