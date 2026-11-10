"""알림판(VANTAGEPOPUP, 0x42e090 → 그리기 0x42e38f) 정답 픽스처. 실행: pnpm oracle notice

전투를 그래픽 되살리기로 올리고 BeginPaint를 rcPaint 전체로, GetWindowRect(프레임)를 (0, 0, 1024, 768)로 대역한다. 문구마다 0x42e090으로
알림판을 만들고(CreateWindowExA의 위치·크기를 기록) 0x42e38f가 만든 임시 DIB(W × 60, 위에서 아래로)의 줄 CRC32를 남긴다.
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
from screen import resume_screen_battle, thiscall  # noqa: E402

CREATE = 0x42E090
DRAW = 0x42E38F
NOTICE = 0x483F54
COUNTER = 0x503DEC
# 원작 글은 exe 주소로 적는다(물높이 알림, 무승부 글): 공개 저장소에 원작 문장을 두지 않는다
TEXTS = [0x45E558, 0x45E468, b'Estana has\xa1\xa1Woned', b'Algiros has\xa1\xa1Losted',
         b'Estana has surrendered', b'A', b'AB', b'ABCDEFGHIJKLMNOPQRS has surrendered']


def main() -> None:
    exe = read_original('vmv2.exe')
    with open(os.path.join(GOLDEN, 'games.json')) as f:
        game = json.load(f)['cases'][0]
    vm = resume_screen_battle(exe, zlib.decompress(base64.b64decode(game['expected']['blocks'][0])), game['args']['map'])
    made, size = [], {}

    def stub(name, nargs, handler):
        for full in [k for k in vm._api_names.values() if k.endswith('!' + name)]:
            vm.stub_api(full, nargs, handler)

    def begin_paint(vm, hwnd, ps):
        w, h = size['wh']
        vm.write(ps, struct.pack('<IIiiii', 0x7777, 0, 0, 0, w, h))
        return 0x7777

    def create(vm, ex, cls, name, style, x, y, w, h, parent, menu, inst, param):
        made.append({'style': style, 'x': x, 'y': y, 'w': w, 'h': h})
        size['wh'] = (w, h)
        return 0x9999

    stub('BeginPaint', 2, begin_paint)
    stub('GetWindowRect', 2, lambda vm, hwnd, out: (vm.write(out, struct.pack('<iiii', 0, 0, 1024, 768)), 1)[1])
    stub('CreateWindowExA', 12, create)
    buf = vm._bump('heap', 256)
    cases = []
    for t in TEXTS:
        text = vm.read(t, 256).split(b'\0')[0] if isinstance(t, int) else t
        vm.write(buf, text + b'\0')
        made.clear()
        vm.call(CREATE, buf, limit=200_000_000)
        before = set(vm.dibs)
        thiscall(vm, DRAW, vm.u32(NOTICE), limit=200_000_000)
        at, w, h, _ = vm.dibs[[k for k in vm.dibs if k not in before][-1]]
        img = vm.read(at, w * abs(h))
        window = made[-1]
        cases.append({'args': {'address': f'{t:#x}'} if isinstance(t, int) else {'text': text.hex()}, 'expected': {'x': window['x'], 'y': window['y'], 'w': window['w'], 'h': window['h'],
                                                                 'counter': vm.u32(COUNTER), 'rows': [zlib.crc32(img[r * w:(r + 1) * w]) for r in range(abs(h))]}})
        print(text, window, flush=True)
        vm.set_u32(NOTICE, 0)  # 원작은 대기(0x42e186) 끝에서 창을 없애고 0
    write_fixture('notice', CREATE, cases)


if __name__ == '__main__':
    main()
