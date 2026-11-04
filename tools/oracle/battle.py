"""오라클 전투 준비: 원작 프리 모드 메뉴(0x450ed7)와 새 전투 시작(0x4017a2)을 그대로 실행하고, 첫 차례 준비(0x401b12)에서는
시각 설정(0x40224d)만 실행해 첫 시간 진행 직전 상태를 만든다. 0x401b12의 나머지 단계는 창·메뉴(블록 +0x268~+0x2d3)와
그래픽만 바꾸고, 마지막 단계(0x40536c)가 첫 시간 진행이다. 대역으로 두는 함수는 모두 창·그래픽·AI 자료만 바꾼다(re/functions.md).
"""
import base64
import struct
import zlib

from boot import Booted

FREE_MODE_MENU = 0x450ED7  # 진영 설정(0x42d473), 진영 0 사람·1 CPU, 모드 셀, 맵 선택 플래그
START_BATTLE = 0x4017A2
MASTER_STATS = 0x42DAE0
LOAD_MAP = 0x4224A0
SET_TIME = 0x40224D
PACK_UNITS = 0x4071EA
SUMMON = 0x40F910          # (마스터 유닛, 네이티얼 종류, x, y) → 유닛
NATIAL_STATS = 0x40FE72    # (유닛, 밝기 또는 −1 = 지금 밝기)
WINDOW_SETUP = (0x4510CA, 0x4516F4)  # 0x45102d 안의 창 배치·DIB 생성
GRAPHICS = {  # 0x4017a2 안: 주소 → (인자 수, 반환 값)
    0x401A0C: (0, 1),  # 맵·배경·캐릭터 그림 읽기. 맵 읽기(0x4224a0)는 먼저 한다
    0x43B6C2: (0, 1),  # 그래픽 메모리 준비. 그 안의 0x43cb1f가 끝에 작업 격자를 다시 만든다(아래 REBUILD_GRID로 대신함)
    0x44C8C3: (1, 0),  # 맵별 AI 자료(0x4ead6c 등)
}
LOAD_AI = 0x44C8C3        # 맵별 AI 자료(DATA10 0xac + 맵 × 2)
REBUILD_GRID = 0x4071BD   # 작업 격자 = 원래 격자 + 물높이 + 마정석 소유
TERRAIN_GRAPH = 0x440210  # 이동 타입별 지형 그래프(0x49dfc0)
FIRST_TURN = 0x401B12
MAP_SELECTION = 0x5061E8
SIDES = 0x45E0E8         # → 0x4cc828
SIDE_STATES = 0x45E0EC   # → 0x4cd1fc
BLOCK = 0x4CC810
BLOCK_SIZE = 0xE6C
UNITS = 0x478E10         # 실행 중 유닛 표: 108바이트 × 최대 51
UNIT_SIZE = 0x6C
UNIT_COUNT = 0x47A398    # 쓴 칸 수(빈 칸 포함)
UPDATE_POSITION = 0x417542  # 위치 객체의 높이(+8)·화면 좌표를 칸에서 다시 구한다
WORK_GRID = 0x483560     # → 작업 격자 포인터가 든 전역
GRAPHS = 0x49DFC0        # 이동 타입 5개 × 0x7c00
EFFECT_COUNT = 0x47A3A4  # 연출 대기열 사용 칸 수(최대 64)
TURN_SCREEN = (  # 시간 진행·차례 진행 안의 화면 함수. 블록은 읽기만 한다
    0x43E578, 0x42E090, 0x43BB14, 0x42E186, 0x43B8A8, 0x43E2E0, 0x40D52E,  # 물이 돌아올 때 메시지·다시 그리기(0x4022d7)
    0x40D977, 0x403C8E, 0x40484B, 0x4147B3,  # 미니맵, 커서, 입력 상태, 차례 표시(0x40536c)
)


def start_free_battle(exe: bytes, map_index: int, masters=(0, 1), levels=(24, 24), ai: bool = False, edit=None) -> Booted:
    """ai가 참이면 맵별 AI 자료(0x44c8c3)를 대역으로 두지 않고 읽는다(CPU 생각 0x445b20을 부르는 픽스처).
    edit(vm)은 마스터를 정한 뒤 전투 시작 전에 블록을 고친다(월드 장면의 편집·토글·조종·시간 제한)"""
    vm = Booted(exe)
    for address in WINDOW_SETUP:
        vm.stub_function(address, 0, lambda vm: 0)
    vm.call(FREE_MODE_MENU)
    sides = vm.u32(SIDES)
    for side, (master, level) in enumerate(zip(masters, levels)):  # 마스터 선택 화면이 하는 일
        vm.set_u32(sides + side * 0xC0 + 0x9C, master)
        vm.set_u32(sides + side * 0xC0 + 0xA0, level)
        vm.call(MASTER_STATS, sides + side * 0xC0)
    if edit:
        edit(vm)
    vm.set_u32(vm.u32(MAP_SELECTION), map_index)  # 맵 선택 화면이 하는 일
    assert vm.call(LOAD_MAP, map_index) == 1
    for address, (nargs, result) in GRAPHICS.items():
        if not (ai and address == LOAD_AI):
            vm.stub_function(address, nargs, lambda vm, *args, result=result: result)
    first = []
    vm.stub_function(FIRST_TURN, 1, lambda vm, minute: first.append(minute) or 0)
    vm.call(START_BATTLE)
    assert len(first) == 1, '원작이 첫 차례 준비까지 가지 못했습니다'
    rebuild_terrain(vm)  # 원작은 0x43b6c2(대역) 안에서 작업 격자를 만든 뒤 0x440210으로 그래프를 만든다
    vm.stub_function(0x4029AB, 1, lambda vm, minute: 0)  # 시각에 따른 팔레트 계산(화면)
    vm.stub_function(0x402785, 0, lambda vm: 0)          # 화면 갱신
    vm.call(SET_TIME, first[0])
    return vm


RESTORE = 0x401899        # 중단 저장 되살리기: 그래픽, 마스터 0x40f696, 그래프, AI 자료 0x44c8c3, 네이티얼 0x40fc66, 창, 첫 차례 준비
RESTORE_SCREEN = (0x44EB07, 0x424C13, 0x41B08F, 0x424C2A, 0x417D5C)  # 레지스트리 System Flags, 창 이름 복사, 팔레트, 창 객체 둘


def restore_battle(exe: bytes, block: bytes) -> Booted:
    """상태 블록을 새 VM에 원작 되살리기(0x401899)로 올린다. 맵은 먼저 읽고(0x401a0c 대역), 첫 차례 준비(0x401b12)에서는 시각만 정한다."""
    vm = Booted(exe)
    for address in WINDOW_SETUP:
        vm.stub_function(address, 0, lambda vm: 0)
    vm.call(FREE_MODE_MENU)
    vm.write(BLOCK, block)
    map_index = struct.unpack_from('<i', block, 0x2D4)[0]
    vm.set_u32(vm.u32(MAP_SELECTION), map_index)
    assert vm.call(LOAD_MAP, map_index) == 1
    for address in (0x401A0C, 0x43B6C2) + RESTORE_SCREEN:
        vm.stub_function(address, 0, lambda vm: 1)
    first = []
    vm.stub_function(FIRST_TURN, 1, lambda vm, minute: first.append(minute) or 0)
    vm.call(RESTORE)
    assert len(first) == 1, '원작이 되살린 뒤 첫 차례 준비까지 가지 못했습니다'
    rebuild_terrain(vm)
    vm.stub_function(0x4029AB, 1, lambda vm, minute: 0)
    vm.stub_function(0x402785, 0, lambda vm: 0)
    vm.call(SET_TIME, first[0])
    return vm


def rebuild_terrain(vm) -> None:
    """작업 격자와 지형 그래프를 블록의 물높이·마정석 소유로 다시 만든다(블록은 바꾸지 않음)."""
    vm.call(REBUILD_GRID)
    vm.call(TERRAIN_GRAPH)


def refresh_stats(vm) -> None:
    """네이티얼 실행 중 능력치를 지금 레벨·밝기로 다시 계산한다(0x40fe72(유닛, −1)). 시각·레벨을 흔든 뒤 원작이 했을 계산."""
    for i in range(2, vm.u32(UNIT_COUNT)):
        if not vm.u32(unit(i)) & 0x8000:
            vm.call(NATIAL_STATS, unit(i), 0xFFFFFFFF)


def stoppable(vm, move_type: int, x: int, y: int) -> bool:
    """지형 그래프(0x440210)의 칸 플래그 2가 없으면 그 이동 타입이 멈출 수 있다"""
    return not vm.read(GRAPHS + move_type * 0x7C00 + (y * 32 + x) * 31 + 0x12, 1)[0] & 2


def hurts(vm, x: int, y: int) -> bool:
    """지형 종류 5: 차례 시작마다 HP −3(0x40546d). 마스터가 쓰러져 전투가 끝나지 않게 피한다"""
    part = vm.u32(vm.u32(0x483918)) + int.from_bytes(vm.read(vm.u32(vm.u32(WORK_GRID)) + (y * 32 + x) * 2, 2), 'little') * 100
    return vm.read(part + 0x62, 1)[0] == 5


def gather_units(vm, rng) -> None:
    """유닛을 무작위 8×8 영역의 멈출 수 있는 칸에 모은다(겹치지 않게, 마스터는 지형 종류 5를 피함). 지형 그래프가 있어야 한다"""
    cx, cy = rng.randrange(4, 24), rng.randrange(4, 24)
    free = [(cx + dx, cy + dy) for dx in range(8) for dy in range(8)]
    rng.shuffle(free)
    for i in range(vm.u32(UNIT_COUNT)):
        move_type = vm.read(unit(i) + 0x28, 1)[0]
        fits = [c for c in free if stoppable(vm, move_type, *c) and not (i < 2 and hurts(vm, *c))]
        if fits:
            free.remove(fits[0])
            vm.write(vm.u32(unit(i) + 0x68), bytes(fits[0]))
            vm.call(UPDATE_POSITION, vm.u32(unit(i) + 0x68))  # 위치 객체의 높이(+8)·화면 좌표


def quiet_screen(vm) -> None:
    """연출 대기열을 비우고(방어적 초기화: 전투 시작과 소환 0x40f910은 연출을 넣지 않는다) 화면 함수를 대역으로 둔다."""
    vm.set_u32(EFFECT_COUNT, 0)
    for address in TURN_SCREEN:
        vm.stub_function(address, 0, lambda vm: 0)


def unit(index: int) -> int:
    return UNITS + index * UNIT_SIZE


def side_state(vm, side: int) -> int:
    return vm.u32(SIDE_STATES) + side * 0x18


def i32(vm, address: int) -> int:
    return struct.unpack('<i', vm.read(address, 4))[0]


def set_i32(vm, address: int, value: int) -> None:
    vm.write(address, struct.pack('<i', value))


def packed_block(vm) -> bytes:
    """실행 중 유닛 표를 원작 압축(0x4071ea)으로 블록에 옮긴 뒤의 블록."""
    vm.call(PACK_UNITS)
    return vm.read(BLOCK, BLOCK_SIZE)


def encode_block(block: bytes) -> str:
    return base64.b64encode(zlib.compress(block, 9)).decode()
