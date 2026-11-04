"""vmv2.exe의 함수를 Unicorn 가상 CPU에서 실행하는 오라클 하네스."""
import struct

from unicorn import UC_ARCH_X86, UC_ERR_INSN_INVALID, UC_HOOK_CODE, UC_HOOK_INTR, UC_HOOK_MEM_UNMAPPED, UC_MODE_32, UC_PROT_ALL, Uc, UcError
from unicorn.unicorn_const import UC_MEM_FETCH_UNMAPPED, UC_MEM_READ_UNMAPPED, UC_MEM_WRITE_UNMAPPED
from unicorn.x86_const import (
    UC_X86_REG_EAX, UC_X86_REG_EBP, UC_X86_REG_EBX, UC_X86_REG_ECX, UC_X86_REG_EDI, UC_X86_REG_EDX,
    UC_X86_REG_DS, UC_X86_REG_EFLAGS, UC_X86_REG_EIP, UC_X86_REG_ES, UC_X86_REG_ESI, UC_X86_REG_ESP,
    UC_X86_REG_FPCW, UC_X86_REG_FS, UC_X86_REG_GDTR, UC_X86_REG_SS,
)

IMAGE_BASE = 0x400000
TRAP_BASE = 0x10000000    # Windows API 대신 실행되는 함정 주소(API마다 16바이트)
RETURN_MARK = 0x0FFF0000  # 호출한 함수가 돌아오면 닿는 표식 주소
STACK_TOP = 0x7FF00000
SCRATCH = 0x20000000      # 테스트 입력·출력을 두는 16MB 영역
WINDOWS_FPU_CONTROL = 0x27F  # Windows 스레드 시작 때 x87 제어 워드: 53비트 정밀도, 가장 가까운 값으로 반올림
TEB = 0x7FFD0000          # 가짜 스레드 정보 블록: fs:[0]은 SEH 체인 끝(0xFFFFFFFF)
GDT = 0x7FFE0000
DEFAULT_LIMIT = 50_000_000  # 실행 명령 수 상한


class ApiCall(Exception):
    """순수하다고 본 함수가 Windows API를 불렀다."""


class OracleFault(Exception):
    """원작 함수가 매핑되지 않은 메모리에 접근하는 등 CPU 오류로 멈췄다."""


ACCESS_NAMES = {UC_MEM_READ_UNMAPPED: '읽기', UC_MEM_WRITE_UNMAPPED: '쓰기', UC_MEM_FETCH_UNMAPPED: '실행'}
CPU_EXCEPTIONS = {0: '0으로 나누기', 1: '디버그', 3: '중단점', 4: '넘침', 5: '범위', 6: '잘못된 명령', 13: '일반 보호 오류', 14: '페이지 오류'}


class Vm:
    def __init__(self, exe: bytes):
        self._exe = exe
        self._pe = struct.unpack_from('<I', exe, 0x3C)[0]
        opt = self._pe + 24
        self._sections = []
        nsec = struct.unpack_from('<H', exe, self._pe + 6)[0]
        optsz = struct.unpack_from('<H', exe, self._pe + 20)[0]
        for i in range(nsec):
            vsz, va, rsz, rp = struct.unpack_from('<IIII', exe, opt + optsz + i * 40 + 8)
            self._sections.append((va, vsz, rsz, rp))
        size_of_image = struct.unpack_from('<I', exe, opt + 56)[0]
        page = struct.unpack_from('<I', exe, opt + 32)[0]  # SectionAlignment

        self.uc = Uc(UC_ARCH_X86, UC_MODE_32)
        self.uc.mem_map(IMAGE_BASE, (size_of_image + 0xFFF) & ~0xFFF, UC_PROT_ALL)
        self.uc.mem_write(IMAGE_BASE, exe[:0x1000])
        for va, vsz, rsz, rp in self._sections:  # Windows 로더처럼 마지막 페이지 끝까지 파일 바이트, 그 뒤(bss)는 0
            self.uc.mem_write(IMAGE_BASE + va, exe[rp:rp + min(rsz, (vsz + page - 1) // page * page)])

        self._api_names = self._redirect_imports(opt)
        traps = len(self._api_names) * 16
        self.uc.mem_map(TRAP_BASE, (traps + 0xFFF) & ~0xFFF, UC_PROT_ALL)
        self.uc.mem_write(TRAP_BASE, b'\xC3' * traps)
        self.uc.hook_add(UC_HOOK_CODE, self._on_trap, begin=TRAP_BASE, end=TRAP_BASE + traps - 1)
        self.uc.hook_add(UC_HOOK_MEM_UNMAPPED, self._on_unmapped)
        self.uc.hook_add(UC_HOOK_INTR, self._on_interrupt)
        self._fault = None
        self._interrupt = None
        self._api_stubs = {}
        self._function_stubs = {}
        self._setup_segments()
        self.uc.mem_map(RETURN_MARK, 0x1000, UC_PROT_ALL)
        self.uc.mem_map(STACK_TOP - 0x100000, 0x100000, UC_PROT_ALL)
        self.uc.mem_map(SCRATCH, 0x1000000, UC_PROT_ALL)
        self._api_hit = None

    def _setup_segments(self):
        """SEH 프롤로그(mov eax, fs:[0])가 돌도록 GDT에 평면 코드·데이터 세그먼트와 TEB를 가리키는 FS를 만든다.

        GDTR만 바꾸고 SS를 다시 싣지 않으면 스택이 16비트처럼 잘리므로 SS·DS·ES도 평면 세그먼트로 다시 싣는다.
        코드 설명자(1번)는 만들기만 하고 CS에 싣지 않는다(Unicorn의 평면 CS를 그대로 쓴다).
        """
        self.uc.mem_map(TEB, 0x1000, UC_PROT_ALL)
        self.uc.mem_map(GDT, 0x1000, UC_PROT_ALL)
        self.write(TEB, struct.pack('<I', 0xFFFFFFFF))

        def descriptor(base, limit, access, flags):
            return (limit & 0xFFFF) | ((base & 0xFFFFFF) << 16) | (access << 40) | (((limit >> 16) & 0xF) << 48) \
                | (flags << 52) | (((base >> 24) & 0xFF) << 56)

        self.write(GDT + 8, struct.pack('<Q', descriptor(0, 0xFFFFF, 0x9A, 0xC)))       # 1: 코드, 4GB, 32비트
        self.write(GDT + 16, struct.pack('<Q', descriptor(0, 0xFFFFF, 0x92, 0xC)))      # 2: 데이터·스택
        self.write(GDT + 24, struct.pack('<Q', descriptor(TEB, 0xFFF, 0xF2, 0x4)))      # 3: FS → TEB(확장-업 데이터, DPL 3)
        self.uc.reg_write(UC_X86_REG_GDTR, (0, GDT, 0xFFF, 0))
        for reg in (UC_X86_REG_SS, UC_X86_REG_DS, UC_X86_REG_ES):
            self.uc.reg_write(reg, 2 << 3)
        self.uc.reg_write(UC_X86_REG_FS, (3 << 3) | 3)

    def stub_api(self, name: str, nargs: int, handler) -> None:
        """Windows API 대역. handler(vm, *인자) → eax. stdcall이라 돌아갈 때 인자를 스택에서 걷어 낸다."""
        if name not in self._api_names.values():
            raise ValueError(f'exe가 가져오지 않는 API: {name}')
        self._api_stubs[name] = (nargs, handler)

    def stub_function(self, address: int, nargs: int, handler) -> None:
        """원작 cdecl 함수 대역. handler(vm, *인자) → eax. 인자는 호출자가 걷어 낸다."""
        self._function_stubs[address] = (nargs, handler)
        self.uc.hook_add(UC_HOOK_CODE, self._on_function_stub, begin=address, end=address)

    def _return_from_stub(self, uc, nargs, handler, pop_args):
        esp = uc.reg_read(UC_X86_REG_ESP)
        ret, *args = struct.unpack(f'<{nargs + 1}I', self.read(esp, 4 * (nargs + 1)))
        uc.reg_write(UC_X86_REG_EAX, handler(self, *args) & 0xFFFFFFFF)
        uc.reg_write(UC_X86_REG_ESP, esp + 4 + (4 * nargs if pop_args else 0))
        uc.reg_write(UC_X86_REG_EIP, ret)

    def unstub_function(self, address: int) -> None:
        """원작 함수 대역을 걷어 낸다(훅은 남고 아무 일도 하지 않는다)"""
        self._function_stubs.pop(address, None)

    def _on_function_stub(self, uc, addr, size, user_data):
        if addr not in self._function_stubs:
            return
        nargs, handler = self._function_stubs[addr]
        self._return_from_stub(uc, nargs, handler, pop_args=False)

    def _offset(self, rva):
        for va, vsz, rsz, rp in self._sections:
            if va <= rva < va + max(vsz, rsz):
                return rp + rva - va
        raise ValueError(f'파일에 없는 RVA: {rva:#x}')

    def _cstr(self, rva):
        o = self._offset(rva)
        return self._exe[o:self._exe.index(b'\0', o)].decode('ascii')

    def _redirect_imports(self, opt):
        """IAT의 모든 항목을 함정 주소로 바꾸고 {함정 주소: 'DLL!함수'}를 돌려준다."""
        names = {}
        desc = self._offset(struct.unpack_from('<I', self._exe, opt + 96 + 8)[0])
        while True:
            ilt, _, _, name_rva, iat = struct.unpack_from('<IIIII', self._exe, desc)
            if name_rva == 0:
                return names
            dll = self._cstr(name_rva)
            k = 0
            while True:
                thunk = struct.unpack_from('<I', self._exe, self._offset(ilt or iat) + k * 4)[0]
                if thunk == 0:
                    break
                fn = f'#{thunk & 0xFFFF}' if thunk & 0x80000000 else self._cstr(thunk + 2)
                trap = TRAP_BASE + len(names) * 16
                names[trap] = f'{dll}!{fn}'
                self.uc.mem_write(IMAGE_BASE + iat + k * 4, struct.pack('<I', trap))
                k += 1
            desc += 20

    def _on_unmapped(self, uc, access, address, size, value, user_data):
        self._fault = (ACCESS_NAMES.get(access, f'접근({access})'), address)
        return False

    def _on_interrupt(self, uc, number, user_data):
        self._interrupt = number
        uc.emu_stop()

    def _on_trap(self, uc, addr, size, user_data):
        name = self._api_names[addr]
        if name in self._api_stubs:
            nargs, handler = self._api_stubs[name]
            self._return_from_stub(uc, nargs, handler, pop_args=True)
            return
        self._api_hit = name
        uc.emu_stop()

    def call(self, address: int, *args: int, limit: int = DEFAULT_LIMIT) -> int:
        """cdecl 함수를 호출하고 eax를 돌려준다. 스택 정리는 호출자 몫이라 신경 쓰지 않는다.

        레지스터는 매번 초기화하지만 전역 메모리는 호출 사이에 남는다(rand 시드 등).
        그래서 정답 생성기는 경우마다 새 Vm을 만든다(1ms 미만).
        """
        sp = STACK_TOP - 0x1000
        for arg in reversed(args):
            sp -= 4
            self.uc.mem_write(sp, struct.pack('<I', arg & 0xFFFFFFFF))
        sp -= 4
        self.uc.mem_write(sp, struct.pack('<I', RETURN_MARK))
        for reg in (UC_X86_REG_EAX, UC_X86_REG_EBX, UC_X86_REG_ECX, UC_X86_REG_EDX,
                    UC_X86_REG_ESI, UC_X86_REG_EDI, UC_X86_REG_EBP):
            self.uc.reg_write(reg, 0)
        self.uc.reg_write(UC_X86_REG_EFLAGS, 0x2)  # 1번 비트는 항상 1
        # Unicorn은 x87 제어 워드를 0으로 시작한다. 그대로 두면 원작 _ftol이 제어 워드를 다시 실은 뒤 계산이 24비트로 떨어진다
        self.uc.reg_write(UC_X86_REG_FPCW, WINDOWS_FPU_CONTROL)
        self.uc.reg_write(UC_X86_REG_ESP, sp)
        self._api_hit = None
        self._fault = None
        self._interrupt = None
        try:
            self.uc.emu_start(address, RETURN_MARK, count=limit)
        except UcError as e:
            pc = self.uc.reg_read(UC_X86_REG_EIP)
            if e.errno == UC_ERR_INSN_INVALID:
                raise OracleFault(f'원작 함수 실행 중 CPU 예외: 잘못된 명령 (eip={pc:#x})') from e
            if self._fault is None:
                raise OracleFault(f'원작 함수 실행 중 CPU 오류: {e} (eip={pc:#x})') from e
            kind, at = self._fault
            hint = ' — 널 포인터 접근일 수 있음' if at < 0x10000 else ''
            raise OracleFault(f'매핑되지 않은 메모리 {kind}: 주소 {at:#x} (eip={pc:#x}){hint}') from e
        if self._interrupt is not None:
            name = CPU_EXCEPTIONS.get(self._interrupt, '알 수 없는 인터럽트')
            raise OracleFault(f'원작 함수 실행 중 CPU 예외: {name}(인터럽트 {self._interrupt}) (eip={self.uc.reg_read(UC_X86_REG_EIP):#x})')
        if self._api_hit:
            raise ApiCall(f'예상 못한 API 호출: {self._api_hit}')
        pc = self.uc.reg_read(UC_X86_REG_EIP)
        if pc != RETURN_MARK:
            raise RuntimeError(f'함수가 돌아오지 않았습니다(명령 수 상한 {limit} 초과 가능): eip={pc:#x}')
        return self.uc.reg_read(UC_X86_REG_EAX)

    def read(self, address: int, size: int) -> bytes:
        return bytes(self.uc.mem_read(address, size))

    def write(self, address: int, data: bytes) -> None:
        self.uc.mem_write(address, bytes(data))

    def u32(self, address: int) -> int:
        return struct.unpack('<I', self.read(address, 4))[0]

    def set_u32(self, address: int, value: int) -> None:
        self.write(address, struct.pack('<I', value & 0xFFFFFFFF))
