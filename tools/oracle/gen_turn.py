"""차례 연출 정답 픽스처(행동 뒤 흐름과 다음 차례 시작까지). 실행: pnpm oracle turn

gen_attack처럼 CPU 결정 처리(0x406573)로 명령을 돌리되, 행동 연출 뒤 흐름(0x406045·0x4060b9 → 0x40623b: 마스터 소멸, 진영 네이티얼 소멸,
마정석 점령 0x41481d, 경험치·레벨업 0x4147f2)과 다음 차례 시작(0x40536c: 시간 진행·MP 부족 소멸 0x4022d7, 화면 이동)을 거쳐
다음 입력 시작(0x40546d) 또는 전투 끝(0x401ec3)이 불리는 틱까지 돌린다. 화면 이동 연출(0x4147b3 → 0x4165bb)은 창 스크롤 대역에서 끝나지 않으므로
처음 불릴 때 끝난 것으로 둔다(원작은 이동이 끝난 틱에 이어 한다). 화면 확인(0x406ad9)은 1, 효과음은 대역.
틱마다 표시 객체 풀, 타이머 카운터, 유닛 HP·경험치(+0x54)·레벨(+0x2c), DIB 색 표(바뀐 틱만), 10틱마다 전장 칩 줄 CRC32, 단계.
"""
import base64
import json
import os
import sys
import zlib

sys.path.insert(0, os.path.dirname(__file__))
from battle import encode_block, packed_block  # noqa: E402
from fixture import GOLDEN, write_fixture  # noqa: E402
from gen_attack import CPU_DECISION, SOUND_LOAD, SOUND_PLAY, UNIT_COUNT, UNITS, VISIBLE  # noqa: E402
from gen_screen import rows  # noqa: E402
from gen_walk import B20, BA8, CURSOR_FRAME, EFFECT_COUNT, EFFECTS, LOAD_UI_GRAPHICS, OPTIONS, PHASE, SET_PHASE, SOUND, TIMER, TURN_MARKER  # noqa: E402
from original import read_original  # noqa: E402
from screen import COMPOSE, SPRITE_COUNT, SPRITES, WATER_FRAME, draw_field, palette, resume_screen_battle  # noqa: E402

SCROLL = 0x4165BB           # 화면 이동 연출 처리기
INPUT_START = 0x40546D      # 다음 차례 입력 시작(화면 이동이 끝난 틱의 이어 하기)
END_BATTLE = 0x401EC3       # 전투 끝(결과 창)
SOUND_EXTRA = 0x443E38      # 효과음(경험치)
AUTOSAVE = 0x442045
# (게임, 명령): 대기 뒤 마정석 점령, 회복 뒤 점령, 소환 둘, 마스터 쓰러짐(전투 끝), 네이티얼 쓰러짐, 레벨업과 마스터 쓰러짐, 공격 뒤 경험치
GAME_COMMANDS = ((3, 3), (1, 15), (0, 0), (1, 2), (0, 28), (2, 18), (3, 111), (0, 12))
# (게임, 블록, 명령): 블록의 차례 유닛이 쓰는 명령 — 되돌리기(마스터가 이동 전에 아군 네이티얼을)
MADE = ((0, 1, {'to': [13, 7], 'direction': 5, 'kind': 3, 'number': 0, 'target': [13, 8]}),)


def make_case(exe: bytes, label: str, block: bytes, map_index: int, command: dict) -> dict:
    vm = resume_screen_battle(exe, block, map_index, OPTIONS)
    for fn, n in ((SOUND, 1), (SOUND_PLAY, 1), (SOUND_LOAD, 2), (SOUND_EXTRA, 1), (AUTOSAVE, 0)):
        vm.stub_function(fn, n, lambda vm, *a: 0)
    vm.stub_function(VISIBLE, 3, lambda vm, *a: 1)
    vm.stub_function(SCROLL, 1, lambda vm, e: vm.set_u32(e + 0x28, vm.u32(e + 0x28) | 0x80000000) or 0)
    stop = []
    vm.stub_function(INPUT_START, 0, lambda vm: stop.append('input') or 0)
    vm.stub_function(END_BATTLE, 0, lambda vm: stop.append('end') or 0)
    packed = encode_block(packed_block(vm))
    for i in range(vm.u32(EFFECT_COUNT)):
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
    while not stop:
        assert len(ticks) < 1500, '차례가 끝나지 않음'
        vm.call(TIMER, limit=4_000_000_000)
        dib = palette(vm)[40:246 * 4].hex()
        units = []
        for i in range(vm.u32(UNIT_COUNT)):
            at = UNITS + i * 0x6C
            gone = int.from_bytes(vm.read(at, 2), 'little') & 0x8000
            units.append(None if gone else [vm.u32(at + 0x30), vm.u32(at + 0x54), vm.u32(at + 0x2C)])
        t = {
            'pool': [vm.read(SPRITES + i * 0x16, 0x16).hex() for i in range(vm.u32(SPRITE_COUNT))],
            'b20': vm.u32(B20), 'ba8': vm.u32(BA8), 'cursorFrame': vm.u32(CURSOR_FRAME), 'water': vm.u32(WATER_FRAME),
            'units': units, 'phase': vm.u32(PHASE), 'dib': dib if dib != last else None,
        }
        last = dib
        if len(ticks) % 10 == 5 or stop:
            vm.call(COMPOSE, limit=2_000_000_000)
            t['field'] = rows(draw_field(vm))
        ticks.append(t)
    print(label, c, len(ticks), stop[0], flush=True)
    return {'label': label, 'map': map_index, 'block': packed, 'command': c, 'stop': stop[0], 'ticks': ticks}


def main() -> None:
    exe = read_original('vmv2.exe')
    with open(os.path.join(GOLDEN, 'games.json')) as f:
        games = json.load(f)['cases']
    block = lambda g, k: zlib.decompress(base64.b64decode(games[g]['expected']['blocks'][k] if k >= 0 else games[g]['expected']['first']))  # noqa: E731
    cases = []
    for g, k in GAME_COMMANDS:
        cases.append(make_case(exe, f'게임 {g} 명령 {k}', block(g, k - 1), games[g]['args']['map'], games[g]['args']['commands'][k]))
    for g, k, command in MADE:
        cases.append(make_case(exe, f'게임 {g} 블록 {k} 되돌리기', block(g, k), games[g]['args']['map'], command))
    write_fixture('turn', CPU_DECISION, cases)


if __name__ == '__main__':
    main()
