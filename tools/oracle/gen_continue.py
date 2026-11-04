"""이어 하기(중단 저장) 정답 픽스처. 실행: pnpm oracle continue

판을 사람 대 사람으로 진행하며 입력 대기 몇 곳에서 원작 저장(0x441e36)을 부른다. 파일·레지스트리·창 API는 대역이다:
SAVE 경로는 메모리 파일, 창 객체 넷(전장·미니맵·정보·도움말)은 GetWindowRect·ScreenToClient 대역으로 MDI 클라이언트 좌표의 바깥 사각형을 준다
(없는 창은 블록 칸을 그대로 둔다). 슬롯 대화 상자(0x41bb7b)는 대역으로 칸을 고른다. 정답은 SV1xx 파일 바이트(뒤섞인 그대로)와,
그 파일들로 부른 목록 줄 0x44161a(식별값 맞음·틀림, 날짜 둘, 게임 데이터 형식, SV080 형식)이다. 마스터 이름이 긴 판(마스터 23·20)은 넘친 줄 전체를 남긴다.
"""
import base64
import random
import struct
import sys
import os
import zlib

sys.path.insert(0, os.path.dirname(__file__))
from unicorn.x86_const import UC_X86_REG_ECX  # noqa: E402
from battle import BLOCK, BLOCK_SIZE, packed_block, quiet_screen, start_free_battle  # noqa: E402
from fixture import write_fixture  # noqa: E402
from gen_games import GAMES, choose  # noqa: E402
from gen_turns import AUTOSAVE, BEGIN_TURN, END_BATTLE, HANDLER, SPRITE_CONVERT, pump, run  # noqa: E402
from original import read_original  # noqa: E402
from vm import SCRATCH  # noqa: E402

K = 'KERNEL32.dll!'
U = 'USER32.dll!'
SAVE = 0x441E36
ROW = 0x44161A
SCRAMBLE = 0x44147F
SLOT_IDS = 0x4CC7F0
SCENE = 0x503FC8
DIALOG = 0x41BB7B            # DialogBoxParamA(fastcall, ECX = 대화 상자 객체)
ORIGIN = (4, 42)             # MDI 클라이언트의 화면 원점(대역)
WINDOWS = {'battle': (0x478DF8, 0x501), 'view': (0x478DEC, 0x502), 'status': (0x476C00, 0x503), 'help': (0x483E44, 0x504)}
LAYOUTS = [  # 창별 바깥 사각형(MDI 클라이언트 좌표), 없으면 None
    {'battle': (0, 0, 760, 560), 'view': (756, 0, 1020, 192), 'status': (756, 192, 1020, 555), 'help': (0, 600, 632, 764)},
    {'battle': (10, 20, 500, 400), 'view': None, 'status': (600, 30, 866, 394), 'help': None},
    {'battle': (-30, 5, 730, 505), 'view': (700, 300, 966, 494), 'status': None, 'help': (100, 520, 732, 684)},
]
DATES = [(2026, 1, 2, 3, 4), (1999, 12, 31, 23, 59)]


def path_of(vm, name):
    raw = vm.read(name, 260)
    return raw[:raw.index(0)].decode('ascii')


def install(vm, files, rects, date):
    mine = {}

    def create(vm_, name, access, share, sec, disp, flags, tmpl):
        p = path_of(vm, name)
        if '\\SAVE\\' not in p:
            return vm._create_file(vm_, name, access, share, sec, disp, flags, tmpl)
        if not access & 0x40000000 and p not in files:
            return 0xFFFFFFFF
        h = 0x9000 + 4 * len(mine)
        mine[h] = [p, bool(access & 0x40000000), bytearray() if access & 0x40000000 else files[p], 0]
        return h

    def read(vm_, h, buf, size, got, ovl):
        if h not in mine:
            return vm._read_file(vm_, h, buf, size, got, ovl)
        e = mine[h]
        data = bytes(e[2][e[3]:e[3] + size])
        e[3] += len(data)
        vm.write(buf, data)
        if got:
            vm.set_u32(got, len(data))
        return 1

    def write(vm_, h, buf, size, put, ovl):
        mine[h][2] += vm.read(buf, size)
        if put:
            vm.set_u32(put, size)
        return 1

    def close(vm_, h):
        if h in mine:
            e = mine.pop(h)
            if e[1]:
                files[e[0]] = bytes(e[2])
            return 1
        return vm._files.pop(h).close() or 1

    def to_system(vm_, src, dst):
        y, mo, d, hh, mi = date[0]
        vm.write(dst, struct.pack('<8H', y, mo, 0, d, hh, mi, 0, 0))
        return 1

    def rect(vm_, hwnd, out):
        l, t, r, b = rects[hwnd]
        vm.write(out, struct.pack('<4i', l + ORIGIN[0], t + ORIGIN[1], r + ORIGIN[0], b + ORIGIN[1]))
        return 1

    def to_client(vm_, hwnd, pt):
        x, y = struct.unpack('<2i', vm.read(pt, 8))
        vm.write(pt, struct.pack('<2i', x - ORIGIN[0], y - ORIGIN[1]))
        return 1

    for name, n, fn in (('CreateFileA', 7, create), ('ReadFile', 5, read), ('WriteFile', 5, write), ('CloseHandle', 1, close),
                        ('DeleteFileA', 1, lambda vm_, name: files.pop(path_of(vm, name), None) and 1 or 1),
                        ('GetFileTime', 4, lambda vm_, h, c, a, w: (vm.write(w, struct.pack('<Q', 0x01D0000000000000)), 1)[1]),
                        ('FileTimeToLocalFileTime', 2, lambda vm_, s, d: (vm.write(d, vm.read(s, 8)), 1)[1]),
                        ('FileTimeToSystemTime', 2, to_system)):
        vm.stub_api(K + name, n, fn)
    vm.stub_api(U + 'GetWindowRect', 2, rect)
    vm.stub_api(U + 'GetParent', 1, lambda vm_, h: 0x600)
    vm.stub_api(U + 'ScreenToClient', 2, to_client)
    vm.stub_api(U + 'MessageBoxA', 4, lambda vm_, h, t, c, f: 1)


def row(vm, n, ident) -> dict:
    buf = SCRATCH + 0x100000
    vm.write(buf, bytes(0x60))
    vm.call(ROW, n, ident & 0xFFFFFFFF, buf, limit=200_000_000)
    return {'valid': vm.u32(buf), 'text': vm.read(buf + 4, 0x5C).split(b'\0')[0].decode('latin1')}


def battle(exe, m, masters, levels):
    vm = start_free_battle(exe, m, masters, levels)
    quiet_screen(vm)
    vm.stub_function(SPRITE_CONVERT, 3, lambda vm, *a: 0)
    vm.stub_function(AUTOSAVE, 0, lambda vm: 0)
    ended = []
    vm.stub_function(END_BATTLE, 0, lambda vm: ended.append(1) or 0)
    for side in (0, 1):
        vm.set_u32(vm.u32(0x45E0EC) + side * 0x18, 0)  # 둘 다 사람: 차례마다 입력 대기
    vm.set_u32(HANDLER, BEGIN_TURN)
    pump(vm, ended)
    return vm, ended


def setup(vm, files, rects, date, ids):
    install(vm, files, rects, date)
    for i, ident in enumerate(ids):
        vm.set_u32(SLOT_IDS + i * 4, ident)
    picked = {'slot': 0}

    def dialog(vm_):
        this = vm.uc.reg_read(UC_X86_REG_ECX)
        vm.set_u32(this + 0x34, picked['slot'])
        return 1
    vm.stub_function(DIALOG, 0, dialog)
    return picked


def save(vm, picked, rects, layout, slot):
    for name, (glob, hwnd) in WINDOWS.items():
        r = layout[name]
        if r is None:
            vm.set_u32(glob, 0)
            continue
        obj = SCRATCH + 0x810000 + hwnd * 0x10
        vm.set_u32(obj + 4, hwnd)
        vm.set_u32(glob, obj)
        rects[hwnd] = r
    vm.set_u32(SCENE, 4)
    picked['slot'] = slot
    before = packed_block(vm)
    assert vm.call(SAVE, 0, limit=2_000_000_000) == 1
    for glob, _ in WINDOWS.values():  # 가짜 창 객체를 떼어 다음 차례 그리기가 쓰지 않게
        vm.set_u32(glob, 0)
    return before


def main() -> None:
    exe = read_original('vmv2.exe')
    ids = [0x1230 + i * 7 for i in range(8)]
    cases = []
    files, rects, date = {}, {}, [DATES[0]]
    n = 0
    for g, (m, masters, levels) in enumerate(GAMES[:2]):
        rng = random.Random(9100 + g)
        vm, ended = battle(exe, m, masters, levels)
        picked = setup(vm, files, rects, date, ids)
        stats = dict.fromkeys(('summon', 'master hit', 'attack', 'magic', 'advance', 'turns'), 0)
        for turn in range(16):
            if ended:
                break
            if turn % 5 == 0:
                slot = n % 8
                layout = LAYOUTS[n % len(LAYOUTS)]
                before = save(vm, picked, rects, layout, slot)
                file = files[f'C:\\VMO_WIN\\SAVE\\SV{100 + slot}.DAT']
                rows = []
                for d in DATES:
                    date[0] = d
                    rows.append({'n': 100 + slot, 'id': ids[slot], 'date': list(d), **row(vm, 100 + slot, ids[slot])})
                rows.append({'n': 100 + slot, 'id': ids[slot] + 1, 'date': list(DATES[0]), **row(vm, 100 + slot, ids[slot] + 1)})
                date[0] = DATES[0]
                cases.append({'kind': 'save', 'args': {'map': m, 'block': base64.b64encode(zlib.compress(before)).decode(), 'windows': layout, 'slot': slot, 'id': ids[slot]},
                              'expected': {'file': base64.b64encode(file).decode(), 'rows': rows}})
                print(n, g, turn, slot, flush=True)
                n += 1
            run(vm, choose(vm, rng, stats), ended)
        # 같은 블록을 게임 데이터(SV005, 식별값 0)와 자동 저장(SV080, 식별값 1) 형식으로
        plain = bytearray(vm.read(BLOCK, BLOCK_SIZE))
        for number, ident in ((5, 0), (0x50, 1)):
            struct.pack_into('<I', plain, 0, ident)
            vm.write(SCRATCH, bytes(plain))
            vm.call(SCRAMBLE, SCRATCH)
            files[f'C:\\VMO_WIN\\SAVE\\SV{number:03d}.DAT'] = vm.read(SCRATCH, BLOCK_SIZE)
            cases.append({'kind': 'row', 'args': {'map': m, 'file': base64.b64encode(files[f'C:\\VMO_WIN\\SAVE\\SV{number:03d}.DAT']).decode(), 'n': number, 'id': ident, 'date': list(DATES[0])},
                          'expected': row(vm, number, ident)})
    # 넘침: 마스터 이름이 긴 판(23 "Shaman of the Dawn", 20 "Bounty Hunter")
    vm, ended = battle(exe, 3, (23, 20), (24, 24))
    picked = setup(vm, files, rects, date, ids)
    save(vm, picked, rects, LAYOUTS[0], 6)
    file = files['C:\\VMO_WIN\\SAVE\\SV106.DAT']
    cases.append({'kind': 'row', 'args': {'map': 3, 'file': base64.b64encode(file).decode(), 'n': 106, 'id': ids[6], 'date': list(DATES[0])}, 'expected': row(vm, 106, ids[6])})
    write_fixture('continue', SAVE, cases)


if __name__ == '__main__':
    main()
