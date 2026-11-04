"""시나리오 흐름 정답 픽스처. 실행: pnpm oracle scenario_flow

- start: 0x450da0(모드 0 Easy·1 Normal을 *0x5061cc에)·0x450e35(Expert)를 부른 뒤의 블록(Master making 창 0x426d90은 대역)
- player: 0x42d190(마스터)로 우리 진영(진영 0)을 만든 뒤의 레코드(이름은 0x483efc에 넣은 글자)
- enemy: 맵을 읽고(0x4224a0) 0x42d2e9(1)로 적 진영을 만든 뒤의 레코드. 모드 0·1·2
- progress: 시작 블록에서 고른 맵(*0x5061e8)을 두고 0x45157b를 차례로 부른 뒤의 맵 플래그 52개, 돌려준 값, 진영 0 레코드
  (0x45157b 안의 0x42da93이 우리 마스터 레벨 + 1, 능력치, 맵 보상 네이티얼 0x42da6c를 넣는다)
- levelUp: Expert 블록에서 우리 진영(마스터, 레벨)을 두고 맵 37로 0x45157b를 부른 뒤의 진영 0 레코드. 0x42dae0은 평탄한 행 (마스터 × 40 + 레벨)을 읽어
  레벨 40부터는 다음 마스터의 행, 표(27명) 뒤는 exe의 다른 데이터다(깬 맵도 다시 고를 수 있어 레벨에 상한이 없다)
- stats: 0x41bcda·0x41bce9 뒤 0x408034가 하듯 0x41bd98(*0x476bd0, 진영 상태 0 +0xc − 2, 0x476bd0 + 4)를 두 번 부른 뒤 블록 +0xd78의 59칸
"""
import os
import random
import struct
import sys

sys.path.insert(0, os.path.dirname(__file__))
from battle import BLOCK, BLOCK_SIZE, SIDE_STATES, SIDES, encode_block, start_free_battle  # noqa: E402
from boot import Booted  # noqa: E402
from fixture import write_fixture  # noqa: E402
from original import read_original  # noqa: E402

START_SCENARIO = 0x450DA0
START_EXPERT = 0x450E35
MAKE_MASTER_WINDOW = 0x426D90
MODE = 0x5061CC           # → 블록 +0xc
SELECTED = 0x5061E8       # → 블록 +0x2d4
LOAD_MAP = 0x4224A0
PLAYER = 0x42D190         # (마스터)
ENEMY = 0x42D2E9          # (진영)
PROGRESS = 0x45157B
NAME = 0x483EFC
STATS_POINTER = 0x41BCDA
STATS_CLEAR = 0x41BCE9
STATS_ADD = 0x41BD98
BATTLE_STATS = 0x476BD0   # → 결과 창 통계 자리(첫 칸 + 진영마다 0x39칸)
SCENARIO_STATS = 0xD78


def boot(exe: bytes, mode: int) -> Booted:
    vm = Booted(exe)
    vm.stub_function(MAKE_MASTER_WINDOW, 0, lambda vm: 1)
    if mode == 2:
        vm.call(START_EXPERT)
    else:
        vm.set_u32(vm.u32(MODE), mode)
        vm.call(START_SCENARIO)
    return vm


def side(vm, n: int) -> str:
    return vm.read(vm.u32(SIDES) + n * 0xC0, 0xC0).hex()


def main() -> None:
    exe = read_original('vmv2.exe')
    cases = []
    for mode in (0, 1, 2):
        vm = boot(exe, mode)
        cases.append({'kind': 'start', 'args': {'mode': mode}, 'expected': {'block': encode_block(vm.read(BLOCK, BLOCK_SIZE))}})
    for mode in (0, 1, 2):
        for master in (0, 9, 26):
            vm = boot(exe, mode)
            vm.write(NAME, b'Floyd\0')
            vm.call(PLAYER, master)
            cases.append({'kind': 'player', 'args': {'mode': mode, 'master': master, 'name': 'Floyd'}, 'expected': {'side': side(vm, 0)}})
    for mode in (0, 1, 2):
        vm = boot(exe, mode)
        for m in range(38):
            assert vm.call(LOAD_MAP, m) == 1
            vm.call(ENEMY, 1)
            cases.append({'kind': 'enemy', 'args': {'mode': mode, 'map': m}, 'expected': {'side': side(vm, 1)}})
    sequences = {
        0: [0, 1, 2, 0, 3, 4, 5, 6, 8, 9, 10, 13, 14, 15, 18, 19, 20, 21, 22, 26, 27, 28, 29],
        1: [0, 1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29],
        2: [30, 31, 32, 33, 34, 35, 36, 37],
    }
    for mode, order in sequences.items():
        vm = boot(exe, mode)
        vm.write(NAME, b'Floyd\0')
        vm.call(PLAYER, 9)
        start = vm.read(BLOCK, BLOCK_SIZE)
        steps = []
        for m in order:
            vm.set_u32(vm.u32(SELECTED), m)
            scene = vm.call(PROGRESS)
            scene = scene - (1 << 32) if scene >= 1 << 31 else scene
            flags = list(struct.unpack('<52i', vm.read(BLOCK + 0x198, 52 * 4)))
            steps.append({'map': m, 'scene': scene, 'flags': flags, 'side': side(vm, 0)})
        cases.append({'kind': 'progress', 'args': {'mode': mode, 'start': encode_block(start)}, 'expected': {'steps': steps}})
    for master, level in ((9, 39), (0, 39), (26, 39), (26, 44), (13, 300)):
        vm = boot(exe, 2)
        vm.write(NAME, b'Floyd\0')
        vm.call(PLAYER, master)
        vm.set_u32(vm.u32(SIDES) + 0xA0, level)
        start = side(vm, 0)
        vm.set_u32(vm.u32(SELECTED), 37)
        vm.call(PROGRESS)
        cases.append({'kind': 'levelUp', 'args': {'mode': 2, 'side': start}, 'expected': {'side': side(vm, 0)}})
    vm = start_free_battle(exe, 3)
    vm.call(STATS_POINTER)
    vm.call(STATS_CLEAR)
    rng = random.Random(5)
    base = vm.u32(BATTLE_STATS)
    calls = []
    for _ in range(2):
        values = [rng.randrange(0, 300) for _ in range(1 + 2 * 0x39)]
        vm.write(base, struct.pack(f'<{len(values)}i', *values))
        vm.set_u32(vm.u32(SIDE_STATES) + 0xC, rng.randrange(2, 9))
        first, days = vm.u32(base), vm.u32(vm.u32(SIDE_STATES) + 0xC) - 2
        vm.call(STATS_ADD, first, days, base + 4)
        calls.append({'first': first, 'days': days, 'side': list(struct.unpack('<57i', vm.read(base + 4, 57 * 4)))})
    total = list(struct.unpack('<59i', vm.read(BLOCK + SCENARIO_STATS, 59 * 4)))
    cases.append({'kind': 'stats', 'args': {'calls': calls}, 'expected': {'total': total, 'block': encode_block(vm.read(BLOCK, BLOCK_SIZE))}})
    write_fixture('scenarioFlow', PROGRESS, cases)


if __name__ == '__main__':
    main()
