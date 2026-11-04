"""정보 대화 상자 정답 픽스처: 네이티얼 채우기(0x444ec8)·라디오(0x444c2b), 마법 선택(0x4258ca), 마스터 채우기(0x444376)와 그림.
실행: pnpm oracle info_dialogs

그래픽을 켠 전투를 만들고 대화 상자 API를 기록 대역으로 바꾼다(SetDlgItemTextA·SetDlgItemInt → 칸 글, EnableWindow → 켬, CheckRadioButton
→ 체크, SendDlgItemMessageA LB_GETCURSEL → 시나리오의 선택, MapDialogRect → 기준 단위 7 × 16). 대화 상자 객체는 원작 vtable을 가진 가짜다.
그림은 원작이 칩을 페이지에 읽은 뒤 DIB에 놓는 일(0x4453df·0x444652·0x425ab5)을 오라클 메모리(배치표 *0x48355c, 칩 *0x489644, 색 바꿈 표 1)로
다시 해서 줄별 CRC32를 남긴다(GDI의 StretchBlt는 돌리지 않는다).
"""
import os
import struct
import sys
import zlib

sys.path.insert(0, os.path.dirname(__file__))
from battle import MASTER_STATS, SIDES  # noqa: E402
from fixture import write_fixture  # noqa: E402
from original import read_original  # noqa: E402
from screen import map_struct, start_screen_battle, thiscall  # noqa: E402

FILL_NATIAL = 0x444EC8      # thiscall(종류, 진영)
RADIOS = 0x444C2B           # thiscall(0 = 객체 → 컨트롤)
SELECT_MAGIC = 0x4258CA     # fastcall
FILL_MASTER = 0x444376      # fastcall
NATIAL_VTABLE = 0x45B528    # 0x7f: +0x18 그림 사각형 0x445355
MAGIC_VTABLE = 0x45B59C     # 0x70: +0x14 값 검사 0x42586e
MASTER_VTABLE = 0x45B544    # 0x80: +0x1c 그림 사각형 0x4445c8
SOUND = 0x443D19
HELP_MAGIC = 0x424FD5
HWND = 0x1234
ITEM = 0x10000              # GetDlgItem 대역 핸들 = ITEM + 컨트롤 ID
LAYOUTS = 0x48355C          # → → 배치표
CHIPS = 0x489644            # → 칩 덩어리(칩 × 0x120)
TINTS = 0x473BB4            # 색 바꿈 표 포인터들
SPELLS = (10, 11, 12, 13, 14, 15, *range(20, 34))


class Log:
    def __init__(self):
        self.clear()

    def clear(self):
        self.texts, self.enabled, self.checked, self.sounds, self.help = {}, {}, {}, [], []

    def dump(self) -> dict:
        out = {'texts': {str(k): v for k, v in sorted(self.texts.items())}}
        if self.enabled:
            out['enabled'] = {str(k): v for k, v in sorted(self.enabled.items())}
        if self.checked:
            out['checked'] = sorted(self.checked.values())
        if self.sounds:
            out['sounds'] = self.sounds
        if self.help:
            out['help'] = self.help
        return out


def cstr(vm, at: int) -> str:
    return vm.read(at, 256).split(b'\0')[0].decode('latin1')


def mul_div(a: int, b: int, c: int) -> int:
    return (a * b + c // 2) // c


def install(vm, log: Log, selection: list) -> None:
    def stub(name, nargs, handler):
        for full in [k for k in vm._api_names.values() if k.endswith('!' + name)]:
            vm.stub_api(full, nargs, handler)

    def text(vm, h, id, s):
        log.texts[id] = cstr(vm, s)
        return 1

    def number(vm, h, id, v, signed):
        log.texts[id] = str(v - (1 << 32) if signed and v >= 1 << 31 else v)
        return 1

    def enable(vm, h, on):
        log.enabled[h - ITEM] = bool(on)
        return 0

    def radio(vm, h, first, last, id):
        log.checked[first] = id
        return 1

    def map_rect(vm, h, r):
        left, top, right, bottom = struct.unpack('<iiii', vm.read(r, 16))
        vm.write(r, struct.pack('<iiii', mul_div(left, 7, 4), mul_div(top, 16, 8), mul_div(right, 7, 4), mul_div(bottom, 16, 8)))
        return 1

    stub('SetDlgItemTextA', 3, text)
    stub('SetDlgItemInt', 4, number)
    stub('GetDlgItem', 2, lambda vm, h, id: ITEM + id)
    stub('EnableWindow', 2, enable)
    stub('CheckRadioButton', 4, radio)
    stub('SendDlgItemMessageA', 5, lambda vm, h, id, msg, wp, lp: selection[0] & 0xFFFFFFFF if msg == 0x188 else 0)
    stub('MapDialogRect', 2, map_rect)
    vm.stub_function(SOUND, 1, lambda vm, n: (log.sounds.append(n), 0)[1])
    vm.stub_function(HELP_MAGIC, 1, lambda vm, a: (log.help.append(a), 0)[1])


def dialog(vm, vtable: int) -> int:
    at = vm._bump('heap', 0x40)
    vm.set_u32(at, vtable)
    vm.set_u32(at + 4, HWND)
    return at


def chip_rows(vm, chip: int) -> list:
    """칩 하나(24 × 12)를 색 바꿈 표 1로 바꾼 줄들"""
    tint = vm.read(vm.u32(TINTS + 4), 256)
    raw = vm.read(vm.u32(CHIPS) + (chip & 0xFFFF) * 0x120, 0x120)
    return [bytes(tint[b] for b in raw[r * 24:(r + 1) * 24]) for r in range(12)]


def picture(vm, width: int, height: int, cells) -> list:
    """cells: (x, 줄, 칩) → DIB(memset 10) 줄 CRC"""
    dib = bytearray([10]) * (width * height)
    for x, y, chip in cells:
        for r, row in enumerate(chip_rows(vm, chip)):
            dib[(y + r) * width + x:(y + r) * width + x + 24] = row
    return [zlib.crc32(dib[r * width:(r + 1) * width]) for r in range(height)]


def portrait(vm, base: int) -> list:
    """vmv2.exe 0x004453df·0x00444652: 묶음 0 자세 0x10의 열 1·2, 줄 0~5 → 48 × 72"""
    layout = vm.u32(vm.u32(LAYOUTS)) + 0x400
    word = lambda k: struct.unpack('<H', vm.read(layout + k * 2, 2))[0]
    return picture(vm, 48, 72, [((c - 1) * 24, (5 - r) * 12, base + word(r + c * 8)) for c in (1, 2) for r in range(6)])


def magic_picture(vm) -> list:
    """vmv2.exe 0x00425ab5: 묶음 7 자세 14(위)·15(아래), 열 0~3 → 96 × 192"""
    layout = vm.u32(vm.u32(LAYOUTS)) + 0x2300
    word = lambda k: struct.unpack('<H', vm.read(layout + k * 2, 2))[0]
    cells = []
    for c in range(4):
        for j in range(8):
            cells.append((c * 24, (7 - j) * 12, 0x3E60 + word(j + c * 8)))
            cells.append((c * 24, (15 - j) * 12, 0x3E60 + word(j + 0x20 + c * 8)))
    return picture(vm, 96, 192, cells)


def natial_cases(vm, log: Log) -> list:
    cases = []
    for kind in range(1, 25):
        for side, level, light in [(0, lv, li) for lv in range(3) for li in range(3)] + [(1, 0, 0)]:
            obj = dialog(vm, NATIAL_VTABLE)
            vm.set_u32(obj + 0x2C, level)
            vm.set_u32(obj + 0x30, light)
            log.clear()
            thiscall(vm, FILL_NATIAL, obj, kind, side)
            case = {'kind': 'natial', 'args': {'type': kind, 'side': side, 'level': level, 'light': light}, 'expected': log.dump()}
            if level == 0 and light == 0:
                case['expected']['picture'] = portrait(vm, 0x3E60)
            cases.append(case)
    return cases


def radio_cases(vm, log: Log) -> list:
    cases = []
    m = map_struct(vm)
    for kind in (1, 4, 9, 13, 20):  # 성향 0·1·2가 섞이게
        for allowed in (0, 1):
            for changes in (0, 1):
                for filled in (False, True):
                    for level, light in ((0, 1), (2, 0), (1, 2)):
                        obj = dialog(vm, NATIAL_VTABLE)
                        vm.set_u32(obj + 0x28, allowed)
                        vm.set_u32(obj + 0x2C, level)
                        vm.set_u32(obj + 0x30, light)
                        if filled:
                            thiscall(vm, FILL_NATIAL, obj, kind, 0)
                        vm.write(m + 0x34, struct.pack('<i', changes))
                        log.clear()
                        thiscall(vm, RADIOS, obj, 0)
                        args = {'type': kind if filled else None, 'allowed': allowed, 'lightChanges': changes, 'level': level, 'light': light}
                        cases.append({'kind': 'radios', 'args': args, 'expected': {'enabled': log.dump()['enabled'], 'checked': log.dump()['checked']}})
    return cases


def magic_cases(vm, log: Log, selection: list) -> list:
    obj = dialog(vm, MAGIC_VTABLE)
    spells = vm._bump('heap', 4 + 4 * len(SPELLS))
    vm.write(spells, struct.pack(f'<i{len(SPELLS)}i', len(SPELLS), *SPELLS))
    vm.set_u32(obj + 0x24, spells)
    vm.set_u32(obj + 0x28, 0xFFFFFFFF)
    cases = []
    for index in [*range(len(SPELLS)), len(SPELLS) - 1, 3, 3]:  # 같은 선택을 다시 주면 기록이 없다
        selection[0] = index
        log.clear()
        thiscall(vm, SELECT_MAGIC, obj)
        expected = log.dump()
        if expected['texts']:
            expected['picture'] = magic_picture(vm)
        cases.append({'kind': 'magic', 'args': {'list': list(SPELLS), 'index': index}, 'expected': expected})
    return cases


def master_cases(vm, log: Log) -> list:
    cases = []
    sides = vm.u32(SIDES)
    for master in range(27):
        for side, level in ((0, 0), (1, 0), (0, 39)):
            record = sides + side * 0xC0
            vm.write(record, (b'A&B' if master == 3 else b'Master %d' % master).ljust(20, b'\0'))
            vm.set_u32(record + 0x9C, master)
            vm.set_u32(record + 0xA0, level)
            vm.call(MASTER_STATS, record)
            obj = dialog(vm, MASTER_VTABLE)
            vm.set_u32(obj + 0x24, side)
            vm.set_u32(obj + 0x28, record)
            log.clear()
            thiscall(vm, FILL_MASTER, obj)
            r = vm.read(record, 0xC0)
            stats = list(struct.unpack('<7i', r[0xA4:0xC0]))
            args = {'name': r[:20].split(b'\0')[0].decode('latin1'), 'side': side, 'master': master, 'level': level, 'attackAction': r[0x18], 'stats': stats}
            expected = log.dump()
            if level == 0:
                expected['picture'] = portrait(vm, 0x3D80)
            cases.append({'kind': 'master', 'args': args, 'expected': expected})
    return cases


def main() -> None:
    exe = read_original('vmv2.exe')
    vm = start_screen_battle(exe, 3)
    log, selection = Log(), [-1]
    install(vm, log, selection)
    cases = natial_cases(vm, log)
    print('natial', len(cases), flush=True)
    cases += radio_cases(vm, log)
    cases += magic_cases(vm, log, selection)
    cases += master_cases(vm, log)
    blank = vm.read(vm.u32(CHIPS) + 0x465F * 0x120, 0x120)
    cases.append({'kind': 'blank', 'args': {'chip': 0x465F}, 'expected': {'zero': blank == bytes(0x120)}})
    write_fixture('infoDialogs', FILL_NATIAL, cases)


if __name__ == '__main__':
    main()
