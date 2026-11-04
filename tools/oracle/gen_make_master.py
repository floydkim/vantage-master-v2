"""Master making 창(CMakeMasterWnd, 0x426d90) 정답 픽스처. 실행: pnpm oracle make_master

그래픽을 켠 원작에서 타이틀(gen_title의 boot: AVI를 건너뛴 경로)을 띄우고 메뉴를 누른다(0x426a3a). Scenario는 Select Level(0x426727, 대역이 모드를 돌려줌)
뒤 다음 루프에서 0x450da0, Expert는 바로 0x450e35다. 창 팔레트(0x4800e0)는 타이틀(0x439d23)이 남긴 색 위에 읽으므로 누르기 전 팔레트를 base로 담는다.
0x426d90 안에서 스텝 0(0x31 → 0x32)이 한 번 돌고 0x426ff9를 한 번 부른다(틱 0).
뒤로는 48ms 콜백 0x426ff9를 틱마다 부르고, 틱 뒤에 입력을 넣는다.
- move: 0x4292be(창, x, y), click: 0x42930f(창, x, y)
- name: 이름 대화 상자(0x42967b)는 대역으로 처음 글자만 받아 두고, 0x42940e(이름)을 바로 부른다
틱마다 창 칸, DIB(608 × 448) CRC, DIB 색 표 10~245 CRC, 난수 상태를 담는다. 창이 닫히면(0x426f81) 끝이고, 월드(0x45102d)는 대역이다.
"""
import os
import struct
import sys
import zlib

sys.path.insert(0, os.path.dirname(__file__))
from boot import Booted  # noqa: E402
from fixture import write_fixture  # noqa: E402
from original import read_original  # noqa: E402
from gen_title import OBJ as TITLE_OBJ, boot as title_boot  # noqa: E402
from screen import palette, thiscall  # noqa: E402

EXE = read_original('vmv2.exe')
WINDOW, BITS = 0x483EC0, 0x483EC8
TICK, MOVE, CLICK, NAME = 0x426FF9, 0x4292BE, 0x42930F, 0x42940E
NAME_DIALOG, WORLD, STANDARD_NAME = 0x42967B, 0x45102D, 0x42D2BC
SIDES, RAND = 0x45E0E8, 0x475DA0
SELECT_LEVEL, DEFERRED, PALETTE_BASE = 0x426727, 0x504008, 0x4800E0
COUNTS, STARTS, ITEMS = 0x465E38, 0x465E18, 0x465EB0
# 창 칸: 스텝, 글, 질문, 연출 단계·프레임, 카드 프레임·색, 카드 글, 마우스 위, 아이템, 합, 프레임, 입력 모드, 그림 판, 결과 판, 설명, 얻은 아이템, 별가루 수
FIELDS = (0x1C, 0x24, 0x28, 0x4BC, 0x4C0, 0x4C4, 0x4C8, 0x4CC, 0x4D8, 0x4DC, 0x4E0, 0x4E4, 0x4E8, 0x20, 0x2C, 0x30, 0x34, 0x38)


def boot(mode: int):
    vm = title_boot()
    vm.sounds.clear()
    vm.bgm.clear()
    vm.prompts, vm.world = [], 0
    vm.stub_function(NAME_DIALOG, 1, lambda vm, p: vm.prompts.append(vm.read(p, 32).split(b'\0')[0].decode('latin-1')) or 0)
    vm.stub_function(WORLD, 0, lambda vm: setattr(vm, 'world', vm.world + 1) or 0)
    vm.stub_function(SELECT_LEVEL, 1, lambda vm, hwnd: mode)
    # 0x428fc1: 커서 모양만 고른다(창 칸은 그대로)
    for full in [k for k in vm._api_names.values() if k.split('!')[1] in ('WindowFromPoint', 'SetCursor', 'PtInRect')]:
        vm.stub_api(full, {'WindowFromPoint': 2, 'SetCursor': 1, 'PtInRect': 3}[full.split('!')[1]], lambda vm, *a: 0)
    vm.base = vm.read(PALETTE_BASE, 0xEC * 4)
    thiscall(vm, 0x426A3A, vm.u32(TITLE_OBJ), 0x150, 0x150 + 20 * (1 if mode == 2 else 0) + 4, 0, limit=8_000_000_000)
    deferred = vm.u32(DEFERRED)
    if deferred:
        vm.set_u32(DEFERRED, 0)
        vm.call(deferred, limit=8_000_000_000)
    vm.sounds.clear()
    return vm


def i32(vm, at):
    return struct.unpack('<i', vm.read(at, 4))[0]


def snapshot(vm) -> dict:
    w = vm.u32(WINDOW)
    return {
        'fields': [i32(vm, w + f) for f in FIELDS],
        'image': zlib.crc32(vm.read(vm.u32(BITS), 608 * 448)),
        'colors': zlib.crc32(palette(vm)[40:246 * 4]),
        'rand': vm.u32(RAND),
    }


def answer_for(vm, question: int, item: int) -> int:
    start = i32(vm, STARTS + question * 4)
    for a in range(i32(vm, COUNTS + question * 4)):
        if i32(vm, ITEMS + (start + a) * 4) == item:
            return a
    raise ValueError(f'질문 {question}에 아이템 {item}이 없다')


def session(mode: int, items: list, name: str, delay: int) -> dict:
    """items: 질문 넷에서 고를 아이템. delay: 누를 수 있게 된 틱에서 몇 틱 뒤에 누를지(그 사이 마우스는 다른 답 위)"""
    vm = boot(mode)
    events, ticks = [], [snapshot(vm)]
    ready = prompted = None
    named = False
    tick = 0
    while vm.u32(WINDOW) and tick < 4000:
        tick += 1
        vm.call(TICK, limit=8_000_000_000)
        if not vm.u32(WINDOW):
            ticks.append(None)
            break
        w = vm.u32(WINDOW)
        step, kind = i32(vm, w + 0x1C), i32(vm, w + 0x4E8)
        if vm.prompts and prompted is None:
            prompted = tick
        if prompted is not None and not named and tick >= prompted + delay:
            named = True
            events.append({'tick': tick, 'kind': 'name', 'text': name})
            n = vm._bump('heap', 32)
            vm.write(n, name.encode('latin-1') + b'\0')
            vm.call(NAME, n, limit=8_000_000_000)
        elif kind in (1, 2):
            ready = tick if ready is None else ready
            if kind == 1:
                q = i32(vm, w + 0x28)
                a = answer_for(vm, q, items[(step % 50 - 4) // 2])
                other = (a + 1) % i32(vm, COUNTS + q * 4)
                at = (300, 300 + 20 * a + 5) if tick >= ready + delay else (300, 300 + 20 * other + 5)
            else:
                at = (300, 200)
            if tick >= ready + delay:
                before = len(vm.sounds)
                thiscall(vm, CLICK, w, *at)
                events.append({'tick': tick, 'kind': 'click', 'x': at[0], 'y': at[1], 'sounds': vm.sounds[before:]})
                ready = None
            elif tick == ready:
                thiscall(vm, MOVE, w, *at)
                events.append({'tick': tick, 'kind': 'move', 'x': at[0], 'y': at[1]})
        ticks.append(snapshot(vm) if vm.u32(WINDOW) else None)
    side = vm.read(vm.u32(SIDES), 0xC0)
    return {'mode': mode, 'base': vm.base.hex(), 'items': items, 'name': name, 'delay': delay, 'events': events, 'ticks': ticks,
            'prompts': vm.prompts, 'bgm': vm.bgm, 'world': vm.world, 'side': side.hex()}


def standard_name(n: int) -> str:
    vm = Booted(EXE)
    return vm.read(vm.call(STANDARD_NAME, n), 32).split(b'\0')[0].decode('latin-1')


def main() -> None:
    cases = []
    # Normal: 18 + 6 + 3 + 1 = 28 → 마스터 2, 보통 이름. 누를 수 있게 되면 바로 누른다
    cases.append({'kind': 'session', 'args': {}, 'expected': session(1, [1, 4, 7, 9], 'Floyd', 0)})
    # Expert: 0 + 6 + 0 + 1 = 7 → 마스터 0, 이름이 0x14의 표준 이름이면 숨은 마스터 0x14(0x428542). 5틱 뒤에 누른다
    cases.append({'kind': 'session', 'args': {}, 'expected': session(2, [0, 4, 6, 9], standard_name(0x14), 5)})
    # Easy: 36 + 12 + 3 + 2 = 53 → 마스터 6(특수 이름 없음), 이름이 0x14의 표준 이름이어도 그대로. 2틱 뒤
    cases.append({'kind': 'session', 'args': {}, 'expected': session(0, [2, 5, 7, 10], standard_name(0x14), 2)})
    write_fixture('makeMaster', 0x426D90, cases)


if __name__ == '__main__':
    main()
