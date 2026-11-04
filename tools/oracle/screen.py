"""오라클 화면 버퍼: 원작 그래픽을 대역 없이 돌려 전장 화면 DIB(8비트 색 번호)를 떠낸다.

창·GDI 호출은 아무 일도 하지 않게 대역으로 두고, CreateDIBSection만 에뮬레이터 메모리에 비트를 잡는다. 원작 순서대로
팔레트 객체(0x42eb50)·글꼴(0x423b2f)·창 배치(0x4510ca)·창 DIB(0x4516f4)를 준비하고, 프리 모드 메뉴와 새 전투 시작(0x4017a2의 단계들)을
그래픽을 켠 채 실행한다. 전장 창(CBattleWnd, 0x478df8)의 칩 그리기(0x43ef06)를 화면 칩 65 × 84칸마다 불러 전장 DIB(0x48f6c4,
1560 × 1008)를 채운다. 원작 WM_PAINT(0x43f467)는 바뀐 칩만 그리지만(0x43c8aa) 결과는 같다.
"""
import struct

from boot import Booted
from battle import BLOCK, FIRST_TURN, FREE_MODE_MENU, LOAD_MAP, MAP_SELECTION, MASTER_STATS, SIDES, packed_block

PALETTE = 0x4825C0          # 팔레트·DIB 정보 객체: +4 HPALETTE, +8 LOGPALETTE, +0xc BITMAPINFO(색 표는 +0x28)
ZOOM = 0x478DF0             # → 전장 확대(0 반 크기, 1 칩 24 × 12, 2 두 배). 원작은 옵션에서 읽는다
BATTLE_WINDOW = 0x478DF8    # CBattleWnd
FIELD_BITS = 0x48F6C4       # 전장 DIB 비트
CHIPS_X, CHIPS_Y = 0x41, 0x54
CHIP_W, CHIP_H = 24, 12
FIELD_W, FIELD_H = CHIPS_X * CHIP_W, CHIPS_Y * CHIP_H
DRAW_CHIP = 0x43EF06        # (this, 받을 곳, 칩 x, 칩 y, 줄 끝에서 다음 줄까지 바이트)
START_STEPS = (0x401A0C, 0x407C39, 0x401019, 0x4255BB, 0x40218F, 0x43B6C2, 0x40F521, 0x440210)  # 0x4017a2 안
LOAD_MAP_AI = 0x44C8C3
THIS_SLOT = 0x0FFF0800      # thiscall 도우미: 호출 표식 페이지 안
THUNK_BASE = 0x0FFF0810


def install_gdi(vm) -> None:
    handles = iter(range(0x5000, 0x7FFFFFFF, 4))
    dibs = vm.dibs = {}

    def create_dib(vm, hdc, info, usage, bits_out, section, offset):
        size, width, height, planes, bits = struct.unpack('<IiiHH', vm.read(info, 16))
        stride = ((width * bits + 31) // 32) * 4
        at = vm._bump('heap', stride * abs(height))
        if bits_out:
            vm.set_u32(bits_out, at)
        h = next(handles)
        dibs[h] = (at, width, height, bits)
        return h

    def get_object(vm, h, size, out):
        if h not in dibs:
            return 0
        at, width, height, bits = dibs[h]
        stride = ((width * bits + 31) // 32) * 4
        vm.write(out, struct.pack('<iiiiHHI', 0, width, abs(height), stride, 1, bits, at)[:size])
        return size

    def rect(vm, hwnd, out):
        vm.write(out, struct.pack('<iiii', 0, 0, 1024, 768))
        return 1

    def message_box(vm, hwnd, text, caption, flags):
        raise RuntimeError('원작 메시지 상자: ' + vm.read(text, 200).split(b'\0')[0].decode('latin1'))

    def lstrcpy(vm, dest, src):
        vm.write(dest, vm.read(src, 260).split(b'\0')[0] + b'\0')
        return dest

    handle = lambda vm, *a: next(handles)
    one = lambda vm, *a: 1
    zero = lambda vm, *a: 0
    table = {  # 이름: (인자 수, 대역)
        'CreateDIBSection': (6, create_dib), 'GetObjectA': (3, get_object), 'MessageBoxA': (4, message_box),
        'GetClientRect': (2, rect), 'GetWindowRect': (2, rect), 'lstrcpyA': (2, lstrcpy),
        'lstrlenA': (1, lambda vm, s: len(vm.read(s, 1024).split(b'\0')[0])),
        'GetSystemMetrics': (1, lambda vm, i: {0x20: 4, 4: 18, 0x21: 4, 2: 16, 3: 16, 7: 4, 8: 4}.get(i, 0)),
        'GetDeviceCaps': (2, lambda vm, dc, i: {0x26: 0x100, 0x68: 0x100}.get(i, 0)),
        'GetSystemPaletteEntries': (4, lambda vm, *a: 256),
        'SendMessageA': (4, lambda vm, w, msg, wp, lp: next(handles) if msg == 0x220 else 0),  # WM_MDICREATE
        'GetCursorPos': (1, lambda vm, p: (vm.write(p, struct.pack('<ii', 0, 0)), 1)[1]),
        'SetRect': (5, lambda vm, r, a, b, c, d: (vm.write(r, struct.pack('<iiii', a, b, c, d)), 1)[1]),
        'BeginPaint': (2, handle), 'GetDC': (1, handle), 'CreateCompatibleDC': (1, handle), 'SelectObject': (2, handle),
        'CreateWindowExA': (12, handle), 'LoadCursorA': (2, handle), 'LoadIconA': (2, handle), 'GetStockObject': (1, handle),
        'CreateFontA': (14, handle), 'SelectPalette': (3, handle), 'CreatePalette': (1, handle), 'GetMenu': (1, handle),
        'GetSubMenu': (2, handle), 'GetDlgItem': (2, handle), 'CreateSolidBrush': (1, handle), 'CreatePen': (3, handle),
        'CreateRectRgn': (4, handle),
        'SetPaletteEntries': (4, lambda vm, *a: a[2]), 'GetPaletteEntries': (4, lambda vm, *a: a[2]),
        'SetDIBColorTable': (4, lambda vm, *a: a[2]), 'GetDIBColorTable': (4, lambda vm, *a: a[2]),
        **{n: (k, one) for n, k in (
            ('DeleteObject', 1), ('ReleaseDC', 2), ('DeleteDC', 1), ('ShowWindow', 2), ('UpdateWindow', 1),
            ('InvalidateRect', 3), ('SetWindowPos', 7), ('MoveWindow', 6), ('PostMessageA', 4), ('RegisterClassA', 1),
            ('SetBkMode', 2), ('SetScrollRange', 5), ('DrawMenuBar', 1), ('SetWindowTextA', 2), ('DestroyWindow', 1),
            ('IsWindow', 1), ('ScreenToClient', 2), ('ClientToScreen', 2), ('AdjustWindowRectEx', 4), ('EndPaint', 2),
            ('BitBlt', 9), ('StretchBlt', 11), ('PatBlt', 6), ('TextOutA', 5), ('FillRect', 3), ('ReleaseCapture', 0),
            ('IsWindowVisible', 1), ('IsWindowEnabled', 1), ('BringWindowToTop', 1), ('KillTimer', 2), ('SetTimer', 4),
            ('ValidateRect', 2), ('RedrawWindow', 4), ('ScrollWindow', 5), ('SetDIBitsToDevice', 12),
            ('StretchDIBits', 13), ('SelectClipRgn', 2), ('GetTextExtentPoint32A', 4), ('GetTextExtentPointA', 4),
            ('DPtoLP', 3), ('LPtoDP', 3), ('SetViewportOrgEx', 4), ('SetWindowOrgEx', 4), ('SetMapMode', 2),
            ('SetViewportExtEx', 4), ('SetWindowExtEx', 4))},  # 확대 1: 장치·논리 좌표가 같다
        **{n: (k, zero) for n, k in (
            ('RealizePalette', 1), ('SetTextColor', 2), ('SetScrollPos', 4), ('SetScrollInfo', 4), ('EnableMenuItem', 3),
            ('CheckMenuItem', 3), ('GetFocus', 0), ('SetFocus', 1), ('timeGetTime', 0), ('GetTickCount', 0),
            ('GetActiveWindow', 0), ('DefWindowProcA', 4), ('DefMDIChildProcA', 4), ('GetWindowLongA', 2),
            ('SetWindowLongA', 3), ('IsIconic', 1), ('GetParent', 1), ('PeekMessageA', 5), ('GetMessageA', 4),
            ('TranslateMessage', 1), ('DispatchMessageA', 1), ('Sleep', 1), ('SetCapture', 1), ('GetKeyState', 1),
            ('GetAsyncKeyState', 1), ('GetWindow', 2), ('EnableWindow', 2), ('SetActiveWindow', 1), ('GetClassNameA', 3),
            ('GetWindowTextA', 3), ('GetUpdateRect', 3), ('SetBkColor', 2))},
    }
    for name, (nargs, handler) in table.items():
        for full in [k for k in vm._api_names.values() if k.endswith('!' + name)]:
            vm.stub_api(full, nargs, handler)


def thiscall(vm, fn: int, this: int, *args, limit: int = 2_000_000_000) -> int:
    """ecx = this로 부른다(vm.call은 레지스터를 0으로 둔다). 함수마다 따로 둔 점프 코드: mov ecx, [THIS_SLOT]; jmp fn.
    Unicorn은 같은 주소의 번역을 다시 쓰므로 한 자리에 다른 점프를 덮어쓰지 않는다"""
    thunks = vm.__dict__.setdefault('thunks', {})
    if fn not in thunks:
        at = THUNK_BASE + 16 * len(thunks)
        vm.write(at, b'\x8B\x0D' + struct.pack('<I', THIS_SLOT) + b'\xE9' + struct.pack('<i', fn - (at + 11)))
        thunks[fn] = at
    vm.set_u32(THIS_SLOT, this)
    return vm.call(thunks[fn], *args, limit=limit)


def start_screen_battle(exe: bytes, map_index: int, masters=(0, 1), levels=(24, 24)) -> Booted:
    """그래픽을 켠 프리 배틀: 첫 차례 준비(0x401b12)까지 원작 그대로 실행한다"""
    vm = Booted(exe)
    install_gdi(vm)
    thiscall(vm, 0x42EB50, PALETTE, 0x5000)  # 팔레트 객체(WinMain)
    for address in (0x423B2F, 0x4510CA, 0x4516F4):  # 글꼴, 창 배치, 창 DIB(WinMain → 0x45102d)
        vm.call(address, limit=2_000_000_000)
    vm.set_u32(vm.u32(ZOOM), 1)
    for address in (0x4510CA, 0x4516F4):  # 프리 모드 메뉴가 다시 부르지 않게
        vm.stub_function(address, 0, lambda vm: 0)
    vm.call(FREE_MODE_MENU, limit=2_000_000_000)
    sides = vm.u32(SIDES)
    for side, (master, level) in enumerate(zip(masters, levels)):
        vm.set_u32(sides + side * 0xC0 + 0x9C, master)
        vm.set_u32(sides + side * 0xC0 + 0xA0, level)
        vm.call(MASTER_STATS, sides + side * 0xC0)
    vm.set_u32(vm.u32(MAP_SELECTION), map_index)
    assert vm.call(LOAD_MAP, map_index) == 1
    for address in START_STEPS:  # 0x4017a2: 그림 읽기 … 지형 그래프
        assert vm.call(address, limit=2_000_000_000) != 0 or address in (0x4255BB,), hex(address)
    vm.call(LOAD_MAP_AI, map_index, limit=2_000_000_000)
    vm.call(FIRST_TURN, vm.u32(map_struct(vm) + 0x3C), limit=4_000_000_000)  # 맵 +0x3c 전투 시작 시각
    return vm


def resume_screen_battle(exe: bytes, block: bytes, map_index: int, options: int | None = None) -> Booted:
    """그래픽을 켠 채 상태 블록을 되살리기(0x401899)로 넣는다: 유닛·표시 객체를 블록 순서로 만들고 첫 차례 준비(0x401b12)까지.
    options는 애니메이션 옵션(0x503ff0, 원작 기본 0x77). 주지 않으면 레지스트리 대역이 준 0"""
    vm = Booted(exe)
    install_gdi(vm)
    thiscall(vm, 0x42EB50, PALETTE, 0x5000)
    for address in (0x423B2F, 0x4510CA, 0x4516F4):
        vm.call(address, limit=2_000_000_000)
    vm.set_u32(vm.u32(ZOOM), 1)
    for address in (0x4510CA, 0x4516F4):
        vm.stub_function(address, 0, lambda vm: 0)
    vm.stub_function(0x44EB07, 0, lambda vm: 0)  # 레지스트리에 이어 하기 표시를 쓴다(화면과 무관, 레지스트리 객체 없음)
    vm.call(FREE_MODE_MENU, limit=2_000_000_000)
    vm.set_u32(vm.u32(MAP_SELECTION), map_index)
    assert vm.call(LOAD_MAP, map_index) == 1
    vm.write(BLOCK, block)
    vm.set_u32(vm.u32(ZOOM), 1)  # 확대 옵션은 블록 +0x2a8에 있다
    if options is not None:  # 창 준비 뒤에: 음악 비트가 켜져 있으면 창 준비가 MCI를 부른다
        vm.write(OPTIONS, options.to_bytes(2, 'little'))
    vm.call(RESUME, limit=4_000_000_000)
    return vm


def draw_field(vm) -> bytes:
    """전장 DIB를 모든 칩으로 다시 채워 돌려준다"""
    window, bits = vm.u32(BATTLE_WINDOW), vm.u32(FIELD_BITS)
    for y in range(CHIPS_Y):
        for x in range(CHIPS_X):
            thiscall(vm, DRAW_CHIP, window, bits + FIELD_W * CHIP_H * y + CHIP_W * x, x, y, CHIP_W * (CHIPS_X - 1))
    return vm.read(bits, FIELD_W * FIELD_H)


def palette(vm) -> bytes:
    """DIB 색 표(RGBQUAD 256개)"""
    return vm.read(vm.u32(PALETTE + 0xC) + 0x28, 1024)


def map_struct(vm) -> int:
    """지금 맵 구조체 주소(**0x48391c)"""
    return vm.u32(vm.u32(0x48391C))


OPTIONS = 0x503FF0          # 애니메이션 옵션 u16: 1 하늘, 2 물, 4 대기 애니메이션, 8 …
RESUME = 0x401899           # 되살리기: 그림 읽기 → 유닛(블록 순서) → 첫 차례 준비
WATER_FRAME = 0x49DE20      # 물 애니메이션 프레임 0~3(지형 겹 목록 0x48e654[프레임])
SKY_SCROLL = 0x48F664       # 하늘 줄마다 가로 스크롤(i32 20개)
SKY_FRAME = 0x48E650        # → 하늘 배치 프레임
SPRITES = 0x47C2B0          # 표시 객체 풀(0x16바이트), 개수 0x47c2a8
SPRITE_COUNT = 0x47C2A8
COMPOSE = 0x43D636          # 칩마다 겹 목록을 짓는다(지형 프레임 0x49de20 + 강조 + 하늘 + 표시 객체)


def hide_sprites(vm) -> None:
    """표시 객체를 모두 숨기고(+0x13 | 0x80) 겹 목록을 다시 짓는다: 지형과 하늘만 남는다"""
    for i in range(vm.u32(SPRITE_COUNT)):
        at = SPRITES + i * 0x16 + 0x13
        vm.write(at, bytes([vm.read(at, 1)[0] | 0x80]))
    vm.call(COMPOSE, limit=2_000_000_000)
