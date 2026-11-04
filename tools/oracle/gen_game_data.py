"""프리 모드 게임 데이터 저장(0x441aea)·읽기(0x44198d → 0x4510b6) 정답 픽스처. 실행: pnpm oracle game_data

그래픽을 켠 월드 장면(gen_world.boot)에서 맵·시간 제한·토글·조종을 바꾸고, 창 객체에 서로 다른 hwnd·사각형 대역을 준 뒤 저장한다.
파일·시각은 gen_continue.install 대역, 슬롯 대화 상자(0x41bb7b)는 목록을 떠 두고 고른 칸을 돌려준다. 해독 메모 notes_options.md §4.
- save: 단계마다 파일(푼 블록), 대화 상자(템플릿·목록 id·모드·80줄)
- load: 새 Vm에서 그 파일을 읽고 0x4510b6 → MDI 자식(제목·x·y·cx·cy), BGM 곡, 장면, 고른 맵, 시간 제한, 도움말 문구
"""
import os
import struct
import sys

sys.path.insert(0, os.path.dirname(__file__))
from battle import BLOCK, BLOCK_SIZE, encode_block  # noqa: E402
from boot import Booted  # noqa: E402
from fixture import write_fixture  # noqa: E402
from gen_continue import install  # noqa: E402
from gen_world import CONTROLLER, MAP_INFO, MASTER_INFO, SELECT, TIME_LIMIT, TOGGLE, WORLD, boot  # noqa: E402
from original import read_original  # noqa: E402
from screen import PALETTE, install_gdi, thiscall  # noqa: E402
from unicorn.x86_const import UC_X86_REG_ECX  # noqa: E402
from vm import SCRATCH  # noqa: E402

SAVE = 0x441AEA
LOAD = 0x44198D
ENTER_WORLD = 0x4510B6
UNSCRAMBLE = 0x441546
DIALOG = 0x41BB7B
SCENE = 0x503FC8
HELP_TEXT = 0x483D14
HELP_WINDOW = 0x483E44
SELECTED = 0x5061E8
EXE = read_original('vmv2.exe')
DATE = (2026, 3, 4, 5, 6)
U = 'USER32.dll!'


def stub(vm, addr, n, fn):
    if addr in vm._function_stubs:
        vm._function_stubs[addr] = (n, fn)
    else:
        vm.stub_function(addr, n, fn)


def hook(vm, files, rects, pick, seen):
    install(vm, files, rects, [DATE])
    vm.sounds = []
    stub(vm, 0x443D19, 1, lambda vm_, n: vm_.sounds.append(n) or 0)
    vm.bgm = []
    stub(vm, 0x443770, 1, lambda vm_, n: vm_.bgm.append(n) or 0)
    vm.mdi = []
    vm.boxes = []
    vm.stub_api(U + 'MessageBoxA', 4, lambda vm_, h, t, c, f: vm_.boxes.append(vm_.read(t, 80).split(b'\0')[0].decode('latin1')) or 1)
    counter = iter(range(0x7100, 0x7FFF, 4))

    def send(vm_, w, msg, wp, lp):
        if msg == 0x220:  # WM_MDICREATE
            cls, title, owner, x, y, cx, cy, style = struct.unpack('<8I', vm_.read(lp, 32))
            vm_.mdi.append([vm_.read(title, 40).split(b'\0')[0].decode('latin1'), *struct.unpack('<4i', struct.pack('<4I', x, y, cx, cy))])
            return next(counter)
        return 0
    vm.stub_api(U + 'SendMessageA', 4, send)

    def dialog(vm_):
        this = vm_.uc.reg_read(UC_X86_REG_ECX)
        count = vm_.u32(this + 0x28)
        arr = vm_.u32(this + 0x2C)
        seen.append({'template': vm_.u32(this + 0x18) & 0xFFFF, 'list': vm_.u32(this + 0x24) & 0xFFFF, 'mode': vm_.u32(this + 0x30),
                     'rows': [[vm_.u32(arr + i * 0x50), vm_.read(arr + i * 0x50 + 4, 76).split(b'\0')[0].decode('latin1')] for i in range(count)]})
        if pick[0] is None:
            return 2
        vm_.set_u32(this + 0x34, pick[0])
        return 1
    stub(vm, DIALOG, 0, dialog)


def plain(vm, file: bytes) -> bytes:
    vm.write(SCRATCH, file)
    assert vm.call(UNSCRAMBLE, SCRATCH) == 1
    return vm.read(SCRATCH, BLOCK_SIZE)


def name(slot: int) -> str:
    return f'C:\\VMO_WIN\\SAVE\\SV{slot:03d}.DAT'


def main() -> None:
    files, rects, pick, seen = {}, {}, [7], []
    vm = boot()
    hook(vm, files, rects, pick, seen)
    vm.call(SELECT, 3, 0, limit=4_000_000_000)
    vm.call(TIME_LIMIT, 1, limit=400_000_000)
    vm.call(TOGGLE, 4, limit=400_000_000)
    vm.call(CONTROLLER, 1, limit=400_000_000)
    for g, hw, rc in ((WORLD, 0x501, (10, 20, 790, 560)), (MAP_INFO, 0x502, (300, 40, 620, 410)), (MASTER_INFO, 0x503, (100, 300, 528, 750)), (HELP_WINDOW, 0x504, (0, 600, 632, 764))):
        if vm.u32(g):
            vm.set_u32(vm.u32(g) + 4, hw)
            rects[hw] = rc
    cases = []

    def save(label, slot):
        pick[0] = slot
        vm.sounds.clear()
        vm.boxes.clear()
        r = vm.call(SAVE, 0x4321, limit=4_000_000_000)
        d = seen[-1] if seen else None
        case = {'kind': 'save', 'args': {'label': label, 'slot': slot, 'scene': vm.u32(SCENE)},
                'expected': {'result': r, 'sounds': list(vm.sounds), 'boxes': list(vm.boxes), 'dialog': d}}
        if slot is not None and name(slot) in files and r == 1:
            case['expected']['block'] = encode_block(plain(vm, files[name(slot)]))
        cases.append(case)
        seen.clear()

    save('맵 3, MIDDLE, 진영 0 아이템 4 끔, 진영 1 사람, 창 넷', 7)
    save('같은 상태 다른 칸(목록에 칸 7이 보임)', 3)
    save('Cancel', None)
    vm.set_u32(SCENE, 4)
    save('장면 4: 대화 상자 없음', 5)
    vm.set_u32(SCENE, 3)
    vm.call(0x429A1C, limit=400_000_000)  # 맵 정보 닫기(마스터 정보도)
    save('맵 정보 창을 닫은 뒤', 9)
    vm.set_u32(vm.u32(SELECTED), 0xFFFFFFFF)
    save('고른 맵 없음', 10)
    # 전투를 한 판 한 뒤(0x40e392가 확대·전장 배치를 블록에 남김): 월드 장면에는 전장·정보 창·미니맵이 없어 0x441960이 그 칸을 그대로 둔다
    vm.set_u32(vm.u32(SELECTED), 3)
    for off, v in ((0x2A8, 2), (0x2AC, 0), (0x2B0, 0), (0x2B4, 600), (0x2B8, 520), (0x2BC, 0), (0x2C0, 610), (0x2C4, 30), (0x2C8, 1), (0x2CC, 610), (0x2D0, 300)):
        vm.set_u32(BLOCK + off, v)
    save('전투 뒤: 확대 x 2, 전장·정보 창(꺼짐)·미니맵 자리', 11)

    for slot in (7, 9, 10):
        vm2 = Booted(EXE)
        install_gdi(vm2)
        thiscall(vm2, 0x42EB50, PALETTE, 0x5000)
        vm2.call(0x423B2F, limit=2_000_000_000)
        seen2 = []
        hook(vm2, files, {}, [slot], seen2)
        vm2.write(HELP_TEXT, b'\0')
        r = vm2.call(LOAD, 0x5555, limit=4_000_000_000)
        same = vm2.read(BLOCK, BLOCK_SIZE) == plain(vm2, files[name(slot)])
        vm2.sounds.clear()
        vm2.call(ENTER_WORLD, limit=4_000_000_000)
        i32 = lambda a: struct.unpack('<i', vm2.read(a, 4))[0]
        cases.append({'kind': 'load', 'args': {'slot': slot},
                      'expected': {'result': r, 'blockEqualsFile': same, 'mode': seen2[-1]['mode'], 'mdi': vm2.mdi, 'bgm': vm2.bgm, 'sounds': vm2.sounds,
                                   'scene': vm2.u32(SCENE), 'selected': i32(BLOCK + 0x2D4), 'timeLimit': i32(BLOCK + 0x14),
                                   'help': vm2.read(HELP_TEXT, 40).split(b'\0')[0].decode('latin1')}})
    # 읽기 실패(목록을 만든 뒤 파일이 바뀜)와 빈 SAVE
    bad = bytearray(files[name(7)])
    bad[100] ^= 1
    vm3 = Booted(EXE)
    install_gdi(vm3)
    seen3 = []
    hook(vm3, {name(7): bytes(bad)}, {}, [7], seen3)
    cases.append({'kind': 'loadCorrupt', 'args': {'slot': 7}, 'expected': {'result': vm3.call(LOAD, 0x5555, limit=4_000_000_000), 'boxes': vm3.boxes, 'row': seen3[-1]['rows'][7]}})
    vm4 = Booted(EXE)
    install_gdi(vm4)
    seen4 = []
    hook(vm4, {}, {}, [None], seen4)
    cases.append({'kind': 'loadEmpty', 'args': {}, 'expected': {'result': vm4.call(LOAD, 0x5555, limit=4_000_000_000), 'rows': seen4[-1]['rows'], 'boxes': vm4.boxes}})
    write_fixture('gameData', SAVE, cases)


if __name__ == '__main__':
    main()
