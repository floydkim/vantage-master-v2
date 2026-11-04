"""세이브 파일 인코딩·디코딩 정답 픽스처를 만든다. 실행: pnpm oracle save_file"""
import base64
import json
import os
import random
import sys

sys.path.insert(0, os.path.dirname(__file__))
from original import read_original  # noqa: E402
from vm import SCRATCH, Vm  # noqa: E402

ENCODE = 0x44147F  # vmv2.exe: (u8* block) 체크섬 기록 후 바이트 뒤섞기
DECODE = 0x441546  # vmv2.exe: (u8* block) → 체크섬 일치 여부(al)
SIZE = 0xE6C
OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'test', 'golden', 'saveFile.json')


def main() -> None:
    rng = random.Random(20261015)
    blocks = [bytes(SIZE), b'\xFF' * SIZE] + [rng.randbytes(SIZE) for _ in range(4)]
    exe = read_original('vmv2.exe')
    cases = []
    for plain in blocks:
        vm = Vm(exe)  # 경우마다 새 Vm: 앞 경우의 전역 상태가 섞이지 않게
        vm.write(SCRATCH, plain)
        vm.call(ENCODE, SCRATCH)
        encoded = vm.read(SCRATCH, SIZE)
        ok = vm.call(DECODE, SCRATCH) & 0xFF
        decoded = vm.read(SCRATCH, SIZE)
        assert ok == 1, '원작이 자기가 만든 세이브를 거부했습니다'
        cases.append({k: base64.b64encode(v).decode() for k, v in
                      {'plain': plain, 'encoded': encoded, 'decoded': decoded}.items()})
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w') as f:
        json.dump({'encode': hex(ENCODE), 'decode': hex(DECODE), 'cases': cases}, f, indent=1)
        f.write('\n')
    print(f'{os.path.normpath(OUT)}: {len(cases)}개')


if __name__ == '__main__':
    main()
