"""프리 배틀 시작 상태 정답 픽스처. 실행: pnpm oracle battle_start

원작 프리 모드 메뉴와 새 전투 시작을 첫 시간 진행 직전까지 실행한 뒤(battle.py) 블록 전체를 담는다.
첫 시간 진행(0x40536c)은 계획 4의 차례 진행이 이어받는다.
뒤 경우들은 월드 장면에서 고친 진영(③b-4c-1)이다: 마스터 정보 창의 아이콘 토글(0x42d762), 조종(진영 상태 +0x00), 시간 제한(블록 +0x14),
편집 대화 상자가 넣는 이름·표준 이름 플래그(+0x14)·능력치 직접 값. 기대값에 사람 진영 하나일 때의 연장 포인터(0x476af0 → 블록 오프셋)도 담는다.
"""
import struct
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from battle import BLOCK, SIDES, SIDE_STATES, START_BATTLE, encode_block, packed_block, start_free_battle  # noqa: E402
from fixture import write_fixture  # noqa: E402
from original import read_original  # noqa: E402


def main() -> None:
    exe = read_original('vmv2.exe')
    cases = []
    for map_index in range(52):
        for masters, levels in (((0, 1), (24, 24)), ((map_index % 27, (map_index + 13) % 27), (map_index * 7 % 40, map_index * 11 % 40))):
            vm = start_free_battle(exe, map_index, masters, levels)
            cases.append({'args': {'map': map_index, 'masters': list(masters), 'levels': list(levels)},
                          'expected': {'block': encode_block(packed_block(vm))}})
    for edits in EDITED:
        vm = start_free_battle(exe, edits['map'], edits['masters'], edits['levels'], edit=lambda vm, e=edits: apply_edits(vm, e))
        extension = vm.u32(0x476AF0)
        cases.append({'args': {'map': edits['map'], 'masters': list(edits['masters']), 'levels': list(edits['levels']), 'edits': {k: v for k, v in edits.items() if k not in ('map', 'masters', 'levels')}},
                      'expected': {'block': encode_block(packed_block(vm)), 'extension': extension - BLOCK if extension else None}})
    write_fixture('battleStart', START_BATTLE, cases)


TOGGLE = 0x42D762          # (진영, 아이템 0~23 네이티얼 1~24, 24~29 마법 10~15): 있으면 빼고 없으면 오름차순으로 넣기
TIME_LIMIT = 0x5061D0      # → 블록 +0x14
EDITED = [
    {'map': 3, 'masters': (0, 1), 'levels': (24, 24)},
    {'map': 3, 'masters': (0, 1), 'levels': (24, 24), 'toggles': [[0, 4], [0, 0], [0, 4], [1, 26], [1, 24], [1, 25]]},
    {'map': 11, 'masters': (5, 9), 'levels': (30, 18), 'toggles': [[0, u] for u in range(24)] + [[1, u] for u in range(24, 30)]},
    {'map': 20, 'masters': (13, 2), 'levels': (10, 35), 'controllers': [1, 0], 'timeLimit': 1},
    {'map': 27, 'masters': (21, 7), 'levels': (39, 0), 'controllers': [0, 0], 'timeLimit': 0},
    {'map': 33, 'masters': (16, 26), 'levels': (24, 24), 'controllers': [1, 1], 'timeLimit': 2},
    {'map': 45, 'masters': (8, 19), 'levels': (20, 28), 'timeLimit': 3, 'stats': [[236, 20, 0, 20, 0, 20, 20], [0, 0, 20, 0, 20, 1, 1]]},
    {'map': 3, 'masters': (0, 1), 'levels': (24, 24), 'names': ['ABCDEFGHIJKLMNOP', '\u00a1\u00a1Name\u00ff'], 'standard': [0, 0]},
]


def apply_edits(vm, e: dict) -> None:
    sides = vm.u32(SIDES)
    for s, u in e.get('toggles', []):
        vm.call(TOGGLE, s, u)
    for s, c in enumerate(e.get('controllers', [])):
        vm.set_u32(vm.u32(SIDE_STATES) + s * 0x18, c)
    if 'timeLimit' in e:
        vm.set_u32(vm.u32(TIME_LIMIT), e['timeLimit'])
    for s, stats in enumerate(e.get('stats', [])):
        vm.write(sides + s * 0xC0 + 0xA4, struct.pack('<7i', *stats))
    for s, name in enumerate(e.get('names', [])):
        vm.write(sides + s * 0xC0, name.encode('latin1').ljust(20, b'\0'))
    for s, flag in enumerate(e.get('standard', [])):
        vm.set_u32(sides + s * 0xC0 + 0x14, flag)


if __name__ == '__main__':
    main()
