"""CPU 생각 정답 픽스처: 원작 생각(0x445b20)의 명령과 AI 기억. 실행: pnpm oracle ai_think [판 차례 수]

경우는 두 가지다. (1) CPU끼리 두는 프리 배틀(표준 4판, No Guard 2판)의 차례들. (2) 값을 흔든 상태(시간 진행 픽스처의 준비에
레벨·HP·예전 가중치·난수 상태를 더 흔듦)에서 주체를 바꿔 두 번 생각한 것. 사고 방식은 옵션 0x503ff0 비트 8(No Guard)로 정한다.

판마다 맵별 AI 자료를 읽고(0x44c8c3) 두 진영을 CPU로 둔다. 차례마다 생각 직전의 블록(빈 칸 목록 포함), 주체 칸, 난수 상태(0x475da0),
유닛 칸마다 가중치(+0x60·+0x64), AI 작업 버퍼(0x43ff60, 맵 AI 자료 크기만큼)의 SHA-256을 적고, 생각한 뒤의 메시지(0x406573에 넘긴 값)와
같은 기억을 적는다. 차례 진행은 check_ai_memory.py와 같다(연출·자동 저장은 대역).

원작은 AI 작업 버퍼 자리를 연출 그림 버퍼로도 쓴다(0x4226eb의 그림 페이지 710~). 생각과 생각 사이에 리소스 읽기(0x4222ef)가
그 자리에 푼 것을 차례마다 [리소스 번호, 버퍼 시작에서 떨어진 바이트, 압축 여부]로 적어 TS 시험이 같은 바이트를 덮어쓰게 한다.
"""
import hashlib
import os
import struct
import sys

from unicorn import UC_HOOK_CODE
from unicorn.x86_const import UC_X86_REG_ESP

sys.path.insert(0, os.path.dirname(__file__))
from battle import BLOCK, UNIT_COUNT, UNITS, UNIT_SIZE, encode_block, i32, packed_block, quiet_screen, rebuild_terrain, refresh_stats, set_i32, start_free_battle, unit  # noqa: E402
from check_ai_memory import SEED, command, harness, think  # noqa: E402
from fixture import write_fixture  # noqa: E402
from gen_advance_time import prepare  # noqa: E402
from gen_turns import ACTOR, BEGIN_TURN, HANDLER, pump, run  # noqa: E402
from original import read_original  # noqa: E402

THINK = 0x445B20
SCRATCH = 0x483F48       # → AI 작업 버퍼 = 이 값 + 0x43ec00
ARENA_SIZE = 0x320C8
READ_RESOURCE = 0x4222EF  # (리소스 번호, 받을 곳, 압축 여부)
NEAR = 0x200000           # 버퍼 앞쪽에 풀어도 길면 겹칠 수 있어 이만큼 앞부터 적는다
REFRESH_POSITIONS = 0x417BED
OPTIONS = 0x503FF0
NO_GUARD = 8
GAMES = (
    (3, (0, 1), (24, 24), 'standard'),
    (11, (5, 9), (30, 18), 'standard'),
    (27, (21, 7), (39, 0), 'standard'),
    (45, (8, 19), (20, 28), 'standard'),
    (17, (2, 14), (24, 24), 'noGuard'),
    (38, (11, 25), (35, 12), 'noGuard'),
)
TURNS = 60
SHAKEN = 150


def set_pattern(vm, pattern: str) -> None:
    v = vm.read(OPTIONS, 1)[0]
    vm.write(OPTIONS, bytes([v | NO_GUARD if pattern == 'noGuard' else v & ~NO_GUARD]))


def memory(vm) -> dict:
    count = vm.u32(UNIT_COUNT)
    weights = [None if vm.u32(unit(i)) & 0x8000 else [i32(vm, unit(i) + 0x60), i32(vm, unit(i) + 0x64)] for i in range(count)]
    arena = vm.read(vm.u32(SCRATCH) + 0x43EC00, ARENA_SIZE)
    return {'seed': vm.u32(SEED), 'weights': weights, 'arena': hashlib.sha256(arena).hexdigest()}


def make_game(exe: bytes, map_index: int, masters, levels, pattern: str, limit: int = TURNS) -> dict:
    said, ended = [], []
    vm = start_free_battle(exe, map_index, masters, levels, ai=True)
    quiet_screen(vm)
    harness(vm, said, ended)
    set_pattern(vm, pattern)
    base = vm.u32(SCRATCH) + 0x43EC00
    loads = []

    def on_read(uc, address, size, data):
        rid, dest, packed = struct.unpack('<III', uc.mem_read(uc.reg_read(UC_X86_REG_ESP) + 4, 12))
        if base - NEAR <= dest < base + ARENA_SIZE:
            loads.append([rid, dest - base, packed])

    vm.uc.hook_add(UC_HOOK_CODE, on_read, begin=READ_RESOURCE, end=READ_RESOURCE)
    vm.set_u32(HANDLER, BEGIN_TURN)
    pump(vm, ended)
    turns = []
    for _ in range(limit):
        count = vm.u32(UNIT_COUNT)
        holes = [i for i in range(count) if vm.u32(unit(i)) & 0x8000]
        block = packed_block(vm)
        actor = (vm.u32(ACTOR) - UNITS) // UNIT_SIZE
        before = memory(vm)
        before['loads'] = loads[:]
        loads.clear()
        message = think(vm, said)
        turns.append({'block': encode_block(block), 'holes': holes, 'actor': actor, 'before': before,
                      'message': [message & 0xFFFF, message >> 16], 'after': memory(vm)})
        if message >> 13 & 7 > 3:
            break
        run(vm, command(message), ended)
        if ended:
            break
    return {'args': {'map': map_index, 'pattern': pattern, 'masters': list(masters), 'levels': list(levels)}, 'expected': {'turns': turns}}


def make_shaken(exe: bytes, k: int) -> dict:
    vm, rng = prepare(exe, 30000 + k, ai=True)
    rebuild_terrain(vm)  # 준비는 물높이를 바꾼 뒤 작업 격자·지형 그래프를 다시 만들지 않는다(실제 게임은 다시 만듦)
    vm.call(REFRESH_POSITIONS)
    said, ended = [], []
    harness(vm, said, ended)
    pattern = 'noGuard' if k % 2 else 'standard'
    set_pattern(vm, pattern)
    count = vm.u32(UNIT_COUNT)
    for i in range(count):
        if i >= 2:
            set_i32(vm, unit(i) + 0x2C, rng.randrange(3))  # 레벨
        set_i32(vm, unit(i) + 0x30, rng.randrange(1, 11))  # HP
        if rng.random() < 0.5:  # 예전 생각이 남긴 가중치
            set_i32(vm, unit(i) + 0x60, rng.randrange(1, 40000))
            set_i32(vm, unit(i) + 0x64, rng.randrange(1, 40000))
    refresh_stats(vm)
    vm.set_u32(SEED, rng.getrandbits(32))
    turns = []
    for _ in range(2):
        live = [i for i in range(vm.u32(UNIT_COUNT)) if not vm.u32(unit(i)) & 0x8000]
        actor = rng.choice(live)
        vm.set_u32(ACTOR, unit(actor))
        holes = [i for i in range(vm.u32(UNIT_COUNT)) if vm.u32(unit(i)) & 0x8000]
        block = packed_block(vm)
        before = memory(vm)
        before['loads'] = []
        message = think(vm, said)
        turns.append({'block': encode_block(block), 'holes': holes, 'actor': actor, 'before': before,
                      'message': [message & 0xFFFF, message >> 16], 'after': memory(vm)})
    return {'args': {'map': i32(vm, BLOCK + 0x2D4), 'pattern': pattern}, 'expected': {'turns': turns}}


def main() -> None:
    exe = read_original('vmv2.exe')
    cases = []
    turns = int(sys.argv[1]) if len(sys.argv) > 1 else TURNS
    games = GAMES[:int(sys.argv[2])] if len(sys.argv) > 2 else GAMES
    shaken = int(sys.argv[3]) if len(sys.argv) > 3 else SHAKEN
    for g in games:
        cases.append(make_game(exe, *g, turns))
        print(f'판 {len(cases)}: {len(cases[-1]["expected"]["turns"])}차례', flush=True)
    for k in range(shaken):
        cases.append(make_shaken(exe, k))
    print(f'흔든 상태 {shaken}가지', flush=True)
    write_fixture('aiThink', THINK, cases)


if __name__ == '__main__':
    main()
