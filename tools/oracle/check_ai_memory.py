"""CPU 생각이 상태 블록과 AI 기억만으로 정해지는지 확인한다. 실행: sh tools/oracle/py.sh tools/oracle/check_ai_memory.py [차례 수]

AI 기억 = C 런타임 난수 상태(0x475da0), 유닛 AI 가중치(+0x60·+0x64), AI 작업 버퍼(0x43ff60이 주는 곳, 앞 0x11000바이트: 분석 격자,
후보 목록, 방향별 버퍼. 생각마다 일부만 새로 쓰고 나머지는 이전 생각의 값을 읽는다. 전투 시작·되살리기 때는 맵 AI 자료 파일 내용).
CPU끼리 두는 프리 배틀(맵별 AI 자료를 읽음)에서 차례마다, 이어서 둔 VM의 생각(0x445b20 → 0x406573에 넘긴 메시지)과 같은 블록을 새 VM에
되살린 뒤(0x401899) AI 기억을 옮겨 생각한 결과를 비교한다(대기의 번호·대상 칸은 이전 생각이 남긴 값이라 비교하지 않음). 난수 상태만 옮겼을 때
갈라진 차례 수도 함께 센다. 다르면 블록과 AI 기억 밖의 기억이 있는 것이다.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from battle import UNIT_COUNT, packed_block, quiet_screen, restore_battle, start_free_battle, unit  # noqa: E402
from gen_turns import ACTOR, AUTOSAVE, BEGIN_TURN, END_BATTLE, HANDLER, SPRITE_CONVERT, pump, run  # noqa: E402
from original import read_original  # noqa: E402

THINK = 0x445B20
RECEIVE = 0x406573
SEED = 0x475DA0
SCRATCH = 0x483F48       # → AI 작업 버퍼 = 이 값 + 0x43ec00(0x43ff60)
SCRATCH_SIZE = 0x11000
GAMES = ((3, (0, 1), (24, 24)), (11, (5, 9), (30, 18)), (27, (21, 7), (39, 0)), (45, (8, 19), (20, 28)))


def harness(vm, said: list, ended: list) -> None:
    vm.stub_function(SPRITE_CONVERT, 3, lambda vm, *args: 0)
    vm.stub_function(AUTOSAVE, 0, lambda vm: 0)
    vm.stub_function(END_BATTLE, 0, lambda vm: ended.append(1) or 0)
    vm.stub_function(RECEIVE, 1, lambda vm, message: said.append(message) or 0)
    for side in (0, 1):
        vm.set_u32(vm.u32(0x45E0EC) + side * 0x18, 0)  # 차례 진행 중에는 사람(생각은 아래에서 직접)


def think(vm, said: list) -> int:
    actor = vm.u32(ACTOR)
    side = vm.read(actor + 4, 1)[0]
    vm.set_u32(vm.u32(0x45E0EC) + side * 0x18, 1)
    vm.call(THINK, actor, limit=4_000_000_000)
    vm.set_u32(vm.u32(0x45E0EC) + side * 0x18, 0)
    return said.pop()


def command(message: int) -> dict:
    a, b = message & 0xFFFF, message >> 16
    return {'to': [a & 31, a >> 5 & 31], 'direction': a >> 10 & 7, 'kind': a >> 13, 'number': b & 63, 'target': [b >> 6 & 31, b >> 11 & 31]}


def memory(vm) -> tuple:
    count = vm.u32(UNIT_COUNT)
    return (vm.u32(SEED), [vm.read(unit(i) + 0x60, 8) for i in range(count)], vm.read(vm.u32(SCRATCH) + 0x43EC00, SCRATCH_SIZE))


def same(a: int, b: int) -> bool:
    return a == b or (a >> 13 & 7 == 0 and a & 0xFFFF == b & 0xFFFF)  # 대기는 번호·대상을 쓰지 않는다


def main() -> None:
    exe = read_original('vmv2.exe')
    turns = int(sys.argv[1]) if len(sys.argv) > 1 else 40
    total = differ = seed_only = 0
    for g, (map_index, masters, levels) in enumerate(GAMES):
        said, ended = [], []
        vm = start_free_battle(exe, map_index, masters, levels, ai=True)
        quiet_screen(vm)
        harness(vm, said, ended)
        vm.set_u32(HANDLER, BEGIN_TURN)
        pump(vm, ended)
        for t in range(turns):
            block, held = packed_block(vm), memory(vm)
            cells = [tuple(vm.read(vm.u32(unit(i) + 0x68), 2)) if not vm.u32(unit(i)) & 0x8000 else None for i in range(vm.u32(UNIT_COUNT))]
            message = think(vm, said)
            results = []
            for full in (False, True):
                other = restore_battle(exe, block)
                quiet_screen(other)
                said2, ended2 = [], []
                harness(other, said2, ended2)
                other.set_u32(HANDLER, BEGIN_TURN)
                pump(other, ended2)
                other.set_u32(SEED, held[0])
                if full:
                    other.write(other.u32(SCRATCH) + 0x43EC00, held[2])
                    for i in range(other.u32(UNIT_COUNT)):  # 되살린 표는 빈 칸이 없으므로 같은 칸에 선 유닛끼리 가중치를 옮긴다
                        cell = tuple(other.read(other.u32(unit(i) + 0x68), 2))
                        if cell in cells:
                            other.write(unit(i) + 0x60, held[1][cells.index(cell)])
                results.append(think(other, said2))
            total += 1
            if not same(message, results[0]):
                seed_only += 1
            if not same(message, results[1]):
                differ += 1
                print(f'판 {g} 차례 {t}: 이어서 {command(message)} ≠ 되살려서 {command(results[1])}', flush=True)
            if message >> 13 & 7 > 3:
                print(f'판 {g} 차례 {t}: 종류 {message >> 13 & 7} 메시지 {command(message)}', flush=True)
                break
            run(vm, command(message), ended)
            if ended:
                break
        print(f'판 {g}: {t + 1}차례, 누적 {total}차례 중 다름 {differ}(난수 상태만 옮기면 다름 {seed_only})', flush=True)
    print('같음' if differ == 0 else f'다름 {differ}/{total}')


if __name__ == '__main__':
    main()
