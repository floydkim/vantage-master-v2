"""차례 실행 정답 픽스처(판 단위: 이동·방향·대기·물리 공격·소환·되돌리기·승패). 실행: pnpm oracle turns

네트워크 대전이 받은 명령을 실행하는 경로(0x40672d → 이동 → 0x4067b1 → 0x406d13 → 연출 → 행동 뒤 흐름 0x40623b → 다음 차례 0x40536c)를
원작 그대로 돌린다. 명령은 u16 두 개(0x476b70: 이동할 x·y, 방향, 종류 / 0x476b72: 행동·네이티얼 번호, 대상 x·y)다.
시간 진행 픽스처처럼 준비한 전투에서 유닛을 8×8 영역에 모으고 첫 차례를 시작한 뒤, 판이 끝나거나(전투 끝 0x401ec3) TURNS 차례가 될 때까지
차례마다 명령을 난수로 고르고, 연출 대기열을 비우고(0x412f6d) 다음 처리기(0x476b2c)를 부르는 일을 입력 대기(0x40546d)까지 되풀이한다.
입력 대기 처리기는 블록 +0x2dc == 0이면 차례 시작 지형 효과(HP)를 주고, 어느 쪽이든 차례 시작 위치(0x476b40)를 저장하므로 한 번 부른다.
두 진영을 사람(제어 0)으로 두어 CPU 생각(0x445b20)을 막고, 자동 저장(0x442045, 파일 쓰기)과 전투 끝(0x401ec3, 결과 창)은 대역으로 둔다.
판마다 첫 블록과 명령 목록, 차례마다 뒤 블록을 담는다. 원작 실행 중 유닛 표는 사라진 네이티얼 칸을 비워 두고 소환이 다시 쓰므로(0x40f47e)
TS도 첫 블록부터 이어서 실행해야 같은 순서가 나온다. 첫 블록을 뜨기 전에 생긴 빈 칸(첫 시간 진행의 MP 부족 등)의 번호도 담는다. 마스터 차례에는 소환할 수 있는 칸(0x4127bb가 고르는 칸)도 담는다.
"""
import os
import struct
import sys

sys.path.insert(0, os.path.dirname(__file__))
from battle import (BLOCK, EFFECT_COUNT, SIDES, UNIT_COUNT, UPDATE_POSITION, encode_block, gather_units, hurts,  # noqa: E402
                    i32, packed_block, rebuild_terrain, refresh_stats, side_state, stoppable, unit)
from fixture import write_fixture  # noqa: E402
from gen_advance_time import prepare  # noqa: E402
from original import read_original  # noqa: E402

RUN_COMMAND = 0x40672D
BEGIN_TURN = 0x40536C
RUN_FRAME = 0x412F6D
MOVEMENT_RANGE = 0x4404C9
IN_RANGE = 0x41074B
NEAR = 0x410055          # (주체, x, y) 육각 거리 1이면 1
CAN_SUMMON_AT = 0x4126D7  # (주체, 종류, x, y) 멈출 수 있는 지형, 높이 차 ≤ 1, 빈 칸
CAN_TARGET = 0x410E3D    # (주체, 행동, 대상 유닛) 회복·풀기는 같은 진영, 그 밖은 다른 진영, 그리고 사거리
ACTIONS = 0x465908       # 행동 표(0x14바이트): +0 MP 비용, +6 종류, +8 범위 종류, +0x0a 효과 반경
STATUS_MINUTES = 0x411425  # (주체, 행동) 상태 이상 지속 시간
HANDLER = 0x476B2C       # 다음 프레임에 부를 처리기
ACTOR = 0x476B04
COMMAND = 0x476B70       # u16 두 개
WAIT_INPUT = 0x40546D
AUTOSAVE = 0x442045
END_BATTLE = 0x401EC3
EFFECTS = 0x47A3A8
NATIALS = 0x4749D8       # 네이티얼 표(0x58바이트, 종류 번호로): +0 소환 MP
SPRITE_CONVERT = 0x42325F  # 그림을 화면 DIB 형식으로 변환(그래픽 초기화를 대역으로 둬서 대상 DIB가 없음)
GAMES = 40
TURNS = 40


def active(vm) -> int:
    return sum(1 for i in range(vm.u32(EFFECT_COUNT)) if not vm.u32(EFFECTS + i * 0x7C + 0x28) & 0x80000000)


def pump(vm, ended: list) -> None:
    """연출을 끝까지 돌리고 다음 처리기를 부르는 일을, 입력 대기를 한 번 부른 뒤 그대로 입력 대기로 남을 때까지(또는 전투 끝까지) 되풀이한다."""
    for _ in range(500):
        for _ in range(5000):
            if not active(vm):
                break
            vm.call(RUN_FRAME, 1, 1)
        else:
            raise AssertionError('연출이 끝나지 않습니다')
        if ended:
            return
        handler = vm.u32(HANDLER)
        vm.call(handler)
        if handler == WAIT_INPUT and vm.u32(HANDLER) == WAIT_INPUT and not active(vm):
            return
    raise AssertionError('차례가 끝나지 않습니다')


def live(vm) -> list:
    return [i for i in range(vm.u32(UNIT_COUNT)) if not vm.u32(unit(i)) & 0x8000]


def summon_cells(vm, actor: int, kind: int) -> list:
    """0x4127bb와 같은 순서(y 바깥, x 안쪽)로 소환할 수 있는 칸"""
    return [[x, y] for y in range(32) for x in range(32)
            if vm.call(NEAR, actor, x, y) == 1 and vm.call(CAN_SUMMON_AT, actor, kind, x, y)]


def moved(vm, actor: int, cell, fn):
    """주체가 cell로 옮겨 간 뒤의 fn() 값(위치 객체를 잠깐 옮겼다 되돌린다)"""
    pos = vm.u32(actor + 0x68)
    saved = vm.read(pos, 0x14)
    vm.write(pos, bytes(cell))
    vm.call(UPDATE_POSITION, pos)
    try:
        return fn()
    finally:
        vm.write(pos, saved)


def natial_list(vm, side: int) -> list:
    at = vm.u32(SIDES) + side * 0xC0 + 0x38
    return [i32(vm, at + 4 + k * 4) for k in range(i32(vm, at))]


def action_byte(vm, action: int, offset: int) -> int:
    return vm.read(ACTIONS + action * 0x14 + offset, 1)[0]


def usable(vm, actor: int, index: int, side: int) -> list:
    """쓸 수 있는 행동: 자기 공격(유닛 +0x08)과 마법(마스터 진영 목록 +0x1c, 네이티얼 +0x0c·+0x10) 가운데 MP가 되는 것(0x405d18)"""
    acts = [vm.read(actor + 8, 1)[0]]
    if index < 2:
        at = vm.u32(SIDES) + side * 0xC0 + 0x1C
        acts += [i32(vm, at + 4 + k * 4) for k in range(i32(vm, at))]
    elif vm.u32(actor + 0xC):
        acts.append(i32(vm, actor + 0x10))
    mp = i32(vm, side_state(vm, side) + 4)
    return [a for a in acts if i32(vm, ACTIONS + a * 0x14) <= mp]


def targets(vm, actor: int, action: int) -> list:
    """원작 UI가 고르게 하는 대상 칸(y 바깥, x 안쪽): 범위 종류 4·5는 자기 칸(0x405d18), 효과 반경 0이면 0x410e3d를 통과한 유닛 칸,
    반경이 있으면 사거리(0x41074b) 안의 칸(상태 4, 0x40416f)"""
    x, y = vm.read(vm.u32(actor + 0x68), 2)
    if action_byte(vm, action, 8) in (4, 5):
        return [[x, y]]
    if action_byte(vm, action, 0xA) == 0:
        cells = [list(vm.read(vm.u32(unit(i) + 0x68), 2)) for i in live(vm) if vm.call(CAN_TARGET, actor, action, unit(i))]
        return sorted(cells, key=lambda c: (c[1], c[0]))
    return [[tx, ty] for ty in range(32) for tx in range(32) if vm.call(IN_RANGE, x, y, action, tx, ty) & 0xFF]


def choose(vm, rng, stats: dict):
    actor = vm.u32(ACTOR)
    index = (actor - 0x478E10) // 0x6C
    vm.call(MOVEMENT_RANGE, actor)
    work = vm.read(0x4C4BF0, 0x7C00)
    cells = [(work[c * 31], work[c * 31 + 1]) for c in range(1024) if work[c * 31 + 0x12] & 8]
    here = tuple(vm.read(vm.u32(actor + 0x68), 2))
    if index < 2 and rng.random() < 0.9:
        cells = [c for c in cells if not hurts(vm, *c)] or cells
    side = vm.read(actor + 4, 1)[0]
    direction = rng.randrange(6)
    # 명령 메뉴(0x40496f)는 선 칸이 멈출 수 없는 지형이면 공격·마법·소환을 끈다: 그때는 다른 칸으로 옮긴 뒤에만 고른다
    menu_cells = cells if stoppable(vm, vm.read(actor + 0x28, 1)[0], *here) else [c for c in cells if c != here]
    menu_ok = lambda c: c != here or stoppable(vm, vm.read(actor + 0x28, 1)[0], *here)
    if index < 2:
        own = [i for i in live(vm)[2:] if vm.read(unit(i) + 4, 1)[0] == side]
        if own and rng.random() < 0.15:  # 되돌리기: 마스터 차례에 이동하기 전 같은 진영 네이티얼(유닛 메뉴 0x404c02 → 0x405f13)
            stats['return'] += 1
            return {'to': list(here), 'direction': direction, 'kind': 3, 'number': 0, 'target': list(vm.read(vm.u32(unit(rng.choice(own)) + 0x68), 2))}
        mp = i32(vm, side_state(vm, side) + 4)
        affordable = [k for k in natial_list(vm, side) if i32(vm, NATIALS + k * 0x58) <= mp]
        if affordable and menu_cells and rng.random() < 0.4 and i32(vm, side_state(vm, side) + 8) < 25:
            to = here if rng.random() < 0.5 and menu_ok(here) else rng.choice(menu_cells)
            kind = rng.choice(affordable)
            spots = moved(vm, actor, to, lambda: summon_cells(vm, actor, kind))
            if spots:
                stats['summon'] += 1
                return {'to': list(to), 'direction': direction, 'kind': 2, 'number': kind, 'target': rng.choice(spots)}
    acts = usable(vm, actor, index, side)
    magic = [a for a in acts if a >= 10]
    action = rng.choice(magic) if magic and rng.random() < 0.6 else acts[0]
    occupied = {tuple(vm.read(vm.u32(unit(i) + 0x68), 2)) for i in live(vm)}
    for to in [rng.choice(menu_cells) for _ in range(6 if menu_cells else 0)] + ([here] if menu_ok(here) else []):
        spots = moved(vm, actor, to, lambda: targets(vm, actor, action))
        if spots and rng.random() < 0.9:
            busy = [c for c in spots if tuple(c) in occupied]
            kind = action_byte(vm, action, 6)
            minutes = {tuple(vm.read(vm.u32(unit(i) + 0x68), 2)): i32(vm, unit(i) + 0x50) for i in live(vm)}
            # 상태 이상(종류 2): 남은 분이 새 지속 시간보다 긴 대상(다시 걸리지 않는 갈래, 0x40354b)이 있으면 자주 그쪽을
            kept = [c for c in busy if kind == 2 and vm.call(STATUS_MINUTES, actor, action) < minutes[tuple(c)]]
            target = rng.choice(kept) if kept and rng.random() < 0.7 else rng.choice(busy) if busy and rng.random() < 0.8 else rng.choice(spots)
            stats['attack' if action < 10 else ('water', 'bless')[kind - 4] if kind >= 4 else 'spell' if index < 2 else 'natial magic'] += 1
            if target in kept:
                stats['status kept'] += 1
            return {'to': list(to), 'direction': direction, 'kind': 1, 'number': action, 'target': target}
    stats['stand'] += 1
    return {'to': list(rng.choice(cells)), 'direction': direction, 'kind': 0, 'number': 0, 'target': [0, 0]}


def run(vm, command, ended: list) -> None:
    a = command['to'][0] | command['to'][1] << 5 | command['direction'] << 10 | command['kind'] << 13
    b = command['number'] | command['target'][0] << 6 | command['target'][1] << 11
    vm.write(COMMAND, struct.pack('<HH', a, b))
    vm.call(RUN_COMMAND)
    pump(vm, ended)


def separate(vm) -> None:
    """준비 단계(무작위 칸 소환, gather_units가 옮기지 못한 유닛)에서 겹친 유닛을 가까운 빈 칸(멈출 수 있는 곳)으로 옮긴다. 실제 게임에서는 겹치지 않는다"""
    cells = {i: tuple(vm.read(vm.u32(unit(i) + 0x68), 2)) for i in live(vm)}
    seen = set()
    for i, c in cells.items():
        if c in seen:
            taken = set(cells.values())
            move_type = vm.read(unit(i) + 0x28, 1)[0]
            free = [(x, y) for y in range(32) for x in range(32) if (x, y) not in taken and stoppable(vm, move_type, x, y)]
            c = min(free, key=lambda f: (abs(f[0] - c[0]) + abs(f[1] - c[1]), f[1], f[0]))
            cells[i] = c
            pos = vm.u32(unit(i) + 0x68)
            vm.write(pos, bytes(c))
            vm.call(UPDATE_POSITION, pos)
        seen.add(c)


def winner(vm) -> int:
    """0x401ec3 앞부분: 진영 0 마스터가 쓰러졌으면 1(둘 다면 −1), 아니면 0"""
    fallen = [i32(vm, vm.u32(side_state(vm, s) + 0x14) + 0x30) <= 0 for s in (0, 1)]
    return -1 if all(fallen) else 1 if fallen[0] else 0


def make_game(exe: bytes, g: int, stats: dict) -> dict:
    vm, rng = prepare(exe, 9000 + g)
    rebuild_terrain(vm)
    gather_units(vm, rng)  # 싸움이 나도록
    separate(vm)
    vm.stub_function(SPRITE_CONVERT, 3, lambda vm, *args: 0)
    vm.stub_function(AUTOSAVE, 0, lambda vm: 0)
    ended = []
    vm.stub_function(END_BATTLE, 0, lambda vm: ended.append(1) or 0)
    for side in (0, 1):
        vm.set_u32(vm.u32(0x45E0EC) + side * 0x18, 0)  # 사람
    for i in live(vm)[2:]:  # 네이티얼 레벨·경험치(레벨 업과 경험치 100 넘김이 나도록)
        vm.write(unit(i) + 0x2C, struct.pack('<i', rng.randrange(3)))
        vm.write(unit(i) + 0x54, struct.pack('<i', rng.randrange(101)))
    if rng.random() < 0.3:  # 판이 끝나도록 마스터 HP를 낮춘다
        for m in (0, 1):
            vm.write(unit(m) + 0x30, struct.pack('<i', rng.randrange(1, 6)))
    taken = {tuple(vm.read(vm.u32(unit(i) + 0x68), 2)) for i in live(vm)}
    spots = [(x, y) for y in range(32) for x in range(32) if hurts(vm, x, y) and stoppable(vm, 1, x, y) and (x, y) not in taken]
    if spots and rng.random() < 0.6:  # 해로운 지형(종류 5)이 있는 맵이면 마스터 하나를 거기 두어 차례 시작에 쓰러져 끝나는 판(첫 차례는 아니게 OA를 크게)
        m = rng.randrange(2)
        pos = vm.u32(unit(m) + 0x68)
        vm.write(pos, bytes(rng.choice(spots)))
        vm.call(UPDATE_POSITION, pos)
        vm.write(unit(m) + 0x30, struct.pack('<i', rng.randrange(1, 4)))
        vm.write(unit(m) + 0x4C, struct.pack('<i', 300))
    for i in live(vm)[2:]:  # 남은 분이 긴 상태 이상(새 지속 시간이 더 짧으면 다시 걸리지 않는 갈래, 0x40354b)
        if rng.random() < 0.1:
            vm.write(unit(i) + 0x50, struct.pack('<i', rng.randrange(300, 700)))
            vm.write(unit(i) + 0x58, struct.pack('<H', rng.choice((1, 2, 4))))
    if rng.random() < 0.5:  # 마법을 쓰도록 MP를 채운다
        for side in (0, 1):
            vm.write(side_state(vm, side) + 4, vm.read(vm.u32(SIDES) + side * 0xC0 + 0xA4, 4))
    rebuild_terrain(vm)
    refresh_stats(vm)
    vm.set_u32(HANDLER, BEGIN_TURN)
    pump(vm, ended)
    assert not ended, '첫 차례 전에 전투가 끝났습니다'
    first = packed_block(vm)
    holes = [i for i in range(vm.u32(UNIT_COUNT)) if vm.u32(unit(i)) & 0x8000]  # 첫 블록 전에 이미 빈 칸(압축 블록에는 드러나지 않음)
    commands, blocks, checks, aims = [], [], [], []
    for turn in range(TURNS):
        actor = vm.u32(ACTOR)
        index = (actor - 0x478E10) // 0x6C
        side = vm.read(actor + 4, 1)[0]
        if index < 2:
            kind = rng.choice(natial_list(vm, side))
            checks.append({'turn': turn, 'type': kind, 'cells': summon_cells(vm, actor, kind)})
        acts = usable(vm, actor, index, side)
        if acts:
            action = rng.choice(acts)
            aims.append({'turn': turn, 'action': action, 'cells': targets(vm, actor, action)})
        command = choose(vm, rng, stats)
        count, alive = vm.u32(UNIT_COUNT), len(live(vm))
        run(vm, command, ended)
        if command['kind'] == 2 and vm.u32(UNIT_COUNT) == count and alive < count:
            stats['refill'] += 1
        commands.append(command)
        blocks.append(encode_block(packed_block(vm)))
        if ended:
            stats['ended'] += 1
            break
    return {'args': {'map': i32(vm, BLOCK + 0x2D4), 'block': encode_block(first), 'holes': holes, 'commands': commands},
            'expected': {'blocks': blocks, 'summonCells': checks, 'targets': aims, 'winner': winner(vm) if ended else None}}


def main() -> None:
    exe = read_original('vmv2.exe')
    stats = dict.fromkeys(('stand', 'attack', 'spell', 'natial magic', 'water', 'bless', 'status kept', 'summon', 'refill', 'return', 'ended'), 0)
    games = [make_game(exe, g, stats) for g in range(GAMES)]
    print(stats, sum(len(c['args']['commands']) for c in games), '차례')
    write_fixture('turns', RUN_COMMAND, games)


if __name__ == '__main__':
    main()
