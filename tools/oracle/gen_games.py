"""프리 배틀 한 판을 처음부터 승패까지 실행한 정답 픽스처. 실행: pnpm oracle games

원작 프리 모드 메뉴와 새 전투 시작(battle.py start_free_battle, 값을 흔들지 않음) 뒤 첫 차례 진행(0x40536c)부터, 두 진영 모두 사람으로 두고
명령을 받는 경로(gen_turns.py와 같음)로 승패가 날 때까지 차례를 실행한다. 명령은 원작 함수(이동 범위 0x4404c9, 소환 칸 0x4127bb,
대상 0x410e3d·0x41074b)로 고르며, 적 마스터 쪽으로 몰아붙여 판이 끝나게 한다. 판마다 첫 입력 대기 블록과 명령 목록, 차례마다 뒤 블록, 승자를 담는다.
TS는 블록이 아니라 startFreeBattle(같은 맵·마스터·레벨)에서 시작해 이어서 실행한다.
"""
import os
import random
import struct
import sys

sys.path.insert(0, os.path.dirname(__file__))
from battle import encode_block, i32, packed_block, quiet_screen, side_state, start_free_battle, stoppable, unit  # noqa: E402
from fixture import write_fixture  # noqa: E402
from gen_turns import (ACTOR, AUTOSAVE, BEGIN_TURN, END_BATTLE, HANDLER, MOVEMENT_RANGE, NATIALS, RUN_COMMAND,  # noqa: E402
                       SPRITE_CONVERT, action_byte, live, moved, natial_list, pump, run, summon_cells, targets, usable, winner)
from original import read_original  # noqa: E402

HEX_DISTANCE = 0x40FFCD
GAMES = ((3, (0, 1), (24, 24)), (11, (5, 9), (30, 18)), (20, (13, 2), (10, 35)), (27, (21, 7), (39, 0)), (33, (16, 26), (24, 24)), (45, (8, 19), (20, 28)))
MAX_TURNS = 400


def distance(vm, a, b) -> int:
    return vm.call(HEX_DISTANCE, a[0], a[1], b[0], b[1])


def choose(vm, rng, stats: dict):
    """적 마스터 쪽으로 몰아붙이는 명령: 마스터는 MP가 되면 소환, 공격·마법은 적 마스터 > 적 유닛 순으로, 없으면 적 마스터에 가까운 칸으로 가서 대기"""
    actor = vm.u32(ACTOR)
    index = (actor - 0x478E10) // 0x6C
    side = vm.read(actor + 4, 1)[0]
    here = tuple(vm.read(vm.u32(actor + 0x68), 2))
    goal = tuple(vm.read(vm.u32(unit(1 - side) + 0x68), 2))
    vm.call(MOVEMENT_RANGE, actor)
    work = vm.read(0x4C4BF0, 0x7C00)
    cells = [(work[c * 31], work[c * 31 + 1]) for c in range(1024) if work[c * 31 + 0x12] & 8]
    near = sorted(cells, key=lambda c: (distance(vm, c, goal), c[1], c[0]))
    direction = rng.randrange(6)
    if not stoppable(vm, vm.read(actor + 0x28, 1)[0], *here):  # 명령 메뉴(0x40496f)가 공격·마법·소환을 끄는 칸: 옮겨 가서 대기
        return {'to': list(near[0]), 'direction': direction, 'kind': 0, 'number': 0, 'target': [0, 0]}
    if index < 2:
        mp = i32(vm, side_state(vm, side) + 4)
        affordable = [k for k in natial_list(vm, side) if i32(vm, NATIALS + k * 0x58) <= mp]
        if affordable and rng.random() < 0.5 and i32(vm, side_state(vm, side) + 8) < 25:
            kind = rng.choice(affordable)
            spots = summon_cells(vm, actor, kind)
            if spots:
                stats['summon'] += 1
                spot = min(spots, key=lambda c: distance(vm, c, goal))
                return {'to': list(here), 'direction': direction, 'kind': 2, 'number': kind, 'target': spot}
    enemies = {tuple(vm.read(vm.u32(unit(i) + 0x68), 2)): i for i in live(vm) if vm.read(unit(i) + 4, 1)[0] != side}
    acts = usable(vm, actor, index, side)
    magic = [a for a in acts if a >= 10]
    order = [rng.choice(magic), acts[0]] if magic and rng.random() < 0.4 else [acts[0]]
    for action in order:
        area = action_byte(vm, action, 8) not in (4, 5) and action_byte(vm, action, 0xA) != 0
        best = None
        for to in near[:3 if area else 12] + [here]:
            spots = [tuple(c) for c in moved(vm, actor, to, lambda: targets(vm, actor, action))]
            hit = [c for c in spots if c in enemies]
            if action_byte(vm, action, 6) in (1, 3, 4, 5) and spots:  # 회복·풀기·물높이·Bless는 아무 대상이나
                hit = spots
            score = 2 if goal in hit else 1 if hit else 0
            if score and (best is None or score > best[0]):
                best = (score, to, goal if goal in hit else rng.choice(hit))
            if score == 2:
                break
        if best:
            stats['master hit' if best[0] == 2 else 'attack' if action < 10 else 'magic'] += 1
            return {'to': list(best[1]), 'direction': direction, 'kind': 1, 'number': action, 'target': list(best[2])}
    stats['advance'] += 1
    return {'to': list(near[0]), 'direction': direction, 'kind': 0, 'number': 0, 'target': [0, 0]}


def make_game(exe: bytes, g: int, stats: dict) -> dict:
    map_index, masters, levels = GAMES[g]
    rng = random.Random(7000 + g)
    vm = start_free_battle(exe, map_index, masters, levels)
    quiet_screen(vm)
    vm.stub_function(SPRITE_CONVERT, 3, lambda vm, *args: 0)
    vm.stub_function(AUTOSAVE, 0, lambda vm: 0)
    ended = []
    vm.stub_function(END_BATTLE, 0, lambda vm: ended.append(1) or 0)
    for side in (0, 1):
        vm.set_u32(vm.u32(0x45E0EC) + side * 0x18, 0)  # 사람
    vm.set_u32(HANDLER, BEGIN_TURN)
    pump(vm, ended)
    first = packed_block(vm)
    commands, blocks = [], []
    for _ in range(MAX_TURNS):
        command = choose(vm, rng, stats)
        run(vm, command, ended)
        commands.append(command)
        blocks.append(encode_block(packed_block(vm)))
        if ended:
            break
    assert ended, f'판 {g}가 {MAX_TURNS}차례 안에 끝나지 않았습니다'
    stats['turns'] += len(commands)
    return {'args': {'map': map_index, 'masters': list(masters), 'levels': list(levels), 'commands': commands},
            'expected': {'first': encode_block(first), 'blocks': blocks, 'winner': winner(vm)}}


def main() -> None:
    exe = read_original('vmv2.exe')
    stats = dict.fromkeys(('summon', 'master hit', 'attack', 'magic', 'advance', 'turns'), 0)
    games = [make_game(exe, g, stats) for g in range(len(GAMES))]
    print(stats, [len(c['args']['commands']) for c in games], [c['expected']['winner'] for c in games])
    write_fixture('games', RUN_COMMAND, games)


if __name__ == '__main__':
    main()
