"""마법 연출 정답 픽스처. 실행: pnpm oracle magic

공격 픽스처(gen_attack.py)와 같은 경로(CPU 결정 처리 0x406573 → 걷기 → 0x4067b1 → 0x406d13 → 연출 → 0x406045)로 마법(연출 번호 1~3)을 돌린다.
게임 픽스처의 마법 명령(그 앞 블록에서): 회복 22, 공격 마법 12·31, 물높이 10·11(특수 0x2b), Bless 13, 풀기 14·29, 직선 투사체 33.
게임에 없는 범위 마법은 게임 블록 차례 유닛이 쓸 수 있는 명령을 엔진(apply)으로 골라 만들었다: 상태 이상 15, 둘레 타격 20·28·30(빗나감 표시 0x413ddb),
회복 23·24. 차례를 받지 않은 네이티얼의 마법 21·25·26·27·32는 블록의 차례 네이티얼 종류를 바꿔 만든다.
상태 이상이 있는 시전자가 자기를 푸는 경우(풀기 14)는 블록의 차례 유닛 레코드에 상태 이상을 넣어 만든다(연출 끝 모습 0x412b50이 새 상태를 따르는지).
"""
import base64
import json
import os
import struct
import sys
import zlib

sys.path.insert(0, os.path.dirname(__file__))
from fixture import GOLDEN, write_fixture  # noqa: E402
from gen_attack import CPU_DECISION, make_case, patch_block  # noqa: E402
from original import read_original  # noqa: E402

GAME_COMMANDS = ((1, 15), (1, 31), (2, 0), (4, 7), (1, 29), (0, 13), (2, 29), (0, 4), (2, 16))
# (게임, 블록, 명령): 블록의 차례 유닛이 쓰는 명령
MADE = (
    (0, 16, {'to': [10, 17], 'direction': 4, 'kind': 1, 'number': 15, 'target': [11, 18]}),
    (4, 19, {'to': [14, 13], 'direction': 0, 'kind': 1, 'number': 20, 'target': [13, 12]}),
    (2, 13, {'to': [9, 7], 'direction': 3, 'kind': 1, 'number': 28, 'target': [9, 7]}),
    (2, 24, {'to': [12, 8], 'direction': 4, 'kind': 1, 'number': 30, 'target': [12, 8]}),
    (4, 22, {'to': [20, 13], 'direction': 2, 'kind': 1, 'number': 23, 'target': [20, 13]}),
    (1, 24, {'to': [7, 17], 'direction': 3, 'kind': 1, 'number': 24, 'target': [7, 17]}),
)
# 게임에서 차례를 받지 않은 네이티얼의 마법: 블록의 차례 네이티얼 종류를 바꿔(gen_attack.patch_block) 엔진이 받는 명령을 골랐다.
# Zenosblead 17 = 21, Ba-Mado 6 = 25, Zamilpen 10 = 26, Gia-Bro 4 = 27(포물선 효과 반경 1), Regna-Croxe 24 = 32(자기 둘레 반경 2)
RETYPED = (
    (0, 13, {'to': [13, 12], 'direction': 4, 'kind': 1, 'number': 21, 'target': [11, 18]}, ('type', 4, 17)),
    (0, 20, {'to': [11, 16], 'direction': 5, 'kind': 1, 'number': 25, 'target': [11, 17]}, ('type', 4, 6)),
    (0, 20, {'to': [11, 16], 'direction': 5, 'kind': 1, 'number': 26, 'target': [11, 17]}, ('type', 4, 10)),
    (0, 3, {'to': [13, 8], 'direction': 5, 'kind': 1, 'number': 27, 'target': [11, 5]}, ('type', 2, 4)),
    (0, 3, {'to': [13, 8], 'direction': 5, 'kind': 1, 'number': 32, 'target': [13, 8]}, ('type', 2, 24)),
)
# (게임, 블록, 명령, (유닛 칸, 상태 이상 비트, 남은 분)): 블록의 유닛 레코드(0x2e0 + 칸 × 0x24, +0x18 남은 분, +0x20 상태 이상)를 고친다
PATCHED = (
    (2, 28, {'to': [10, 7], 'direction': 1, 'kind': 1, 'number': 14, 'target': [10, 7]}, (0, 1, 5)),
    (0, 3, {'to': [13, 8], 'direction': 5, 'kind': 1, 'number': 29, 'target': [13, 8]}, (2, 1, 1)),
)


def patched(block: bytes, slot: int, status: int, minutes: int) -> bytes:
    b = bytearray(block)
    at = 0x2E0 + slot * 0x24
    struct.pack_into('<i', b, at + 0x18, minutes)
    struct.pack_into('<H', b, at + 0x20, status)
    return bytes(b)


def main() -> None:
    exe = read_original('vmv2.exe')
    with open(os.path.join(GOLDEN, 'games.json')) as f:
        games = json.load(f)['cases']
    block = lambda g, k: zlib.decompress(base64.b64decode(games[g]['expected']['blocks'][k] if k >= 0 else games[g]['expected']['first']))  # noqa: E731
    cases = []
    for g, k in GAME_COMMANDS:
        cases.append(make_case(exe, f'게임 {g} 명령 {k}', block(g, k - 1), games[g]['args']['map'], games[g]['args']['commands'][k]))
    for g, k, command in MADE:
        cases.append(make_case(exe, f'게임 {g} 블록 {k} 행동 {command["number"]}', block(g, k), games[g]['args']['map'], command))
    for g, k, command, (slot, status, minutes) in PATCHED:
        label = f'게임 {g} 블록 {k} 행동 {command["number"]}(유닛 {slot} 상태 이상 {status})'
        cases.append(make_case(exe, label, patched(block(g, k), slot, status, minutes), games[g]['args']['map'], command))
    for g, k, command, patch in RETYPED:
        cases.append(make_case(exe, f'게임 {g} 블록 {k} 행동 {command["number"]}(칸 {patch[1]} 종류 {patch[2]})', patch_block(block(g, k), patch), games[g]['args']['map'], command))
    write_fixture('magic', CPU_DECISION, cases)


if __name__ == '__main__':
    main()
