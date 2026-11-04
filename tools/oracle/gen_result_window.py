"""결과 창(Battle results window, 0x407d43) 정답 픽스처. 실행: pnpm oracle result_window

games.json 판마다 마지막 블록(마스터 HP 0)을 그래픽 되살리기(0x401899)로 넣고, 전투 창 정리(0x401bd8(0)) 없이 0x407d43(승자, 이김)을 부른다.
쪽 +8 = 0~4마다 0x4084c4로 다시 그려 608 × 420 DIB(*0x476bd8)의 12줄 띠 CRC32를 남긴다. 첫 판은 무승부(−1, 0)도 다시 부른다.
첫 판에서는 단추(0x40a55e)를 쪽 {0, 1, 4} × 마우스 위 {−1, 0, 1} × 프레임 0~7마다 그려 단추 띠(480~587 × 372~395) CRC를 남긴다.
이김(0x476b6c)은 0x401ec3 규칙(사람 진영 기준)으로 블록의 조종에서 구한다. 결과 팔레트는 DIB 색 표 10~16·60~238·240~245.
시나리오(kind 'scenario'): 블록 +0x8 = 1, 고른 맵 +0x2d4를 넣고 이겨서 부르면 0x408447이 레벨 + 1 < 40일 때 마지막 쪽 5(레벨 업·보상 0x409c6d).
판 5(레벨 20)에 맵 3(보상 있음)·맵 30(보상 없음), 판 3(레벨 39: 쪽 5 없음). 마지막 쪽 +0xc, 보상 +0x18, 쪽 4·5 띠
"""
import base64
import json
import os
import struct
import sys
import zlib

sys.path.insert(0, os.path.dirname(__file__))
from fixture import GOLDEN, write_fixture  # noqa: E402
from original import read_original  # noqa: E402
from screen import palette, resume_screen_battle, thiscall  # noqa: E402

CREATE = 0x407D43
DRAW_PAGE = 0x4084C4
DRAW_BUTTONS = 0x40A55E
WINDOW = 0x476BDC
BITS = 0x476BD8
W, H = 608, 420
BAND = 12
BLOCK = 0x4CC810
STATS = 0xBAC                # 블록: 누적 분, 진영마다 통계 0xe4바이트
SIDE_STATES = 0x9EC          # 블록: 진영 상태 0x18바이트 × 2, +0 조종(0 사람)


def bands(img: bytes) -> list:
    return [zlib.crc32(img[r * W:(r + BAND) * W]) for r in range(0, H, BAND)]


def won(block: bytes, winner: int) -> int:
    """0x401ec3: 이름을 쓸 진영 = 승자가 사람이면 승자, 아니고 진 쪽이 사람이면 진 쪽, 둘 다 CPU면 승자. 이김 = 그 진영이 승자"""
    if winner not in (0, 1):
        return 0
    human = [struct.unpack_from('<i', block, SIDE_STATES + s * 0x18)[0] == 0 for s in (0, 1)]
    side = winner if human[winner] else 1 - winner if human[1 - winner] else winner
    return int(side == winner)


def pages(vm) -> list:
    obj, bits = vm.u32(WINDOW), vm.u32(BITS)
    out = []
    for page in range(5):
        vm.set_u32(obj + 8, page)
        vm.set_u32(obj + 0x10, 0xFFFFFFFF)  # 마우스 위 없음, 프레임 0(처음 값)
        vm.set_u32(obj + 0x14, 0)
        thiscall(vm, DRAW_PAGE, obj, limit=2_000_000_000)
        out.append(bands(vm.read(bits, W * H)))
    return out


def buttons(vm) -> list:
    obj, bits = vm.u32(WINDOW), vm.u32(BITS)
    out = []
    for page in (0, 1, 4):
        for hover in (-1, 0, 1):
            for frame in range(8):
                vm.set_u32(obj + 8, page)
                vm.set_u32(obj + 0x10, hover & 0xFFFFFFFF)
                vm.set_u32(obj + 0x14, frame)
                thiscall(vm, DRAW_BUTTONS, obj, limit=200_000_000)
                strip = b''.join(vm.read(bits + y * W + 480, 108) for y in range(372, 396))
                out.append({'page': page, 'hover': hover, 'frame': frame, 'crc': zlib.crc32(strip)})
    return out


def main() -> None:
    exe = read_original('vmv2.exe')
    with open(os.path.join(GOLDEN, 'games.json')) as f:
        games = json.load(f)['cases']
    cases = []
    for g, game in enumerate(games):
        block = zlib.decompress(base64.b64decode(game['expected']['blocks'][-1]))
        winner = game['expected']['winner']
        vm = resume_screen_battle(exe, block, game['args']['map'])
        # 되살리기의 첫 차례 준비가 시간을 더 보낸다: 끝난 순간의 누적 분·통계(블록 +0xbac~)를 다시 넣는다
        vm.write(BLOCK + STATS, block[STATS:STATS + 4 + 0xE4 * 2])
        w = won(block, winner)
        vm.call(CREATE, winner & 0xFFFFFFFF, w, limit=4_000_000_000)
        dib = palette(vm)
        colors = (dib[10 * 4:17 * 4] + dib[60 * 4:239 * 4] + dib[240 * 4:246 * 4]).hex()
        expected = {'pages': pages(vm), 'palette': colors}
        if g == 0:
            expected['buttons'] = buttons(vm)
        cases.append({'args': {'game': g, 'map': game['args']['map'], 'block': game['expected']['blocks'][-1], 'winner': winner, 'won': w}, 'expected': expected})
        print(g, winner, w, flush=True)
        if g == 0:
            vm.call(CREATE, 0xFFFFFFFF, 0, limit=4_000_000_000)  # 무승부: 객체가 있으면 그림만 다시
            cases.append({'args': {'game': g, 'map': game['args']['map'], 'block': game['expected']['blocks'][-1], 'winner': -1, 'won': 0}, 'expected': {'pages': pages(vm)}})
    for g, selected in ((5, 3), (5, 30), (3, 3)):
        game = games[g]
        block = bytearray(zlib.decompress(base64.b64decode(game['expected']['blocks'][-1])))
        struct.pack_into('<ii', block, 0x8, 1, 1)
        struct.pack_into('<i', block, 0x2D4, selected)
        vm = resume_screen_battle(exe, bytes(block), game['args']['map'])
        vm.write(BLOCK + STATS, bytes(block[STATS:STATS + 4 + 0xE4 * 2]))
        vm.call(CREATE, game['expected']['winner'], won(block, game['expected']['winner']), limit=4_000_000_000)
        obj, bits = vm.u32(WINDOW), vm.u32(BITS)
        last = vm.u32(obj + 0xC)
        shown = {}
        for page in range(4, last + 1):
            vm.set_u32(obj + 8, page)
            vm.set_u32(obj + 0x10, 0xFFFFFFFF)
            vm.set_u32(obj + 0x14, 0)
            thiscall(vm, DRAW_PAGE, obj, limit=2_000_000_000)
            shown[str(page)] = bands(vm.read(bits, W * H))
        reward = struct.unpack('<i', vm.read(obj + 0x18, 4))[0]
        after = vm.read(BLOCK, len(block))  # 되살리기가 시나리오 칸을 보고 진영 1을 다시 채운다: 결과 창이 읽은 블록
        print('scenario', g, selected, last, reward, 'side1 same', after[0xd8:0x198] == bytes(block[0xd8:0x198]), flush=True)
        cases.append({'kind': 'scenario', 'args': {'game': g, 'map': game['args']['map'], 'block': base64.b64encode(zlib.compress(after)).decode(), 'winner': game['expected']['winner'], 'won': won(block, game['expected']['winner']), 'selected': selected},
                      'expected': {'last': last, 'reward': reward, 'pages': shown}})
    write_fixture('resultWindow', CREATE, cases)


if __name__ == '__main__':
    main()
