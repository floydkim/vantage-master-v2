"""System > Customize(0x44ee63, 대화 상자 0x7b)·Sound(0x443511, 0x79/0x7a) 정답 픽스처. 실행: pnpm oracle options

대화 상자(0x41bb7b = DialogBoxParamA)를 대역으로 두고, 처음 객체 값(라디오·체크)을 떠 둔 뒤 고른 값을 넣어 OK(1)·Cancel(2)을 돌려준다.
옵션 word 0x503ff0, BGM 장치 0x4cd688, 물 프레임 0x49de20과 부른 함수(하늘 처음 0x43d4b8, 물 다시 그림 0x43e2e0, 0x43e578,
BGM 멈춤 0x44380e, CD 닫기 0x443a95, 지금 곡 다시 0x44372e)를 기록한다. 해독 메모 notes_options.md §2·§3.
클릭 소리: 처리기 0x44edf1·0x4434b3에 WM_COMMAND id마다
"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from boot import Booted  # noqa: E402
from fixture import write_fixture  # noqa: E402
from original import read_original  # noqa: E402
from screen import thiscall  # noqa: E402
from unicorn.x86_const import UC_X86_REG_ECX  # noqa: E402
from vm import SCRATCH  # noqa: E402

OPT = 0x503FF0
SCENE = 0x503FC8
DIALOG = 0x41BB7B
WATER = 0x49DE20
DEVICE = 0x4CD688
GS_FILES = 0x4CD6A0
EXE = read_original('vmv2.exe')
OPTIONS = (0x77, 0x7F, 0x70, 0x76, 0x74, 0x72, 0x71, 0x73, 0x75, 0x78, 0x00, 0x02, 0x04, 0x05, 0x0F, 0x7E)


def make(record):
    vm = Booted(EXE)
    vm.log = []
    for addr, name, n in record:
        vm.stub_function(addr, n, (lambda nm: lambda vm_, *a: vm_.log.append(nm) or 0)(name))
    return vm


def u16(vm, a):
    return vm.u32(a) & 0xFFFF


def customize() -> list:
    rec = [(0x43D4B8, 'skyOff', 0), (0x43E2E0, 'waterRedraw', 0), (0x43E578, 'flush', 0), (0x443D19, 'sound', 1)]
    out = []
    for scene in (3, 4):
        for opt in OPTIONS:
            for pick in [None] + [[p, a] for p in (0, 1) for a in range(4)]:
                vm = make(rec)
                vm.set_u32(OPT, (vm.u32(OPT) & 0xFFFF0000) | opt)
                vm.set_u32(SCENE, scene)
                vm.set_u32(WATER, 2)
                seen = {}

                def dialog(vm_, pick=pick, seen=seen):
                    this = vm_.uc.reg_read(UC_X86_REG_ECX)
                    seen['init'] = [vm_.u32(this + 0x24), vm_.u32(this + 0x28), vm_.u32(this + 0x2C)]
                    seen['template'] = u16(vm_, this + 0x18)
                    if pick is None:
                        return 2
                    vm_.set_u32(this + 0x24, pick[0])
                    vm_.set_u32(this + 0x28, pick[1])
                    return 1
                vm.stub_function(DIALOG, 0, dialog)
                vm.call(0x44EE63)
                out.append({'kind': 'customize', 'args': {'options': opt, 'scene': scene, 'pick': pick},
                            'expected': {'template': seen['template'], 'initial': seen['init'], 'options': u16(vm, OPT), 'calls': vm.log, 'water': vm.u32(WATER)}})
    return out


def sound() -> list:
    rec = [(0x44380E, 'stop', 0), (0x443A95, 'closeCd', 0), (0x44372E, 'apply', 0), (0x443D19, 'sound', 1)]
    out = []
    for gs in (0, 1):
        for opt in (0x77, 0x67, 0x57, 0x47):
            for dev in (0, 1, 2):
                for pick in (None, [1, 1, dev], [0, 1, dev], [1, 0, dev], [0, 0, dev], [1, 1, (dev + 1) % 4]):
                    vm = make(rec)
                    vm.set_u32(OPT, (vm.u32(OPT) & 0xFFFF0000) | opt)
                    vm.set_u32(GS_FILES, gs)
                    vm.set_u32(DEVICE, dev)
                    seen = {}

                    def dialog(vm_, pick=pick, seen=seen):
                        this = vm_.uc.reg_read(UC_X86_REG_ECX)
                        seen['init'] = [vm_.u32(this + o) for o in (0x28, 0x2C, 0x30)]
                        seen['template'] = u16(vm_, this + 0x18)
                        if pick is None:
                            return 2
                        for o, v in zip((0x28, 0x2C, 0x30), pick):
                            vm_.set_u32(this + o, v)
                        return 1
                    vm.stub_function(DIALOG, 0, dialog)
                    vm.call(0x443511)
                    out.append({'kind': 'sound', 'args': {'gs': gs, 'options': opt, 'device': dev, 'pick': pick},
                                'expected': {'template': seen['template'], 'initial': seen['init'], 'options': u16(vm, OPT), 'device': vm.u32(DEVICE), 'calls': vm.log}})
    return out


def clicks() -> list:
    vm = make([(0x443D19, 'sound', 1), (0x41BA4D, 'base', 3)])
    obj = SCRATCH + 0x200000
    vm.write(obj, bytes(0x40))
    sounds = {}
    for handler, ids in ((0x44EDF1, (1, 2, 0x95F, 0x960, 0x961, 0x962, 0x963, 0x964, 0xBC0, 0xBC1, 0xBC2, 0xBC3)), (0x4434B3, (1, 2, 0x9C3, 0x9C4, 0x9C5, 0x9C6, 0x9C7, 0x9C8, 0x9C9, 0x9CA))):
        for cid in ids:
            vm.log.clear()
            thiscall(vm, handler, obj, 0x111, cid)
            sounds[f'{handler:#x} {cid:#x}'] = [4] * vm.log.count('sound')
    return [{'kind': 'clicks', 'args': {}, 'expected': {'sounds': sounds}}]


def main() -> None:
    cases = customize() + sound() + clicks()
    write_fixture('options', 0x44EE63, cases)


if __name__ == '__main__':
    main()
