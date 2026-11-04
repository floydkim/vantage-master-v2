"""도움말 창(Help window, CHelpWnd) 그림 정답 픽스처. 실행: pnpm oracle help

게임 블록을 그래픽 되살리기로 올린 뒤 도움말 창이 없으면 만든다(0x424c2a: DIB 624 × 137, 바탕 DATA00 0x1a). 그 뒤 exe 안 문구를 차례로
0x424fed에 준다(같은 문구 반복, 줄 수가 늘고 주는 경우, 빈 문구 포함). 처음과 문구마다 DIB(*0x483e3c, 줄 간격 0x270)의 줄 CRC32를 남긴다.
"""
import base64
import json
import os
import sys
import zlib

sys.path.insert(0, os.path.dirname(__file__))
from fixture import GOLDEN, write_fixture  # noqa: E402
from original import read_original  # noqa: E402
from screen import resume_screen_battle  # noqa: E402

CREATE = 0x424C2A
SET_TEXT = 0x424FED
WINDOW = 0x483E44
BITS = 0x483E3C
W, H = 624, 137
MASTERS = 0x4622D0   # 마스터 설명 표
NATIALS = 0x46226C   # 네이티얼 설명 표
TERRAIN = 0x46222C   # 지형 설명 표
HELP = (0x45E600, 0x45E638, 0x45E574, 0x45E77C, 0x45EB78)  # 단계 문구


def rows(vm) -> list:
    image = vm.read(vm.u32(BITS), W * H)
    return [zlib.crc32(image[r * W:(r + 1) * W]) for r in range(H)]


def main() -> None:
    exe = read_original('vmv2.exe')
    with open(os.path.join(GOLDEN, 'games.json')) as f:
        game = json.load(f)['cases'][0]
    vm = resume_screen_battle(exe, zlib.decompress(base64.b64decode(game['expected']['blocks'][0])), game['args']['map'])
    if not vm.u32(WINDOW):
        vm.call(CREATE, limit=200_000_000)
    texts = [vm.u32(MASTERS + 4 * 0), vm.u32(NATIALS + 4 * 5), vm.u32(NATIALS + 4 * 5), vm.u32(TERRAIN + 4 * 3), HELP[0], HELP[1], vm.u32(MASTERS + 4 * 3)]
    empty = HELP[0] + len(vm.read(HELP[0], 512).split(b'\0')[0])  # 문자열 끝의 0 = 빈 문구
    texts += [empty, HELP[2], HELP[3], vm.u32(TERRAIN + 4 * 0), HELP[4]]
    steps = [{'text': None, 'rows': rows(vm)}]
    for at in texts:
        vm.call(SET_TEXT, at, limit=200_000_000)
        steps.append({'text': at, 'rows': rows(vm)})
    print('help', len(steps), flush=True)
    write_fixture('help', SET_TEXT, [{'map': game['args']['map'], 'steps': steps}])


if __name__ == '__main__':
    main()
