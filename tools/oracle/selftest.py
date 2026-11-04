"""오라클 하네스 자체 점검. 실행: pnpm oracle-check"""
import hashlib
import os
import struct
import sys

sys.path.insert(0, os.path.dirname(__file__))
from original import read_original  # noqa: E402
from unicorn.x86_const import UC_X86_REG_ECX, UC_X86_REG_EFLAGS  # noqa: E402
from boot import Booted  # noqa: E402
from vm import SCRATCH, ApiCall, OracleFault, Vm  # noqa: E402

LB_DECOMPRESS = 0x44C970  # vmv2.exe: (u8** dst, u8** src) → 풀린 바이트 수
OPEN_DATA_FILE = 0x422288  # vmv2.exe: 경로를 만들고 CreateFileA를 부른다
RESTORE_NATIAL = 0x40FC66  # vmv2.exe: 맵 포인터(0x48391c)가 비어 있으면 0x40227a에서 널 포인터를 읽는다
LOAD_MAP = 0x4224A0        # vmv2.exe: (맵 번호) 파일·메모리 API 대역과 정적 초기화가 있어야 돈다
MAP_CELL = 0x48391C
MOJI_SHA256 = '1d14bd59fe5151df068954fe675729ad8f6975594000b01f7a69613096150491'  # TS lbDecompress 결과


def decompress(vm: Vm, src: bytes, limit: int | None = None) -> bytes:
    src_at, dst_at, cells = SCRATCH, SCRATCH + 0x400000, SCRATCH + 0x800000
    vm.write(src_at, src)
    vm.set_u32(cells, dst_at)
    vm.set_u32(cells + 4, src_at)
    size = vm.call(LB_DECOMPRESS, cells, cells + 4, **({'limit': limit} if limit else {}))
    return vm.read(dst_at, size)


def main() -> None:
    vm = Vm(read_original('vmv2.exe'))
    dat = read_original('DATA00.DAT')
    start, end = struct.unpack_from('<II', dat, 16)
    moji = decompress(vm, dat[start:end])
    assert hashlib.sha256(moji).hexdigest() == MOJI_SHA256, '원작 압축 해제 결과가 TS 구현과 다릅니다'

    try:
        vm.call(OPEN_DATA_FILE, SCRATCH)
        raise AssertionError('API 호출을 잡지 못했습니다')
    except ApiCall as e:
        assert 'CreateFileA' in str(e), str(e)

    try:
        decompress(Vm(read_original('vmv2.exe')), dat[start:end], limit=100)
        raise AssertionError('명령 수 상한을 넘겨도 멈추지 않았습니다')
    except RuntimeError as e:
        assert '돌아오지 않았습니다' in str(e), str(e)

    try:
        Vm(read_original('vmv2.exe')).call(RESTORE_NATIAL, SCRATCH)
        raise AssertionError('매핑되지 않은 메모리 접근을 잡지 못했습니다')
    except OracleFault as e:
        assert '읽기' in str(e) and '주소 0x0 ' in str(e) and 'eip=0x40227a' in str(e), str(e)

    # 앞선 호출이나 바깥에서 남긴 레지스터가 다음 호출로 새지 않는다
    gadgets = SCRATCH + 0xF00000
    vm.write(gadgets, b'\x8B\xC1\xC3')       # mov eax, ecx; ret
    vm.write(gadgets + 4, b'\x9C\x58\xC3')   # pushfd; pop eax; ret
    vm.uc.reg_write(UC_X86_REG_ECX, 0x1234)
    assert vm.call(gadgets) == 0, '이전 ECX가 다음 호출로 넘어갔습니다'
    vm.uc.reg_write(UC_X86_REG_EFLAGS, 0x8D7)
    assert vm.call(gadgets + 4) & 0xFFF == 0x002, '이전 EFLAGS가 다음 호출로 넘어갔습니다'

    # x87 제어 워드는 Windows 스레드 시작 값(0x27F: 53비트 정밀도, 반올림)이어야 한다.
    # 0이면 원작 _ftol이 제어 워드를 다시 실은 뒤 계산이 24비트로 떨어진다
    fpu = Vm(read_original('vmv2.exe'))
    fpu.write(gadgets + 8, b'\xD9\x3D' + struct.pack('<I', gadgets + 0x100) + b'\xC3')  # fnstcw [gadgets+0x100]; ret
    fpu.call(gadgets + 8)
    control_word = struct.unpack('<H', fpu.read(gadgets + 0x100, 2))[0]
    assert control_word == 0x27F, f'x87 제어 워드가 {control_word:#x}입니다(0x27f여야 함)'

    # 부팅: API·할당 대역, C++ 정적 초기화, 메모리 덩어리를 갖추면 원작 맵 로드가 그대로 돈다
    booted = Booted(read_original('vmv2.exe'))
    assert booted.call(LOAD_MAP, 0) == 1, '원작이 맵 0을 읽지 못했습니다'
    assert booted.read(booted.u32(booted.u32(MAP_CELL)), 12) == b'Silent Hill\0'

    # CPU 예외는 원인을 한국어로 알린다
    for code, word in ((b'\x31\xC9\xF7\xF1\xC3', '0으로 나누기'), (b'\x0F\x0B\xC3', '잘못된 명령')):  # div ecx(0), ud2
        cpu = Vm(read_original('vmv2.exe'))
        cpu.write(gadgets + 0x20, code)
        try:
            cpu.call(gadgets + 0x20)
            raise AssertionError(f'{word}를 잡지 못했습니다')
        except OracleFault as e:
            assert word in str(e), str(e)

    # FS 설명자: 확장-업 읽기·쓰기 데이터(접근 바이트 0xF2, DPL 3)
    assert booted.read(0x7FFE0000 + 24 + 5, 1)[0] & 0xFE == 0xF2, 'FS 설명자 접근 바이트가 0xF2가 아닙니다'  # 0x01은 CPU가 세우는 접근됨 비트

    # 섹션 마지막 페이지의 VirtualSize 뒤 바이트는 Windows 로더처럼 파일에서 온다(.text: 0x59883 ~ 0x5a000)
    exe = read_original('vmv2.exe')
    assert booted.read(0x401000 + 0x59883, 0x5A000 - 0x59883) == exe[0x1000 + 0x59883:0x1000 + 0x5A000], '섹션 꼬리가 파일 바이트와 다릅니다'

    # 할당·파일 대역: 크기 0 할당도 서로 다른 주소, 쓰지 않던 대역도 제대로 돈다
    api = {name.split('!')[1]: at for at, name in booted._api_names.items()}
    a, b = booted.call(0x45498D, 0), booted.call(0x45498D, 0)        # malloc(0) 두 번
    assert a != b, '크기 0 할당이 같은 주소를 돌려줍니다'
    p = booted.call(api['HeapAlloc'], 0, 0, 16)
    booted.write(p, b'0123456789abcdef')
    q = booted.call(api['HeapReAlloc'], 0, 0, p, 32)
    assert booted.read(q, 16) == b'0123456789abcdef' and booted.call(api['HeapSize'], 0, 0, q) == 32
    assert booted.call(api['HeapFree'], 0, 0, q) == 1 and booted.call(api['GlobalUnlock'], 0) == 1 and booted.call(api['GlobalFree'], 0) == 0
    assert booted.call(0x454A01, a) == 0 and booted.call(0x45299E, b) == 0  # free, operator delete
    booted.write(SCRATCH, b'C:\\VMO_WIN\\MIDI\\CR000GM.MID\0')
    assert booted.call(api['CreateFileA'], SCRATCH, 0x80000000, 0, 0, 3, 0, 0) != 0xFFFFFFFF, '하위 폴더 파일을 열지 못했습니다'
    booted.write(SCRATCH, b'C:\\OTHER\\DATA00.DAT\0')
    try:
        booted.call(api['CreateFileA'], SCRATCH, 0x80000000, 0, 0, 3, 0, 0)
        raise AssertionError('게임 폴더 밖 경로를 열었습니다')
    except RuntimeError as e:
        assert '게임 폴더 밖' in str(e), str(e)

    print('오라클 하네스 자체 점검 통과')


if __name__ == '__main__':
    main()
