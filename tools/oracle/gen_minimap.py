"""미니맵(Battle view window) 정답 픽스처. 실행: pnpm oracle minimap

게임 블록·screen 픽스처의 물높이 블록을 그래픽 되살리기로 올리면 전투 시작(0x40d4f3)이 지형 표본(0x40d53d: 칩 시트를 반으로 줄인 0x4232a9
결과에서 칩마다 8색, 0x476de8)과 미니맵 버퍼(0x40d5ca, 0x483f38 260 × 168)를 만든다. 표본표·그때의 팔레트(0x4825c8 + 4) 10~245번 RGB의 해시
(원작 그림·색에서 뽑은 자료라 값은 두지 않는다. 표본은 투명이 낀 2 × 2 자리를 0으로 가림: 원작이 작업 버퍼에 남은 값을 둔다), 버퍼 줄 CRC,
유닛 표식 목록(0x40d977: 개수 0x476db0, 좌표 0x476c08, 진영 0x476db4)을 남긴다(표식 그리기 0x40e0ec는 TS 시험이 목록으로 확인).
"""
import base64
import hashlib
import json
import os
import struct
import sys
import zlib

sys.path.insert(0, os.path.dirname(__file__))
from battle import encode_block, packed_block  # noqa: E402
from fixture import GOLDEN, write_fixture  # noqa: E402
from original import read_original  # noqa: E402
from screen import resume_screen_battle  # noqa: E402

SAMPLES = 0x476DE8
SHEET = 0x483F48            # → 칩 시트(칩 24 × 12 = 288바이트, 지형 칩 0~0x3ff)
CHIP_W, CHIP = 24, 24 * 12
TERRAIN_CHIPS = 0x400
BUFFER = 0x483F38
W, H = 260, 168
PALETTE = 0x4825C8
MARKS = 0x40D977
COUNT = 0x476DB0
POINTS = 0x476C08
SIDES = 0x476DB4


def rows(image: bytes) -> list:
    return [zlib.crc32(image[r * W:(r + 1) * W]) for r in range(H)]


def sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()[:16]


def masked_samples(vm) -> bytes:
    """표본표에서 칩 시트의 2 × 2에 투명(0)이 낀 자리를 0으로(TS 시험의 opaque와 같은 가림)"""
    sheet = vm.read(vm.u32(SHEET), TERRAIN_CHIPS * CHIP)
    out = bytearray(vm.read(SAMPLES, 0x2000))
    for k in range(len(out)):
        e = k >> 2
        at = (e >> 1) * CHIP + (e & 1) * 6 * CHIP_W + (k & 3) * 6
        if any(sheet[at + d] == 0 for d in (0, 1, CHIP_W, CHIP_W + 1)):
            out[k] = 0
    return bytes(out)


def make_case(exe: bytes, label: str, block: bytes, map_index: int) -> dict:
    vm = resume_screen_battle(exe, block, map_index)
    packed = encode_block(packed_block(vm))
    buffer = vm.u32(BUFFER)
    logical = vm.read(vm.u32(PALETTE) + 4, 1024)
    terrain = vm.read(buffer, W * H)
    vm.call(MARKS, limit=200_000_000)
    n = vm.u32(COUNT)
    marks = [list(struct.unpack('<ii', vm.read(POINTS + 8 * i, 8))) + [vm.read(SIDES + i, 1)[0]] for i in range(n)]
    case = {
        'label': label, 'map': map_index, 'block': packed,
        'samplesSha': sha(masked_samples(vm)),
        'paletteSha': sha(bytes(logical[i * 4 + k] for i in range(10, 246) for k in range(3))),  # LOGPALETTE 항목(R, G, B, 플래그)의 RGB
        'terrain': rows(terrain), 'marks': marks,
    }
    print(label, n, flush=True)
    return case


def main() -> None:
    exe = read_original('vmv2.exe')
    with open(os.path.join(GOLDEN, 'games.json')) as f:
        games = json.load(f)['cases']
    cases = []
    for g, game in enumerate(games):
        blocks = game['expected']['blocks']
        for k in (0, len(blocks) // 2):
            cases.append(make_case(exe, f'게임 {g} 블록 {k}', zlib.decompress(base64.b64decode(blocks[k])), game['args']['map']))
    with open(os.path.join(GOLDEN, 'screen.json')) as f:
        water = [c for c in json.load(f)['cases'] if '물높이' in c['args']['label']]
    for c in water:
        cases.append(make_case(exe, c['args']['label'], zlib.decompress(base64.b64decode(c['args']['block'])), c['args']['map']))
    write_fixture('minimap', 0x40D4F3, cases)


if __name__ == '__main__':
    main()
