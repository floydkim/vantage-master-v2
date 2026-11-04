"""영문판 vmv2.exe의 문자열 주소 → 한국어판 Vmv2.exe의 주소 대응표. 실행: python3 tools/i18n/map_strings.py

두 exe는 같은 소스의 다른 빌드(컴파일 설정이 달라 코드가 맞지 않음)라 대응을 손으로 찾은 표 주소에서 만든다:
- 표: 두 판의 같은 표의 칸 k끼리 짝짓는다. 포인터 표는 칸이 포인터, 레코드 표는 레코드 안의 포인터 칸이다.
- 직접 주소: 코드가 바로 쓰는 문자열은 뜻으로 짝지어 DIRECT에 적는다.
한국어판 칸이 빈 글이면 짝짓지 않는다(영문을 보인다). 글은 넣지 않고 주소만 src/i18n/koStrings.json에 쓴다.
"""
import json
import os
import struct

ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
EN = os.path.join(ROOT, 'original', 'VMO_WIN', 'vmv2.exe')
KO = os.path.join(ROOT, 'original', 'KO', 'Vmv2.exe')
OUT = os.path.join(ROOT, 'src', 'i18n', 'koStrings.json')
BASE = 0x400000

# (이름, 영문 표, 한국어 표, 칸 수, 레코드 크기, 레코드 안 포인터 칸)
TABLES = [
    ('지형 이름', 0x45F210, 0x45A058, 17, 4, (0,)),
    ('이동 종류', 0x45F254, 0x45A0A0, 5, 4, (0,)),
    ('메뉴', 0x46004C, 0x45AE40, 4, 4, (0,)),
    ('유닛 메뉴', 0x46005C, 0x45AE50, 10, 4, (0,)),
    ('지형 설명', 0x46222C, 0x45CED0, 17, 4, (0,)),
    ('네이티얼 설명 0(벽)', 0x46226C, 0x45CF10, 1, 4, (0,)),
    ('네이티얼 설명', 0x462270, 0x45CF18, 24, 4, (0,)),
    ('마스터 설명', 0x4622D0, 0x45CF78, 27, 4, (0,)),
    ('마법 설명', 0x46233C, 0x45CFE8, 6, 4, (0,)),
    ('MM 글', 0x465DD8, 0x460048, 8, 4, (0,)),
    ('MM 질문', 0x465DF8, 0x460068, 8, 4, (0,)),
    ('MM 답', 0x465E58, 0x4600C8, 22, 4, (0,)),
    ('MM 카드', 0x46600C, 0x460280, 11, 4, (0,)),
    ('MM 결과', 0x466038, 0x4602B0, 27, 4, (0,)),
    ('MM 설명', 0x4660A4, 0x460320, 27, 4, (0,)),
    ('밝기', 0x468B84, 0x4626A0, 3, 4, (0,)),
    ('아이템', 0x468D60, 0x4627A8, 30, 0x10, (8, 0xC)),
    ('표준 이름', 0x468FA8, 0x4629F0, 27, 4, (0,)),
    ('마스터 종류', 0x469014, 0x462A60, 27, 4, (0,)),
    ('마스터 공격', 0x469080, 0x462AD0, 27, 4, (0,)),
    ('행동', 0x465908, 0x45FBB0, 30, 0x14, (0x10,)),
    ('속성', 0x474838, 0x46DD50, 5, 4, (0,)),
    ('성격', 0x47484C, 0x46DD68, 3, 4, (0,)),
    ('네이티얼', 0x4749D8, 0x46DE28, 25, 0x58, (0x50, 0x54)),
    ('맵 이름표', 0x475BE0, 0x46EF40, 9, 4, (0,)),
]

# 코드가 바로 쓰는 문자열(영문 주소 → 한국어 주소), 뜻으로 짝지음
DIRECT = {
    # 전투 창(한국어판은 함수마다 글 차례가 거꾸로다. 영문이 같은 0x45e678·0x45e6bc는 그 차례로: 단일 대상 낱말, 범위 낱말)
    0x45E3C8: 0x4593AC, 0x45E3F0: 0x459338, 0x45E430: 0x4593E8, 0x45E44C: 0x459430, 0x45E450: 0x45942C, 0x45E458: 0x459418,
    0x45E468: 0x459400, 0x45E48C: 0x4593D0, 0x45E558: 0x4594C8, 0x45E574: 0x4594E0, 0x45E600: 0x4595A4, 0x45E638: 0x459558,
    0x45E678: 0x45962C, 0x45E6BC: 0x4595E8, 0x45E700: 0x459670, 0x45E744: 0x4596B4, 0x45E77C: 0x459700, 0x45E7BC: 0x459748,
    0x45E800: 0x4597E8, 0x45E8C4: 0x459798, 0x45E910: 0x459888, 0x45E9A0: 0x459904, 0x45EA38: 0x459A08, 0x45EAE0: 0x45998C,
    0x45EB78: 0x459A8C, 0x45EBD4: 0x459AE0, 0x45EC14: 0x459B74, 0x45ECB0: 0x459B24, 0x45ED10: 0x459BF0, 0x45EDD0: 0x459DC8,
    0x45EE68: 0x459D6C, 0x45EEC4: 0x459CF0, 0x45EF64: 0x459CA0, 0x45F048: 0x459ED8,
    # 창 제목(전장·정보·전장 보기·도움말), 정보 창 글(방어·높이·수위와 그 단위·증감 글, 깊이 1~3; 한 함수 안 글은 거꾸로 놓임)
    0x45F554: 0x45A328, 0x45F400: 0x45A22C, 0x45F4DC: 0x45A2DC, 0x462374: 0x45FB84,
    0x45F458: 0x45A264, 0x45F45C: 0x45A25C, 0x45F460: 0x45A27C, 0x45F468: 0x45A278, 0x45F470: 0x45A274,
    0x45F484: 0x45A294, 0x45F48C: 0x45A28C, 0x45F494: 0x45A284,
    # 프레임 제목·모드 이름(한국어판 제목은 'Vantage Master Tactics V2')
    0x45EFC8: 0x459EBC, 0x45EFDC: 0x459EA8, 0x45EFF0: 0x459E98, 0x45F000: 0x459E7C, 0x45F01C: 0x459E60, 0x45F038: 0x459E50,
    # 결과 창
    0x45F080: 0x459F34, 0x45F0D4: 0x459F60, 0x45F0FC: 0x459F88, 0x45F114: 0x459F80, 0x45F11C: 0x459FF4, 0x45F12C: 0x459FEC,
    0x45F134: 0x459FE0, 0x45F144: 0x459FD8, 0x45F150: 0x459FD0, 0x45F158: 0x459FC8, 0x45F160: 0x459FC0, 0x45F168: 0x459FB0,
    0x45F17C: 0x459FAC, 0x45F184: 0x459FA8, 0x45F18C: 0x459FA4, 0x45F194: 0x459F9C, 0x45F19C: 0x459FFC, 0x45F1C0: 0x459FFC,
    0x45F1E4: 0x45A01C, 0x45F1FC: 0x45A034,
    # 장면 창 보고서(같은 글은 결과 창 것과 합쳐짐)
    0x460360: 0x45B130, 0x460378: 0x459FF4, 0x460388: 0x459FEC, 0x460390: 0x459FE0, 0x4603A0: 0x459FD8, 0x4603AC: 0x459FD0,
    0x4603B4: 0x459FC8, 0x4603BC: 0x459FC0, 0x4603C4: 0x459FB0, 0x4603D8: 0x45B120, 0x4603EC: 0x45B110, 0x460400: 0x45B100,
    0x460414: 0x45B0EC, 0x46042C: 0x459F80, 0x460434: 0x45B144, 0x460458: 0x45B144, 0x46047C: 0x45B0D4,
    # 타이틀: 이어 하기 질문, 메뉴 글(한국어판도 영문)
    0x465D70: 0x45FFDC, 0x465CF8: 0x45FFC8,
    # 마스터 메이킹·맵 정보·마스터 정보
    0x468B40: 0x462668, 0x468B74: 0x45A034, 0x468BC0: 0x462700, 0x468C44: 0x459F80, 0x468C4C: 0x462744, 0x468CBC: 0x462750,
    0x468D18: 0x462798, 0x468D34: 0x462780, 0x468D3C: 0x45A2B0,
    # 메시지 상자 제목(한국어판은 확인 제목 글 하나로 합쳐짐, 'Error'는 영문 그대로)
    0x472680: 0x45946C, 0x4758CC: 0x46EC8C,
    # 게임 데이터·이어 하기 목록과 읽기·쓰기 실패
    0x474110: 0x46D728, 0x47415C: 0x46D6F0, 0x474194: 0x46D6D8, 0x4741AC: 0x46D6BC, 0x4741C8: 0x46D6A8, 0x4741DC: 0x46D690,
    0x474208: 0x46D660, 0x474224: 0x46D774, 0x474244: 0x46D774, 0x474234: 0x46D78C, 0x474254: 0x46D78C, 0x474264: 0x46D7C0,
    0x4742B8: 0x46D7A4,
    # 네이티얼 정보의 마법 종류·범위('None'은 한국어판에서 속성 이름 글과 합쳐짐)
    0x4748A0: 0x46DDA8, 0x4748B0: 0x46DD9C, 0x4748C0: 0x46DD90, 0x4748D0: 0x46DDE8, 0x4748DC: 0x46DDDC, 0x4748F0: 0x46DDD0,
    0x474904: 0x46DDC4, 0x474918: 0x46DDBC, 0x474928: 0x46DDB4, 0x474930: 0x46DE20, 0x474938: 0x46DE20, 0x474940: 0x46DE08,
    0x474958: 0x46DE14, 0x474970: 0x46DDF8, 0x474980: 0x46DE00, 0x474990: 0x46DDF0, 0x4749B4: 0x46DD8C,
    # 월드 창
    0x475CAC: 0x46EFF0, 0x475CDC: 0x46F018, 0x475D14: 0x46F07C, 0x475D28: 0x46F064, 0x475D40: 0x46F04C, 0x475D58: 0x46F038,
}


class Exe:
    def __init__(self, path):
        d = open(path, 'rb').read()
        pe = struct.unpack_from('<I', d, 0x3C)[0]
        n = struct.unpack_from('<H', d, pe + 6)[0]
        opt = struct.unpack_from('<H', d, pe + 20)[0]
        self.secs = []
        for i in range(n):
            o = pe + 24 + opt + 40 * i
            _, va, rs, rp = struct.unpack_from('<IIII', d, o + 8)
            self.secs.append((BASE + va, d[rp:rp + rs]))

    def read(self, va, n):
        for v0, data in self.secs:
            if v0 <= va and va + n <= v0 + len(data):
                return data[va - v0:va - v0 + n]
        raise ValueError(f'주소가 파일 안에 없음: {va:#x}')

    def inside(self, va):
        return any(v0 <= va < v0 + len(data) for v0, data in self.secs)

    def u32(self, va):
        return struct.unpack('<I', self.read(va, 4))[0]

    def cstring(self, va):
        for v0, data in self.secs:
            if v0 <= va < v0 + len(data):
                return data[va - v0:data.index(b'\0', va - v0)]
        raise ValueError(f'주소가 파일 안에 없음: {va:#x}')


def build(en, ko):
    pairs, conflicts = {}, []

    def pair(name, e, k):
        if not en.inside(e):  # 초기값 없는 칸(실행 중에 채우는 버퍼)
            return
        if not ko.inside(k) or not ko.cstring(k):
            return
        if pairs.get(e, k) != k:
            conflicts.append(f'{name}: {e:#x} → {pairs[e]:#x}·{k:#x}')
            return
        pairs[e] = k

    for name, e0, k0, count, size, slots in TABLES:
        for i in range(count):
            for s in slots:
                pair(name, en.u32(e0 + i * size + s), ko.u32(k0 + i * size + s))
    for e, k in DIRECT.items():
        pair('직접', e, k)
    return pairs, conflicts


def main():
    en, ko = Exe(EN), Exe(KO)
    pairs, conflicts = build(en, ko)
    for c in conflicts:
        print('겹침', c)
    with open(OUT, 'w') as f:
        json.dump({f'{e:#x}': f'{k:#x}' for e, k in sorted(pairs.items())}, f, indent=0)
        f.write('\n')
    print(f'{OUT}: {len(pairs)}개')


if __name__ == '__main__':
    main()
