"""공격 연출 정답 픽스처. 실행: pnpm oracle attack

게임 픽스처의 공격 명령(행동 0~9, 연출 번호 0)을 그 앞 블록(블록 k는 명령 k 뒤)에서 애니메이션 옵션 0x07로 되살리고, CPU 차례처럼
표식 그림(0x422f9a)·차례 표식(0x40574a)·단계 0을 둔 뒤 CPU 결정 처리(0x406573, 명령 메시지)로 돌린다: 걷기 → 0x4067b1 → 0x406d13 → 공격 연출.
화면 확인(0x406ad9)은 1(보임), 효과음은 대역. 행동 뒤 흐름(0x406045)이 불리면 멈춘다.
틱마다 표시 객체 풀, 타이머 카운터, 유닛 HP(유닛 표 칸마다, 빈 칸 null), DIB 색 표 10~245번(바뀐 틱만), 10틱마다 전장 칩 줄 CRC32.
경우마다 타격 0x40354b 호출: [틱, x, y, 새로 계산, 몫 타격, 몫 n].
"""
import base64
import json
import os
import struct
import sys
import zlib

from unicorn import UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_ESP

sys.path.insert(0, os.path.dirname(__file__))
from battle import encode_block, packed_block  # noqa: E402
from fixture import GOLDEN, write_fixture  # noqa: E402
from gen_screen import rows  # noqa: E402
from gen_walk import B20, BA8, CURSOR_FRAME, EFFECT_COUNT, EFFECTS, LOAD_UI_GRAPHICS, OPTIONS, SET_PHASE, SOUND, TIMER, TURN_MARKER  # noqa: E402
from original import read_original  # noqa: E402
from screen import COMPOSE, SPRITE_COUNT, SPRITES, WATER_FRAME, draw_field, palette, resume_screen_battle  # noqa: E402

CPU_DECISION = 0x406573
VISIBLE = 0x406AD9
AFTER_ACT = 0x406045
STRIKE = 0x40354B
SOUND_PLAY = 0x443F4B       # (번호) 스크립트 효과음
SOUND_LOAD = 0x443F0A       # (번호, 칸) 효과음 미리 읽기
UNITS, UNIT_COUNT = 0x478E10, 0x47A398
# (게임, 명령): 근접, 근접 쓰러짐 둘, 마스터 쓰러짐(몫 + 나머지), 투사체 2·4·8, 투사체 6 쓰러짐, 팔레트 번쩍임(스크립트 0x2a) 둘
CASES = ((0, 12), (2, 18), (2, 25), (0, 28), (0, 16), (3, 61), (3, 35), (1, 22), (2, 20), (4, 13))
# 게임에서 차례를 받지 않은 공격: 블록(명령 k 뒤)의 차례 유닛을 고쳐 엔진(apply)이 받는 명령을 골랐다.
# ('type', 칸, 종류): 유닛 레코드 +6 종류(네이티얼 Tarbss 9 = 공격 3, Amoltamiss 21 = 공격 5, 마스터는 마스터 번호).
# 공격 7은 마스터 6의 것: 진영 0을 마스터 6으로('master': 진영 레코드 +0x9c, 'attack': +0x18, 마스터 유닛 종류). 공격만 바꾸면 원작 연출이 마스터 0 그림에서 없는 칸을 읽는다
PATCHED = (
    (2, 24, {'to': [12, 8], 'direction': 4, 'kind': 1, 'number': 3, 'target': [11, 7]}, (('type', 2, 9),)),
    (0, 13, {'to': [13, 12], 'direction': 4, 'kind': 1, 'number': 5, 'target': [11, 18]}, (('type', 4, 21),)),
    (0, 11, {'to': [12, 12], 'direction': 4, 'kind': 1, 'number': 7, 'target': [11, 18]}, (('master', 0, 6), ('attack', 0, 7), ('type', 0, 6))),
)


def patch_block(block: bytes, patch: tuple) -> bytes:
    """('type', 칸, 종류): 유닛 레코드(0x2e0 + 칸 × 0x24) +6 u16. 진영 레코드(0x18 + 진영 × 0xc0): ('attack', 진영, 행동) +0x18 u8, ('master', 진영, 번호) +0x9c i32"""
    b = bytearray(block)
    kind, n, value = patch
    if kind == 'type':
        struct.pack_into('<H', b, 0x2E0 + n * 0x24 + 6, value)
    elif kind == 'attack':
        b[0x18 + n * 0xC0 + 0x18] = value
    else:
        struct.pack_into('<i', b, 0x18 + n * 0xC0 + 0x9C, value)
    return bytes(b)


def make_case(exe: bytes, label: str, block: bytes, map_index: int, command: dict) -> dict:
    vm = resume_screen_battle(exe, block, map_index, OPTIONS)
    for fn, n in ((SOUND, 1), (SOUND_PLAY, 1), (SOUND_LOAD, 2)):
        vm.stub_function(fn, n, lambda vm, *a: 0)
    vm.stub_function(VISIBLE, 3, lambda vm, *a: 1)
    done = []
    vm.stub_function(AFTER_ACT, 0, lambda vm: done.append(1) or 0)
    strikes = []
    tick = [0]

    def on_strike(uc, addr, size, user):
        args = [vm.u32(uc.reg_read(UC_X86_REG_ESP) + 4 * (i + 1)) for i in range(6)]
        strikes.append([tick[0], args[0], args[1], args[2], args[3], args[5]])

    vm.uc.hook_add(UC_HOOK_CODE, on_strike, begin=STRIKE, end=STRIKE)
    packed = encode_block(packed_block(vm))
    for i in range(vm.u32(EFFECT_COUNT)):  # 차례 시작 화면 이동은 끝난 것으로(gen_walk)
        vm.set_u32(EFFECTS + i * 0x7C + 0x28, vm.u32(EFFECTS + i * 0x7C + 0x28) | 0x80000000)
    vm.set_u32(EFFECT_COUNT, 0)
    vm.call(LOAD_UI_GRAPHICS, limit=2_000_000_000)
    vm.call(TURN_MARKER, limit=2_000_000_000)
    vm.call(SET_PHASE, 0, limit=2_000_000_000)
    c = command
    a = c['to'][0] | c['to'][1] << 5 | c['direction'] << 10 | c['kind'] << 13
    b = c['number'] | c['target'][0] << 6 | c['target'][1] << 11
    vm.call(CPU_DECISION, a | b << 16, limit=2_000_000_000)
    ticks = []
    last = None
    while not done:
        assert len(ticks) < 600, '연출이 끝나지 않음'
        tick[0] = len(ticks)
        vm.call(TIMER, limit=2_000_000_000)
        dib = palette(vm)[40:246 * 4].hex()
        hp = [None if int.from_bytes(vm.read(UNITS + i * 0x6C, 2), 'little') & 0x8000 else int.from_bytes(vm.read(UNITS + i * 0x6C + 0x30, 4), 'little', signed=True) for i in range(vm.u32(UNIT_COUNT))]
        t = {
            'pool': [vm.read(SPRITES + i * 0x16, 0x16).hex() for i in range(vm.u32(SPRITE_COUNT))],
            'b20': vm.u32(B20), 'ba8': vm.u32(BA8), 'cursorFrame': vm.u32(CURSOR_FRAME), 'water': vm.u32(WATER_FRAME),
            'hp': hp, 'dib': dib if dib != last else None,
        }
        last = dib
        if len(ticks) % 10 == 5:
            vm.call(COMPOSE, limit=2_000_000_000)
            t['field'] = rows(draw_field(vm))
        ticks.append(t)
    print(label, c, len(ticks), 'strikes', strikes, flush=True)
    return {'label': label, 'map': map_index, 'block': packed, 'command': c, 'strikes': strikes, 'ticks': ticks}


def main() -> None:
    exe = read_original('vmv2.exe')
    with open(os.path.join(GOLDEN, 'games.json')) as f:
        games = json.load(f)['cases']
    cases = []
    for g, k in CASES:
        game = games[g]
        before = game['expected']['blocks'][k - 1] if k else game['expected']['first']  # 블록 k는 명령 k 뒤
        cases.append(make_case(exe, f'게임 {g} 명령 {k}', zlib.decompress(base64.b64decode(before)), game['args']['map'], game['args']['commands'][k]))
    for g, k, command, patches in PATCHED:
        block = zlib.decompress(base64.b64decode(games[g]['expected']['blocks'][k]))
        for patch in patches:
            block = patch_block(block, patch)
        label = ', '.join(f'{p[0]} {p[1]} = {p[2]}' for p in patches)
        cases.append(make_case(exe, f'게임 {g} 블록 {k} 공격 {command["number"]}({label})', block, games[g]['args']['map'], command))
    write_fixture('attack', CPU_DECISION, cases)


if __name__ == '__main__':
    main()
