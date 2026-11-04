"""마스터 편집 대화 상자(0x7d)·이름 입력(0x86) 정답 픽스처. 실행: pnpm oracle master_edit

그래픽을 켠 프리 모드 월드(gen_world.boot)에서 맵 3을 고른 뒤, 대화 상자 API(CreateDialogParamA·컨트롤 메시지·Get/SetDlgItem*)를
가짜 컨트롤 저장소로 대역하고 대화 상자 처리기 0x41b690에 메시지를 넣는다(사용자 흉내). 해독 메모 notes_master_edit.md §14.
- session: 동작을 차례로 한 세션에서. 단계마다 효과음, 도움말 문구, 편집 객체 +0x28~+0x67, 대화 상자 컨트롤 글자·목록 선택,
  진영 레코드 둘, 그림 페이지 읽기(0x4227d5 인자), 마스터 정보 창 마우스 위(+0xc)와 다시 그렸으면 DIB 16줄 띠 CRC
- paint 단계: 초상 StretchBlt(대상·원본 사각형, 둘째 SRCPAINT 원본 = 0x10 → 0인 48 × 72 그림 CRC)
- position: GetCursorPos·GetWindowRect·GetSystemMetrics 대역 → 편집(0x42c4d6)·이름 입력(0x42c2a6)의 SetWindowPos 자리
"""
import os
import struct
import sys
import zlib

sys.path.insert(0, os.path.dirname(__file__))
from fixture import write_fixture  # noqa: E402
from gen_world import MASTER_INFO, MASTER_INFO_BITS, bands, boot  # noqa: E402
from screen import thiscall  # noqa: E402
from unicorn import UC_HOOK_CODE  # noqa: E402
from unicorn.x86_const import UC_X86_REG_ESP  # noqa: E402

SIDES = 0x45E0E8
PROC = 0x41B690       # 대화 상자 처리기(객체는 GWL 8)
DLG = 0x483EF8        # 열린 편집 객체
CLICK = 0x42BD5E      # 마스터 정보 WM_LBUTTONDOWN(x, y)
CLOSE_INFO = 0x42AEB6  # 마스터 정보 창 닫기(편집도 버림)
SELECT_MAP = 0x4514A2
HELP = 0x483D14
LIST = 0x579
LEVEL = 0x5DC
NAME_EDIT = 0x8FC


def cstr(vm, a, n=256):
    return vm.read(a, n).split(b'\0')[0]


class Session:
    def __init__(self):
        vm = self.vm = boot()
        vm.call(SELECT_MAP, 3, 0, limit=4_000_000_000)
        self.dialogs = {}
        self.longs = {}
        self.pending = []
        self.loads = []
        self.drawn = False
        self.blits = []
        self.positions = []
        self.next = 0x7000
        self.handles = {}
        self.rects = {}
        self.cursor = (300, 400)

        def stub(name, n, f):
            for full in [k for k in vm._api_names.values() if k.endswith('!' + name)]:
                vm.stub_api(full, n, f)
        stub('CreateDialogParamA', 5, self.create)
        stub('SetWindowLongA', 3, lambda vm, h, i, v: self.longs.__setitem__((h, i), v) or 0)
        stub('GetWindowLongA', 2, lambda vm, h, i: self.longs.get((h, i), 0))
        stub('GetDlgItem', 2, lambda vm, d, i: self.ctrl_handle(d, i))
        stub('SendDlgItemMessageA', 5, lambda vm, d, i, m, w, l: self.ctrl_msg(d, i, m, w, l))
        stub('SendMessageA', 4, self.send)
        stub('SetDlgItemInt', 4, self.set_int)
        stub('GetDlgItemInt', 4, lambda vm, d, i, ok, signed: self.get_int(d, i))
        stub('SetDlgItemTextA', 3, lambda vm, d, i, s: self.ctrl(d, i).__setitem__('text', cstr(vm, s).decode('latin1')) or 1)
        stub('GetDlgItemTextA', 4, self.get_text)
        stub('MapDialogRect', 2, self.map_rect)
        stub('BeginPaint', 2, lambda vm, h, ps: vm.write(ps, struct.pack('<Ii4i', 0x5100, 0, 0, 0, 1000, 1000)) or 0x5100)
        stub('StretchBlt', 11, self.stretch)
        stub('SetWindowPos', 7, lambda vm, h, a, x, y, cx, cy, f: self.positions.append([self.dialogs.get(h, {}).get('template'), signed(x), signed(y)]) or 1)
        stub('GetWindowRect', 2, lambda vm, h, out: vm.write(out, struct.pack('<4i', *self.rects.get(h, (0, 0, 1024, 768)))) or 1)
        stub('GetSystemMetrics', 1, lambda vm, i: {0: 1024, 1: 768}.get(i, 0))
        stub('GetCursorPos', 1, lambda vm, p: vm.write(p, struct.pack('<ii', *self.cursor)) or 1)
        for name, n in (('EnableWindow', 2), ('DestroyWindow', 1), ('InvalidateRect', 3), ('UpdateWindow', 1)):
            stub(name, n, lambda vm, *a: 1)
        vm.uc.hook_add(UC_HOOK_CODE, self.on_load, begin=0x4227D5, end=0x4227D5)
        vm.uc.hook_add(UC_HOOK_CODE, lambda *a: setattr(self, 'drawn', True), begin=0x42B5C2, end=0x42B5C2)

    def on_load(self, uc, addr, size, ud):
        self.loads.append(list(struct.unpack('<4i', bytes(uc.mem_read(uc.reg_read(UC_X86_REG_ESP) + 4, 16)))))

    def create(self, vm, hinst, template, parent, proc, param):
        h = self.next
        self.next += 0x100
        self.dialogs[h] = {'template': template, 'parent': parent, 'ctrls': {}}
        self.rects[h] = (0, 0, 407, 497) if template == 0x7D else (0, 0, 265, 175)
        self.pending.append((h, 0x110, 0, param))
        return h

    def ctrl(self, d, i):
        return self.dialogs[d]['ctrls'].setdefault(i, {'text': '', 'items': [], 'sel': -1, 'range': None})

    def ctrl_handle(self, d, i):
        if d not in self.dialogs:
            return 0x5555
        h = 0x60000000 | (d << 12) | i
        self.handles[h] = (d, i)
        return h

    def ctrl_msg(self, d, i, m, w, l):
        c = self.ctrl(d, i)
        if m == 0x180:  # LB_ADDSTRING
            c['items'].append(cstr(self.vm, l).decode('latin1'))
            return len(c['items']) - 1
        if m == 0x186:  # LB_SETCURSEL
            c['sel'] = w
            return w
        if m == 0x188:  # LB_GETCURSEL
            return c['sel'] & 0xFFFFFFFF
        if m == 0x465:  # UDM_SETRANGE MAKELONG(위, 아래)
            c['range'] = [l >> 16, l & 0xFFFF]
        return 0

    def send(self, vm, h, m, w, l):
        if h in self.handles:
            return self.ctrl_msg(*self.handles[h], m, w, l)
        if h in self.dialogs:
            self.pending.append((h, m, w, l))
            return 0
        if m == 0x220:  # WM_MDICREATE: 새 MDI 자식 hwnd
            self.next += 4
            return self.next
        return 0

    def set_int(self, vm, d, i, v, is_signed):
        self.ctrl(d, i)['text'] = str(signed(v) if is_signed else v)
        return 1

    def get_int(self, d, i):
        try:
            return int(self.ctrl(d, i)['text']) & 0xFFFFFFFF
        except ValueError:
            return 0

    def get_text(self, vm, d, i, buf, n):
        t = self.ctrl(d, i)['text'].encode('latin1')[:n - 1]
        vm.write(buf, t + b'\0')
        return len(t)

    def map_rect(self, vm, d, r):
        a = struct.unpack('<4i', vm.read(r, 16))
        f = lambda v, b, k: (v * b * 2 + k) // (2 * k)  # MulDiv(DLU, 기준, 4·8), 양수 반올림
        vm.write(r, struct.pack('<4i', f(a[0], 7, 4), f(a[1], 16, 8), f(a[2], 7, 4), f(a[3], 16, 8)))
        return 1

    def stretch(self, vm, dc, x, y, w, h, src, sx, sy, sw, sh, rop):
        dib = [v for v in vm.dibs.values() if v[1] == 0x30 and v[2] in (0x48, -0x48)][-1]
        self.blits.append({'dst': [x, y, w, h], 'src': [sx, sy, sw, sh], 'rop': rop, 'crc': zlib.crc32(vm.read(dib[0], 0x30 * 0x48))})
        return 1

    def pump(self):
        while self.pending:
            h, m, w, l = self.pending.pop(0)
            self.vm.call(PROC, h, m, w, l, limit=2_000_000_000)

    def command(self, h, wp, lp=0):
        self.pending.append((h, 0x111, wp, lp))
        self.pump()

    def latest(self, template):
        found = [h for h, v in self.dialogs.items() if v['template'] == template]
        return found[-1] if found else None

    def edit(self):
        o = self.vm.u32(DLG)
        if not o:
            return None
        i = lambda k: struct.unpack('<i', self.vm.read(o + k, 4))[0]
        return {'name': cstr(self.vm, o + 0x28, 20).decode('latin1'), 'standardName': i(0x3c), 'attackAction': self.vm.read(o + 0x40, 1)[0],
                'master': i(0x44), 'level': i(0x48), 'stats': [i(0x4c + 4 * k) for k in range(7)]}

    def record(self, s):
        vm = self.vm
        r = vm.u32(SIDES) + s * 0xC0
        i = lambda k: struct.unpack('<i', vm.read(r + k, 4))[0]
        return {'name': cstr(vm, r, 20).decode('latin1'), 'standardName': i(0x14), 'attackAction': vm.read(r + 0x18, 1)[0], 'spells': i(0x1c), 'natials': i(0x38),
                'master': i(0x9c), 'level': i(0xa0), 'stats': [i(0xa4 + 4 * k) for k in range(7)]}

    def poke(self, s, stats):
        r = self.vm.u32(SIDES) + s * 0xC0
        self.vm.write(r + 0xa4, struct.pack('<7i', *stats))


def signed(v):
    return v - (1 << 32) if v >> 31 else v


def run_session(s: Session, actions: list) -> list:
    vm = s.vm
    steps = []
    for a in actions:
        vm.sounds.clear()
        s.loads.clear()
        s.blits.clear()
        s.drawn = False
        d = s.latest(0x7D)
        kind = a[0]
        if kind == 'open':
            thiscall(vm, CLICK, vm.u32(MASTER_INFO), 50 if a[1] == 0 else 300, 50, limit=2_000_000_000)
            s.pump()
        elif kind == 'clickInfo':
            thiscall(vm, CLICK, vm.u32(MASTER_INFO), a[1], a[2], limit=2_000_000_000)
        elif kind == 'paint':
            s.pending.append((d, 0xF, 0, 0))
            s.pump()
        elif kind in ('select', 'double'):
            if kind == 'select':
                s.ctrl(d, LIST)['sel'] = a[1]
            s.command(d, ((1 if kind == 'select' else 2) << 16) | LIST, s.ctrl_handle(d, LIST))
        elif kind == 'level':
            s.ctrl(d, LEVEL)['text'] = a[1]
            s.command(d, (0x400 << 16) | LEVEL, s.ctrl_handle(d, LEVEL))
        elif kind == 'stat':
            s.ctrl(d, a[1])['text'] = a[2]
            s.command(d, (0x400 << 16) | a[1], s.ctrl_handle(d, a[1]))
        elif kind == 'editName':
            s.command(d, 0xBCF)
        elif kind in ('nameOk', 'nameCancel'):
            n = s.latest(0x86)
            s.ctrl(n, NAME_EDIT)['text'] = a[1]
            s.command(n, 1 if kind == 'nameOk' else 2)
        elif kind == 'standardName':
            s.command(d, 0xBD0)
        elif kind == 'ok':
            s.command(d, 1)
        elif kind == 'cancel':
            s.command(d, 2)
        elif kind == 'closeInfo':
            vm.call(CLOSE_INFO, limit=2_000_000_000)
        elif kind == 'selectMap':
            vm.call(SELECT_MAP, a[1], 0, limit=4_000_000_000)
        elif kind == 'poke':
            s.poke(a[1], a[2])
        d = s.latest(0x7D)
        e = s.edit()
        n = s.latest(0x86)
        name_open = n is not None and e is not None and vm.u32(vm.u32(DLG) + 0x20) != 0
        step = {'sounds': list(vm.sounds), 'help': cstr(vm, HELP, 400).decode('latin1'), 'edit': e, 'records': [s.record(0), s.record(1)], 'loads': list(s.loads)}
        if e is not None:
            c = s.dialogs[d]['ctrls']
            step['texts'] = {str(k): v['text'] for k, v in sorted(c.items()) if v['text']}
            step['list'] = c[LIST]['sel']
            if kind == 'open':
                step['items'] = c[LIST]['items']
                step['ranges'] = {str(k): v['range'] for k, v in sorted(c.items()) if v['range']}
        if name_open:
            step['nameText'] = s.ctrl(n, NAME_EDIT)['text']
        ms = vm.u32(MASTER_INFO)
        if ms:
            step['hover'] = signed(vm.u32(ms + 0xC))
            if s.drawn:
                step['bands'] = bands(vm.read(vm.u32(MASTER_INFO_BITS), 416 * 416), 416, 16)
        if s.blits:
            step['blits'] = s.blits[:]
        steps.append(step)
    return steps


MAIN = [
    ['open', 0], ['paint'], ['select', 5], ['paint'], ['select', 5], ['level', '30'], ['stat', 0x643, '20'], ['clickInfo', 300, 50],
    ['editName'], ['nameOk', ''], ['nameOk', 'A' * 17], ['nameOk', 'A&B' + 'C' * 13], ['select', 6], ['standardName'],
    ['editName'], ['nameCancel', 'Zzz'], ['stat', 0x5DD, '236'], ['stat', 0x648, '20'], ['ok'],
    ['open', 1], ['select', 20], ['cancel'],
    ['open', 1], ['select', 16], ['level', '40'], ['paint'], ['double'],
    ['poke', 1, [99, 1, 2, 3, 4, 5, 6]], ['open', 1], ['level', '1'], ['ok'],
    ['open', 0], ['editName'], ['nameOk', 'caf\xe9 \xb1x&&'], ['select', 22], ['ok'],
    ['open', 0], ['select', 3], ['editName'], ['closeInfo'], ['selectMap', 3],
    ['open', 0], ['select', 26], ['cancel'],
]
PORTRAITS = [a for m in (0, 5, 18, 22, 25) for side in (0, 1) for a in (['open', side], ['select', m], ['paint'], ['cancel'])]


def positions(s: Session) -> list:
    out = []
    vm = s.vm
    for cursor, main in (((300, 400), (0, 0, 1024, 768)), ((10, 10), (0, 0, 1024, 768)), ((1000, 700), (0, 0, 1024, 768)),
                         ((500, 120), (100, 50, 900, 700)), ((880, 690), (100, 50, 900, 700)), ((120, 60), (100, 50, 900, 700))):
        s.cursor = cursor
        s.rects[0] = main  # 주 창 0x504000(오라클은 hwnd 0)
        s.positions.clear()
        thiscall(vm, CLICK, vm.u32(MASTER_INFO), 50, 50, limit=2_000_000_000)
        s.pump()
        d = s.latest(0x7D)
        edit_at = s.positions[-1][1:]
        result = {'cursor': list(cursor), 'main': list(main), 'size': [407, 497], 'edit': edit_at, 'names': []}
        for parent in ((100, 200, 507, 697), (500, 30, 907, 527), (-50, 10, 357, 507), (700, 400, 1107, 897)):
            s.rects[d] = parent
            s.positions.clear()
            s.command(d, 0xBCF)
            result['names'].append({'parent': list(parent), 'size': [265, 175], 'at': s.positions[-1][1:]})
            s.command(s.latest(0x86), 2)
        s.command(d, 2)
        out.append(result)
    return out


def main() -> None:
    s = Session()
    cases = [{'kind': 'session', 'args': {'map': 3, 'actions': MAIN}, 'expected': {'steps': run_session(s, MAIN)}}]
    print('main', flush=True)
    cases.append({'kind': 'portraits', 'args': {'map': 3, 'actions': PORTRAITS}, 'expected': {'steps': run_session(s, PORTRAITS)}})
    print('portraits', flush=True)
    cases.append({'kind': 'positions', 'args': {}, 'expected': {'cases': positions(s)}})
    write_fixture('masterEdit', 0x42CE52, cases)


if __name__ == '__main__':
    main()
