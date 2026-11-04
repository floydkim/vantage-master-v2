"""장면 창(CEndingWnd, 0x41becb) 정답 픽스처. 실행: pnpm oracle scene (오래 걸림)

그래픽을 켠 원작에서 진영 0 레코드(이름, +0x9c 마스터)와 장면 종류(0x48341c)를 두고 0x41becb로 창을 연 뒤,
48ms 콜백(*0x50400c = 0x41d843)을 틱마다(16ms 카운터 0x503dec −3) 부른다. 창이 닫히거나(0x483550 = 0) 다음 장면 함수(0x504008)가 서면 끝이다.
- script: 틱마다 [DIB 768 × 512 CRC, 색 표 10~245 CRC, 스레드 수 0x48340c, 객체 수 0x483538, ED 번호 0x483528]과 BGM 호출, 끝 틱·다음 함수
- late: 몇 틱마다 카운터를 더 내려(늦은 틱) 스텝을 몰아 도는 경우
- ending: 종류 6에서 ED 하나(마스터 ED는 0x483528 = 0, 이어지는 ED n은 0x483528 = n − 1에서 0x41d7e8로 넘어감)를 끝까지(0x483528이 바뀔 때까지)
- more(ONLY=more → sceneMore.json): 위 경우들이 지나지 않는 명령(0x12~0x15 크기·사각형 트윈)을 쓰는 ED 7(0x90023)
- chain(ONLY=chain → sceneChain.json): 마스터 ED에서 ED 1 끝까지 이어 돌림(ED 사이 글 시계)
- report(ONLY=report → sceneReport.json): 엔딩 뒤 보고서(0x483528 = 0x1b, 0x41c2f2)의 쪽 0~2. 마우스 위 0x421f85, 클릭 0x421fc8.
  진영 0 목록(네이티얼 12·마법 3)을 두고, 처음 40틱과 입력마다 4틱의 기록
"""
import os
import struct
import sys
import zlib

sys.path.insert(0, os.path.dirname(__file__))
from boot import Booted  # noqa: E402
from fixture import write_fixture  # noqa: E402
from original import read_original  # noqa: E402
from screen import PALETTE, install_gdi, palette, thiscall  # noqa: E402

EXE = read_original('vmv2.exe')
COUNTER, KIND, WINDOW, DEFERRED, INDEX = 0x503DEC, 0x48341C, 0x483550, 0x504008, 0x483528
CALLBACK, BITS, THREADS, OBJECTS = 0x50400C, 0x482DD8, 0x48340C, 0x483538
SIDES, STATS_POINTER, STATS = 0x45E0E8, 0x41BCDA, 0x482DC4
HOVER, CLICK = 0x421F85, 0x421FC8


def boot(kind: int, master: int, name: bytes, stats=None):
    vm = Booted(EXE)
    install_gdi(vm)
    vm.bgm, vm.sounds, vm.tick = [], [], 0
    vm.stub_function(0x443D19, 1, lambda vm, n: vm.sounds.append([vm.tick, n]) or 0)
    vm.stub_function(0x443770, 1, lambda vm, n: vm.bgm.append([vm.tick, n]) or 0)
    thiscall(vm, 0x42EB50, PALETTE, 0x5000)
    vm.call(0x423B2F, limit=2_000_000_000)
    side = vm.u32(SIDES)
    vm.write(side, name + b'\0')
    vm.set_u32(side + 0x9C, master)
    vm.call(STATS_POINTER)
    if stats is not None:
        vm.write(vm.u32(STATS), struct.pack('<59i', *stats))
    vm.set_u32(KIND, kind)
    vm.base = vm.read(0x4800E0, 0xEC * 4)  # 창을 열기 전 팔레트(앞 장면이 남긴 색)
    assert vm.call(0x41BECB, limit=8_000_000_000) == 1
    return vm


def snapshot(vm) -> list:
    return [zlib.crc32(vm.read(vm.u32(BITS), 768 * 512)), zlib.crc32(palette(vm)[40:246 * 4]), vm.u32(THREADS), vm.u32(OBJECTS), vm.u32(INDEX)]


def run(vm, limit: int, late=None, until=None) -> dict:
    """late: (주기, 더 내릴 양). ED 번호(0x483528)가 바뀌면 멈춘다(until이 있으면 그 번호가 될 때까지 ED를 이어 간다)"""
    ticks = [snapshot(vm)]
    index = vm.u32(INDEX)
    t = 0
    while t < limit:
        t += 1
        vm.tick = t
        step = 3 + (late[1] if late and t % late[0] == 0 else 0)
        vm.set_u32(COUNTER, max(vm.u32(COUNTER) - step, 0))
        callback = vm.u32(CALLBACK)
        if not callback:
            break
        vm.call(callback, limit=8_000_000_000)
        ticks.append(snapshot(vm) if vm.u32(WINDOW) else None)
        if vm.u32(DEFERRED) or not vm.u32(WINDOW) or (vm.u32(INDEX) != index if until is None else vm.u32(INDEX) == until):
            break
        if t % 500 == 0:
            print('tick', t, vm.u32(INDEX), flush=True)
    return {'base': vm.base.hex(), 'ticks': ticks, 'end': t, 'next': vm.u32(DEFERRED), 'index': vm.u32(INDEX), 'bgm': vm.bgm}


def ed(master: int, index: int, stats=None):
    """종류 6을 열고 ED index로 넘어간다(index > 0이면 0x41d7e8: index − 1 → index, 0x41c193)"""
    vm = boot(6, master, b'Floyd', stats)
    if index > 0:
        vm.set_u32(INDEX, index - 1)
        vm.bgm.clear()
        vm.call(0x41D7E8, limit=8_000_000_000)
    return vm


def report(vm) -> dict:
    """보고서: 처음 40틱(페이드·단추 깜빡임), 단추 마우스 위, 다음·앞 쪽 클릭(0 → 1 → 0 → 1 → 2 → 타이틀). 입력마다 4틱"""
    pages = []

    def settle(n):
        out = []
        for _ in range(n):
            vm.set_u32(COUNTER, max(vm.u32(COUNTER) - 3, 0))
            vm.call(vm.u32(CALLBACK), limit=8_000_000_000)
            out.append(snapshot(vm))
        return out

    start = settle(40)
    window = vm.u32(WINDOW)
    for event in (('hover', 0x2A0, 0x1D8), ('click', 0x2A0, 0x1D8), ('hover', 0x250, 0x1D8), ('click', 0x250, 0x1D8), ('click', 0x2A0, 0x1D8), ('click', 0x2A0, 0x1D8), ('click', 0x2A0, 0x1D8)):
        kind, x, y = event
        before = len(vm.sounds)
        if kind == 'hover':
            vm.call(HOVER, x, y, limit=2_000_000_000)
        else:
            thiscall(vm, CLICK, window, x, y, limit=8_000_000_000)
        if not vm.u32(WINDOW):
            pages.append({'event': list(event), 'sounds': [s[1] for s in vm.sounds[before:]], 'closed': True, 'next': vm.u32(DEFERRED)})
            break
        now = snapshot(vm)
        pages.append({'event': list(event), 'sounds': [s[1] for s in vm.sounds[before:]], 'page': vm.u32(0x482DC8), 'hover': struct.unpack('<i', vm.read(0x483414, 4))[0], 'snapshot': now, 'ticks': settle(4)})
    return {'base': vm.base.hex(), 'side': vm.read(vm.u32(SIDES), 0xC0).hex(), 'start': start, 'pages': pages}


def main_report() -> None:
    # 보고서(0x483528 = 0x1a → 0x41d7e8 → 0x1b, 0x41c2f2): 통계 임의 값과 0(0으로 나누기 피함)
    cases = []
    stats = [(k * 37 + 11) % 400 for k in range(59)]
    stats[0] = 0x5A0 * 3 + 0x3C * 7 + 5  # 날·시·분
    for values in (stats, [0] * 59):
        vm = boot(6, 9, b'Floyd', values)
        side = vm.u32(SIDES)
        vm.write(side + 0x1C, struct.pack('<7i', 3, 10, 12, 14, 0, 0, 0))
        vm.write(side + 0x38, struct.pack('<25i', 12, *range(1, 24, 2), *([0] * 12)))
        vm.set_u32(INDEX, 0x1A)
        vm.call(0x41D7E8, limit=8_000_000_000)
        cases.append({'kind': 'report', 'args': {'stats': values}, 'expected': report(vm)})
    write_fixture('sceneReport', 0x41C2F2, cases)


def main_more() -> None:
    vm = ed(9, 7)
    case = {'kind': 'ending', 'args': {'kind': 6, 'master': 9, 'name': 'Floyd', 'index': 7}, 'expected': run(vm, 30000)}
    write_fixture('sceneMore', 0x41BECB, [case])


def main_chain() -> None:
    # ED 사슬(ONLY=chain → sceneChain.json): 마스터 ED(9)에서 ED 1이 끝나 ED 2로 넘어가는 틱까지. 글 시계가 ED 사이에 이어진다
    vm = ed(9, 0)
    case = {'kind': 'ending', 'args': {'kind': 6, 'master': 9, 'name': 'Floyd', 'index': 0}, 'expected': run(vm, 60000, until=2)}
    print('chain', case['expected']['end'], case['expected']['index'], flush=True)
    write_fixture('sceneChain', 0x41BECB, [case])


def main() -> None:
    if os.environ.get('ONLY') == 'report':
        return main_report()
    if os.environ.get('ONLY') == 'chain':
        return main_chain()
    if os.environ.get('ONLY') == 'more':
        return main_more()
    cases = []
    for kind in range(6):
        vm = boot(kind, 9, b'Floyd')
        cases.append({'kind': 'script', 'args': {'kind': kind, 'master': 9, 'name': 'Floyd'}, 'expected': run(vm, 5000)})
        print('kind', kind, cases[-1]['expected']['end'], flush=True)
    # 이름에 %가 든 경우: %M은 이름으로 바뀌고, 이름 안의 %는 그대로
    vm = boot(0, 0x14, b'A%Mx%%')
    cases.append({'kind': 'script', 'args': {'kind': 0, 'master': 0x14, 'name': 'A%Mx%%'}, 'expected': run(vm, 5000)})
    # 늦은 틱: 7틱마다 카운터를 9 더 내린다
    vm = boot(2, 9, b'Floyd')
    cases.append({'kind': 'late', 'args': {'kind': 2, 'master': 9, 'name': 'Floyd', 'late': [7, 9]}, 'expected': run(vm, 5000, late=(7, 9))})
    # 엔딩: 마스터 ED 둘(9, 숨은 0x14)과 이어지는 ED 셋(1, 0xd, 0x1a 끝). ED n > 0은 마스터 ED 첫 스텝이 글 시계를 깎은 상태에서 열어
    # 앞에 약 2530틱 기다림이 붙는다(실제 사슬의 ED 1은 173틱). ED 사이 시계 이어짐은 픽스처에 없다(코드는 원작대로 이어 감)
    for master, index in ((9, 0), (0x14, 0), (9, 1), (9, 0xD), (9, 0x1A)):
        vm = ed(master, index)
        cases.append({'kind': 'ending', 'args': {'kind': 6, 'master': master, 'name': 'Floyd', 'index': index}, 'expected': run(vm, 30000)})
        print('ending', master, index, cases[-1]['expected']['end'], flush=True)
    write_fixture('scene', 0x41BECB, cases)


if __name__ == '__main__':
    main()
