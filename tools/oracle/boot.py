"""원작 규칙 함수를 부를 수 있게 오라클 Vm을 준비한다(WinMain의 창·그래픽 준비, C 초기화 표, FPU 초기화는 건너뛴다).

필요한 Windows API와 C 런타임 할당 함수만 대역으로 바꾸고, C++ 정적 초기화 표를 실행해 포인터 전역을 채운 뒤,
게임이 쓰는 7.3MB 메모리 덩어리(0x42dc10)를 잡는다. 파일은 original/VMO_WIN에서 읽기 전용으로 연다.
"""
import os
import struct

from original import ROOT
from unicorn import UC_PROT_ALL
from vm import Vm

HEAP, HEAP_SIZE = 0x30000000, 0x02000000      # operator new·malloc·HeapAlloc 대역 영역
GLOBAL, GLOBAL_SIZE = 0x40000000, 0x01000000  # GlobalAlloc 대역 영역(7.3MB 덩어리)
CPP_INITIALIZERS = (0x45E000, 0x45E0A4)       # vmv2.exe C++ 정적 초기화 표(0x45580c가 실행)
ALLOCATE_ARENA = 0x42DC10                     # vmv2.exe: GlobalAlloc으로 덩어리를 잡고 구역 포인터 전역을 채운다
GAME_FOLDER = 0x503EA8                        # vmv2.exe: 게임 폴더 문자열(0x422288이 파일 이름 앞에 붙인다)
INVALID_HANDLE = 0xFFFFFFFF
GENERIC_WRITE = 0x40000000


class Booted(Vm):
    """대역을 갖추고 정적 초기화·메모리 덩어리까지 마친 Vm. 경우마다 새로 만든다."""

    def __init__(self, exe: bytes):
        super().__init__(exe)
        self.uc.mem_map(HEAP, HEAP_SIZE, UC_PROT_ALL)
        self.uc.mem_map(GLOBAL, GLOBAL_SIZE, UC_PROT_ALL)
        self._heap_next, self._global_next = HEAP, GLOBAL
        self._sizes = {}
        self._files = {}
        self._install_stubs()
        for at in range(*CPP_INITIALIZERS, 4):
            initializer = self.u32(at)
            if initializer:
                self.call(initializer)
        if self.call(ALLOCATE_ARENA) != 1:
            raise RuntimeError('원작이 메모리 덩어리를 잡지 못했습니다(0x42dc10)')
        self.write(GAME_FOLDER, b'C:\\VMO_WIN\0')

    def _install_stubs(self) -> None:
        kernel = 'KERNEL32.dll!'
        for name, nargs, handler in (
            ('CreateFileA', 7, self._create_file),
            ('SetFilePointer', 4, self._set_file_pointer),
            ('ReadFile', 5, self._read_file),
            ('CloseHandle', 1, lambda vm, handle: self._files.pop(handle).close() or 1),
            ('GlobalAlloc', 2, lambda vm, flags, size: self._bump('global', size)),
            ('GlobalLock', 1, lambda vm, handle: handle),
            ('GlobalUnlock', 1, lambda vm, handle: 1),
            ('GlobalFree', 1, lambda vm, handle: 0),
            ('HeapAlloc', 3, lambda vm, heap, flags, size: self._bump('heap', size)),
            ('HeapReAlloc', 4, self._heap_realloc),
            ('HeapFree', 3, lambda vm, heap, flags, at: 1),
            ('HeapSize', 3, lambda vm, heap, flags, at: self._sizes[at]),
        ):
            self.stub_api(kernel + name, nargs, handler)
        for address in (0x452990, 0x45498D):  # operator new, malloc
            self.stub_function(address, 1, lambda vm, size: self._bump('heap', size))
        for address in (0x45299E, 0x454A01):  # operator delete, free: 대역 힙은 돌려받지 않는다
            self.stub_function(address, 1, lambda vm, at: 0)
        # atexit: 정적 객체의 소멸자를 종료 때 부르려고 등록한다. 오라클은 종료하지 않으므로 등록만 성공시킨다
        self.stub_function(0x453558, 1, lambda vm, function: 0)

    def _bump(self, kind: str, size: int) -> int:
        """ponytail: 해제하지 않는 범프 할당. 경우마다 새 Vm을 만들므로 충분하다. 크기 0도 서로 다른 주소를 준다."""
        size = max(size, 1)
        if kind == 'heap':
            at, self._heap_next = self._heap_next, self._heap_next + ((size + 15) & ~15)
            if self._heap_next > HEAP + HEAP_SIZE:
                raise RuntimeError('오라클 힙 영역이 모자랍니다')
            self.write(at, bytes(size))
            self._sizes[at] = size
        else:
            at, self._global_next = self._global_next, self._global_next + ((size + 0xFFF) & ~0xFFF)
            if self._global_next > GLOBAL + GLOBAL_SIZE:
                raise RuntimeError('오라클 GlobalAlloc 영역이 모자랍니다')
        return at

    def _heap_realloc(self, vm, heap, flags, old, size):
        new = self._bump('heap', size)
        self.write(new, self.read(old, min(self._sizes[old], size)))
        return new

    def _create_file(self, vm, name, access, share, security, disposition, flags, template):
        if access & GENERIC_WRITE:
            raise RuntimeError('오라클은 원본 파일에 쓰지 않습니다')
        raw = self.read(name, 260)
        path = raw[:raw.index(0)].decode('ascii')
        prefix = self.read(GAME_FOLDER, 260).split(b'\0')[0].decode('ascii')
        if not path.upper().startswith(prefix.upper()):
            raise RuntimeError(f'오라클은 게임 폴더 밖 파일을 열지 않습니다: {path}')
        local = os.path.join(ROOT, *path[len(prefix):].split('\\'))
        if not os.path.exists(local):
            return INVALID_HANDLE
        handle = 0x100 + 4 * len(self._files)
        while handle in self._files:
            handle += 4
        self._files[handle] = open(local, 'rb')
        return handle

    def _set_file_pointer(self, vm, handle, distance, high, method):
        f = self._files[handle]
        f.seek(struct.unpack('<i', struct.pack('<I', distance))[0], method)
        return f.tell()

    def _read_file(self, vm, handle, buffer, size, read_at, overlapped):
        data = self._files[handle].read(size)
        self.write(buffer, data)
        if read_at:
            self.set_u32(read_at, len(data))
        return 1
