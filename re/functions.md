# vmv2.exe 함수 기록

기준 판본: VMOnline `vmv2.exe` (SHA-256 `daa647ff03cc1437fe5ade458f6a43a7138e8bfb820a86fb1b661ca75895819f`).
디스어셈블: `objdump -d --x86-asm-syntax=intel vmv2.exe` (Apple LLVM objdump). 디컴파일 결과물은 `re/decomp/`(git 제외)에 둔다.

| 주소 | 이름 | 역할 | TS | 상태 |
|---|---|---|---|---|
| 0x00422288 | openDataFile | 게임 폴더 + `DATA%02d.DAT`로 경로를 만들어 CreateFileA로 연다 | `datFileName` | 이식 |
| 0x004222ef | readEntry | 리소스 ID(상위 16비트 = DAT 번호, 하위 16비트 = 항목 번호)로 오프셋 표의 [시작, 다음 시작)을 읽는다. 셋째 인자가 0이 아니면 압축을 푼다 | `parseLbDat`, `openVmDat` | 이식 |
| 0x00422479 | readEntryByTable | 0x00460494의 리소스 ID 표에서 ID를 꺼내 readEntry(압축 해제 켬)를 부른다 | — | 미이식(표 내용 미확인) |
| 0x0044c970 | lbDecompress | 블록 루프: u16 크기 + 본문 + u8 계속 여부 | `lbDecompress` | 이식 |
| 0x0044ca71 | decodeModeA | 바이트 토큰(리터럴/반복/역참조+이어 복사) | `decodeModeA` | 이식 |
| 0x0044cff5 | decodeModeB | 비트 플래그 LZ | `decodeModeB` | 이식 |
| 0x0044d283 | (decodeModeB 내부) | 역참조 길이 읽기 | `readLength` | 이식 |
| 0x0044d3cf | readBit | u16 LE 비트 버퍼, 낮은 비트부터 | `readBit` | 이식 |
| 0x0044d453 | readBits | n비트, 먼저 읽은 비트가 상위 | `readBits` | 이식 |
| 0x004055cf | saveTurnStart | 입력 대기 끝: 차례 시작 위치(0x476b40) 저장, 진영 제어가 1(CPU)이면 CPU 생각 0x445b20. 사람이면 소리 5와 생각 시간 타이머(제한 0x45e0f0·0x45e0fc[시간 제한], 남은 = 제한 × 6) | `startTimer` | 확인(타이머는 오라클 픽스처) |
| 0x00445b20 | cpuThink | CPU 생각: 분석 격자(0x43ff60 버퍼, 칸마다 i32 10개 중 x·y만 채움), 0x44b207(진영 0·1), 0x445d57, 0x44ba74(떠 두기), 0x446106, 결정(마스터이거나 No Guard(0x503ff0 & 8)가 꺼졌으면 0x446434, 아니면 0x4462ef), 0x44bb31(되돌리기), 결정(0x4cd868~0x4cd88c)을 명령 u16 두 개로 0x406573에. 결정은 상태 블록과 AI 기억(난수 상태 0x475da0, 유닛 가중치 +0x60·+0x64, 작업 버퍼 앞 0x11000바이트)으로 정해진다(대기의 번호·대상은 이전 생각의 찌꺼기) | `cpuCommand` | 이식(오라클 픽스처) |
| 0x0044b207 | analyzeSide | 진영 점수 0x4ead64[진영] = (512 − 51200 / (max(마스터 마력 × 회복 배수 − 유지 MP, −20) + 120)) × 384 / ((풀기 마법 수 + 2)² × 256). 풀기 마법은 OA + 상태 이상 남은 분 < 81이고 HP > 2인 유닛의 것만. 0x4cefe8[진영] = 상대 진영 네이티얼 목록에 상태 이상 마법 네이티얼이 있으면 10, 아니면 상대 마스터 마법에 있으면 6 | `analyzeSide` | 이식(오라클 픽스처) |
| 0x00445d57 | thinkWeights | 진영 배율(MP 사정·상대 회복 배수), 유닛 AI 가중치: 마스터 +0x60 = 0x9c4, 네이티얼 +0x64 = (표 +0x4c × 2/3 + 표 +0x4c × 마스터와 거리(높이 차 더함, 비행 제외) × OA(속도, 이동함, 0) / (이동력 × 270)) × 배율 >> 8, +0x60 = +0x64 << 레벨(0x4460db). 풀기 마법 네이티얼에서 반복이 끝나 뒤 칸은 예전 값을 둔다. 끝에 주체 진영 마스터 +0x60 <<= 2 | `thinkWeights` | 이식(오라클 픽스처) |
| 0x00446106 | decideWeights | 결정 직전 가중치: 0x445d57과 같은 식에 배율 없이. 풀기 마법 네이티얼에서 끝남 | `decideWeights` | 이식(오라클 픽스처) |
| 0x0044ba74 | aiSnapshot | 생각 전 실행 중 상태(유닛 표, 표시 객체 풀, 진영 상태, 마정석, 물높이·단계·남은 분)를 떠 둔다 | `World.save` | 확인 |
| 0x0044bb31 | aiRestore | 떠 둔 상태를 되돌린다(유닛 표는 쓰는 칸 수만큼만). 물높이가 바뀌었으면 그래프 0x440210 | `World.restore` | 확인 |
| 0x00446434 | decideStandard | 표준 ver.2.0 결정: 진영마다 0x44b487·0x44b54c·0x448bb3·0x449927 → 되돌리기 → (마스터) 0x4491d8 → 주체 방향 += rand % 6 → 0x447d97(주체, 0) → 0x44b7d7 → 이번 차례 칸(표시 1)마다 합계 += 앞날 + (rand & 15), 키(합계 + 마정석 5000 + 높이 × 8 + (100 − 지형 방어) × 10, 제자리 +5000(합계에는 0x44b7d7 >> 7), 네이티얼이 마스터 곁(거리 < 2, 높이 차 ≤ 2) +3000, x·y 모두 홀수 +0x24)로 위 0x60개(네이티얼 0x20개)를 후보 목록(0x4cd898)에. 1위 행동 점수 < 0x1f20c면 후보마다 되돌린 뒤 0x4470cd·0x44717e로 고르고, 소환이면 0x44aa04로 고친 뒤 이웃 칸 다섯과 다음 정각 소환(0x4497a1·0x449f5c)을, 이어서 자기 칸 마법(범위 종류 5, 0x449e53), 약한 행동(< 2000)이면 대기, 대기·자기 칸 행동이면 다른 방향 다섯을 0x44717e로 견준다. 아니면 1위 후보 | `decideStandard` | 이식(오라클 픽스처) |
| 0x004462ef | decideNoGuard | No Guard 네이티얼 결정: 0x448bb3 없이 진영마다 0x44b487·0x44b54c·0x449927, 되돌리기, 방향 rand, 0x447d97(주체, 0), 0x44b7d7, 이번 차례 칸 합계 += 앞날 + (rand & 15)가 가장 큰 칸 | `decideNoGuard` | 이식(오라클 픽스처) |
| 0x0044b487 | countSpellMp | 0x4cd854[진영] = 진영 네이티얼이 가진 마법 MP 합 | `countSpellMp` | 이식 |
| 0x0044b54c | countReserveMp | 0x4cd890[진영] = min(가장 비싼 소환 MP + 0x4cd854, 최대 MP) | `countReserveMp` | 이식 |
| 0x00448bb3 | valueSummons | 소환 값 0x4cd8c8[진영 × 25 + 종류]: 시각 +4시간, 종류마다 평가용 네이티얼(0x40fb43, 위치 객체 높이 = 진영 마스터 이동 범위에서 가장 낮은 칸)로 상대 유닛마다 0x448628(공격, 상태 이상·데미지 마법이면 더 큰 쪽)·혼자 0x4488c5, 회복·풀기 마법은 진영 회복량·상대 상태 이상 위협으로 보조 값, 0x448a2c 위협 + 0x200으로 나누고 (이동력 + 1)을 곱함. 시각은 +20시간으로 되돌림 | `valueSummons` | 이식 |
| 0x00448628 | actionValue | (주체, 행동, 대상) 값: 데미지(0x4112e9)·회복(0x411450, 대상이 상태 이상 마법을 가지면 0)·상태 이상과 풀기(0x44b194, 풀기는 대상이 상태 이상 마법을 가질 때만)에 범위 종류 표 0x4754b0·사거리 + 7·포물선 높이 차·효과 반경 표 0x4754c8, × 60 / OA(속도, 이동함, 행동) × 대상 +0x60, MP 값(0x44b73c − 600 × MP) × 256. 음수면 0 | `actionValue` | 이식 |
| 0x004488c5 | bareValue | 상대 없이 본 공격(0x411371)·상태 이상(0x44b194) 값. 0x448628과 같은 표에 포물선은 9/8, 가중치는 0x9c4 | `bareValue` | 이식 |
| 0x00448a2c | threatTo | 평가용 네이티얼이 받을 위협: 상대 네이티얼마다 0x448628(그 네이티얼, 원작대로 평가용 네이티얼의 공격 행동 번호, 평가용)과 마법들의 최댓값 합 + 방어 표 0x4754d4[방어·마법방어 중 작은 쪽 + 큰 쪽 / 2] × 4000을 상대 가중치 합 + 4000으로 나눔 | `threatTo` | 이식 |
| 0x00411450 | healAmount | 0x45f6a0[마력 + 위력] + 0x7f | `healAmount` | 이식 |
| 0x00411371 | bareDamage | 0x45f68c[(세부 0이면 공격, 아니면 마력) + 위력 + 7] + 0x7f | `bareValue` 안 | 이식 |
| 0x0044b194 | statusValue | 상태 이상 지속(0x411425) t: t < 120이면 t × 0x500 / 120, 아니면 (4t − 480) × 256 / 120 + 0x500. × 상대 진영 점수(0x4cefe0) / 24 | `actionValue` 안 | 이식 |
| 0x0044b73c | mpCost | MP 값: 비용 0이면 0, 정각 회복량 < 1이면 −200000, 아니면 −120 × 비용 × ((최대 MP − (MP − 비용)) / 정각 회복량) | `actionValue` 안 | 이식 |
| 0x0044b616 | spendValue | MP 값(비용, 늘어나는 유지 MP u): 비용 < 1이면 0, (회복량 − u) < 1이면 −100000, 남는 MP가 0x4cd890 이상이면 −300u, 아니면 −120 × 비용 × ((0x4cd890 − 남는 MP) / (회복량 − u) + 남는 MP가 0x4cd854 아래면 모자란 양² × (60 − 분) × 25 / (0x4cd854² × 30)) − 300u | `spendValue` | 이식 |
| 0x00449927 | locateRivals | 0x4cd8b8·0x4cd8bc[진영] = 상대 유닛(평가용 포함)의 평균 (x × 2 + (y & 1), y × 2) | `locateRivals` | 이식 |
| 0x00449a10 | nearRivals | 0x40 − \|2배 x − 평균\| − \|2배 y − 평균\| | `nearRivals` | 이식 |
| 0x00449a77 | directionValue | 방향으로 6칸(격자 밖이면 1칸, 그래도 밖이면 제자리)의 0x449a10 / 6 | `faceRivals` 안 | 이식 |
| 0x004497a1 | rankSummons | 소환 순위 0x4cd990·0x4eaca4[진영 × 24 + 순위]: MP가 모자라면 −2e9, 아니면 (소환 값 + 0x44b616(소환 MP, 유지 MP)) × 0x503d70[종류] / 0x300 + 0x4ceff0[종류]의 내림차순(같은 값이면 뒤 종류가 앞) | `rankSummons` | 이식 |
| 0x00447d97 | evaluate | (유닛, 앞날): 이동 범위(앞날이 아니면 0x4405dc로 이동력씩 64번까지 넓혀 칸 +0x1e에 몇 차례 거리를 둠) → 마스터는 0x4497a1, 범위 마법은 방향별 버퍼(0x448200) → 멈출 수 있는 칸마다 그 칸에 서서 0x44847f(이동 타입이 멈출 수 있고, 네이티얼이거나 이번 차례 칸일 때), 마정석(빈 것 +10000, 상대 것 +0x4462ad, HP < 10이면 가중치(마스터 2배)), 맵 자리 값((0x4d1c70 − 지금 칸 값) × 50 + 0x4ead6c), 제자리 +1/4(소환이 아니면) + 4, 앞날 마스터의 이동 −25000을 분석 격자에 쓰고 가장 좋은 칸 기록을 돌려준다 | `evaluate` | 이식 |
| 0x0044847f | chooseAction | 칸 기록에 공격·마법(0x449b05, 범위 마법은 0x4cd89c가 지금보다 클 때만)·소환(0x449f5c, 마스터이고 진영 유닛 < 25) 중 가장 좋은 것 | `evaluate` 안 | 이식 |
| 0x00449b05 | bestUse | (유닛, 행동, 문턱, 버퍼): MP가 모자라거나 범위 종류 5면 −2e9. 단일 대상은 0x410e3d를 통과한 유닛마다 0x44b616 + 0x44ace9, 자기 칸 범위(4)는 범위 안 유닛 합, 지정 칸 범위는 버퍼 값이 문턱보다 크고 사거리 안인 칸(자기가 범위에 들면 자기에게 준 값을 더함) | `evaluate` 안 | 이식 |
| 0x00448200 | fillArea | 범위 마법 버퍼(0x4cf054[k]): 칸마다 0x4034e0이면 0x44b616 값, 아니면 −2e9. 다른 유닛마다 그 칸과 범위에 드는 이웃 칸에 0x44ace9를 더함. 0x400번 두 칸씩 건너뛰며 짝수 칸이 지금 값보다 크면 홀수 칸 값을 고른다(다음 마법 칸 버퍼까지 읽는 원작 동작, i32 넘침도 그대로) | `evaluate` 안 | 이식 |
| 0x0044ace9 | hitValue | (주체, 행동, 원점, 대상): 데미지·회복은 0x410fda → 0x44af92, 상태 이상은 지속 증가분 × 대상 가중치 × (HP × 2 + 10) / 900, 풀기는 남은 분으로. 마스터 대상은 진영 점수² / 400(마스터가 쓰면 거리/16 더함), 네이티얼은 진영 점수 / 24 | `hitValue` | 이식 |
| 0x0044af92 | hpValue | 대상 HP 변화 값: 쓰러지면 HP + 3(마스터 + 20), 마정석 칸이 아니면 변화 × 가중치 × 15 / (남은 HP + 5), 마정석 칸은 HP 9·회복·0x4462ad 보정, × 30 / (상태 이상 남은 분 + 30). 같은 진영이면 음수 | `hpValue` | 이식 |
| 0x004462ad | fromMaster | 진영 마스터와 거리 × 0x29a + 0x3415 | `fromMaster` | 이식 |
| 0x004034e0 | openCell | 지형 종류 0x10·10·11이 아니면 1 | `openCell` | 이식 |
| 0x00449f5c | bestSummon | 마스터 이웃 칸에 소환: 순위 값이 지금 최고보다 큰 동안 순위대로, 0x4126d7을 통과한 칸마다 (소환 값 + MP 값) × 0x4d1c70 / 0x300 + 0x4ead6c + 0x449a10 | `bestSummon` | 이식 |
| 0x0044b7d7 | pathValue | 이번 차례에 못 닿는 칸(표시 > 1)마다 합계(최대 22000) × 0x21c / (OA × (표시 + 4)²)가 0x13보다 크면(최대 0x12c0) 그 칸까지 길을 거슬러 이번 차례 칸들 +0x10(앞날)에 이동한 거리만큼 줄어드는 값을 둔다(이미 크면 멈춤). 최댓값을 돌려준다. 멈출 수 없는 길 칸은 이전 생각의 값을 읽는다 | `pathValue` | 이식 |
| 0x00447458 | execute | 기록대로 연출 없이: 이동, 대기(방향, OA(속도, 이동, 0)), 행동(자기 칸: 물높이 0x4255d0·0x4255ff + 0x42562e + 0x440210, 축복 0x412d32(…, 1); 단일 대상: 상태 이상·풀기·데미지; 범위: 범위 안 모두, MP −, OA(속도, 이동, 행동)), 소환(0x40f910, MP −, OA 행동 1), 경험치(0x412ca0·0x412cc9·0x4460db), 살아 있으면 0x401401 | `execute` | 이식 |
| 0x00447a15 | passTime | AI용 시간 진행: 상태 이상 먼저 깎고 OA, 정각마다 MP += 마력 × 회복 배수 − 유지 MP(모자라면 소환 순번이 가장 작은 네이티얼부터 0x4128c8하고 MP 0), 밝기가 바뀌면 밝기 성향 있는 유닛 능력치, 물 돌아옴(0x425755) | `passTime` | 이식 |
| 0x004470cd | faceRivals | 대기이거나 자기 칸·제자리 대상 행동이면 0x449a77이 가장 큰 방향(같으면 앞 방향) | `faceRivals` | 이식 |
| 0x0044717e | lookAhead | 기록대로 행동(0x447458) 뒤 OA(속도, 이동함, 1) 분(마스터는 60 이상, 120 이하) 동안 다음 유닛들을 지형 효과(0x44af92 × 시간 가중)와 함께 0x447d97(…, 1) → 0x4470cd → 0x447458로 두며, 그 유닛 칸 점수(상대면 부호 바꿈, 60000 넘으면 1/4)를 시간 가중((192 − 경과 × 192 / 120) / 256)으로 더해 기록 +8·+0x10에 | `lookAhead` | 이식 |
| 0x0044a20c | playAhead | 45분 동안 다음 유닛들을 지형 효과와 함께 두어 본다(점수 없음) | `playAhead` | 이식 |
| 0x004491d8 | adjustSummons | 마스터 차례 소환 값 고치기: 진영 종류별 수·속성별 유지 MP를 센 뒤 0x44a20c·0x44a39d·0x44a5c3, 시각 +4시간, 종류마다 0x44a88c 값 넷과 소환 값으로 다시 구하고, 되돌린 뒤 수 표 0x475550·속성 몫((0x380 − 몫 × 512 / 유지 MP) / 3, 유지 MP / 4 이하면 256)·rand % 500 + 800 (‰) | `adjustSummons` | 이식 |
| 0x0044a39d | settleAfterPlay | 두어 본 뒤: 유닛마다 주체와 거리/4만큼 HP 회복, 거리 × 10분 상태 이상 회복. 주체 진영에서 가중치 × 256 / (거리 + 12)(마스터는 / 256)가 가장 큰 유닛은 HP ≤ 6 − 거리/4, 상태 이상 ≥ (4 × 거리 + 36) × 0x4cefe8 / 10 | `adjustSummons` 안 | 이식 |
| 0x0044a5c3 | reachMap | 마스터 이동 범위의 칸과 높이 차 1 이하로 이웃한 빈 칸은 1, 마스터 이웃 칸은 2배 | `adjustSummons` 안 | 이식 |
| 0x0044a88c | bestPlace | 그 종류가 멈출 수 있고 0x44a5c3이 0이 아닌 칸 가운데 (0x4d1c70 × 16 + 0x4ead6c) × 0x44a5c3이 가장 큰 칸으로 0x44aa04. 없으면 넷 다 0 | `adjustSummons` 안 | 이식 |
| 0x0044aa04 | placeValue | (종류, x, y, 진영): MP +16(최대 MP까지)으로 그 칸에 평가용 네이티얼을 두고 0x447d97(…, 0), 칸 표시 1의 (합계 − 행동 점수)·행동 점수 최댓값과 표시 > 1의 거리 나눈 값(원작은 앞 갈래에서 표시 + 4를 남긴 채 뒤 갈래에서 다시 4를 더함) | `placeValue` | 이식 |
| 0x0044a149 | summonAtValue | (소환 값 + 0x44b616(소환 MP, 유지 MP)) × 0x4d1c70 / 0x300 + 0x4ead6c + 0x449a10 | `summonAtValue` | 이식 |
| 0x00449e53 | selfSpellValue | 자기 칸 마법 값 0x44b616 − 10000 + (축복: 진영 네이티얼마다 0x44af92(…, −1), 0이면 −2e9). 물높이 마법은 맵 구조체 +0x30이 0이면 −2e9 | `selfSpellValue` | 이식 |
| 0x004405dc | relaxRange | 이동 범위를 다음 차례로: 버킷 9~1의 칸 가운데 저장 비용이 버킷 번호보다 큰 것은 그 비용 칸으로 옮기고, 도달했지만 ZOC에 멈춘 칸은 ZOC를 지우고 다시 넣는다. 넣은 것이 있으면 1 | `RangeSearch.relax` | 이식 |
| 0x004226eb | loadSpritePage | (리소스, 페이지, 플래그): 0x483f48 + (페이지 × 16 + 0x1000) × 0x120에 그림을 풀고 DIB로 바꾼다(0x42325f). 페이지 < 710이면 다른 곳에 푼 뒤 옮긴다. 페이지 710~는 AI 작업 버퍼(0x43ff60) 자리라 연출 그림(소환 0x30000·0x30006, 0xf 등)이 그 앞부분을 덮는다 | (`aiThink` 픽스처 loads) | 확인 |
| 0x0044c8c3 | loadMapAi | 맵별 AI 자료(표 0x460634[맵] = DATA10 0xac + 맵 × 2, 0x320c8바이트)를 0x43ff60 버퍼에 읽어 0x4ead6c·0x4d1c70(i32 32×32 × 25층)·0x4ceff0·0x503d70(i32 25)으로. 크기가 다르면 0x44c5a2로 계산(52맵 모두 자료가 있음) | `readMapAi` | 이식(오라클 픽스처) |
| 0x0044c5a2 | buildMapAi | 맵별 AI 표 계산(자료가 없을 때): 층(0 마스터, 1~24 네이티얼 종류)마다 0x44c2d5·0x44c4fa, 층별 최댓값 | — | 쓰이지 않음 |
| 0x00406573 | receiveMessage | 네트워크 메시지·CPU 결정 처리: 종류 3은 0x4067b1, 0~2는 화면 스크롤 뒤 0x40672d, 4는 0x402020(승자), 5·6은 다른 처리기, 7은 다른 메시지 | `apply` | 0~3 이식 |
| 0x00452ed9 | rand | C 런타임 rand: 0x475da0 = 0x475da0 × 0x343fd + 0x269ec3, (>> 16) & 0x7fff. CPU 결정(0x446434·0x4462ef·0x4491d8)과 연출 프레임(0x412f6d)·그래픽·자동 저장 쪽이 함께 쓴다 | `Mind.rand` | 이식(오라클 픽스처) |
| 0x00401899 | restoreBattle | 중단 저장 되살리기: 그래픽(0x401a0c·0x43b6c2), 마스터 0x40f696, 지형 그래프, 맵별 AI 자료 0x44c8c3, 네이티얼 0x40fc66, 창·레지스트리, 첫 차례 준비 0x401b12 | `decodeState`(블록), `initialWeights`(AI 가중치) | 오라클 도우미 `restore_battle`(되살린 블록이 바이트까지 같음), 그래픽을 켠 `resume_screen_battle`(유닛 칸·표시 객체 풀이 블록 순서, 화면 픽스처) |
| 0x004071ea | packUnits | 실행 중 유닛 표를 블록의 36바이트 압축 레코드로 옮긴다. 빈 칸(+0x00 & 0x8000)은 건너뛰고, 유닛 수 뒤 레코드 자리는 이전 압축 바이트를 그대로 둔다 | `encodeState`(null 칸 건너뜀) | 배치 확인(`check_state_map.py`), 빈 칸(오라클 픽스처: 판 단위 차례 실행) |
| 0x0040f47e | allocUnit | 유닛 표에서 첫 빈 칸을 다시 쓰거나(0x40f42f로 플래그·소환 순번·+0x0c·상태 이상 초기화) 끝에 새 칸을 연다(최대 51, 꽉 차면 널). 명령 메뉴(0x40496f)가 진영 유닛 25개에서 소환을 끄므로 UI로는 50개를 넘지 않는다 | `summonNatial`(첫 null 칸, 없으면 끝) | 이식(오라클 픽스처: 판 단위 차례 실행) |
| 0x0040ff5c | unitAt | 좌표(x, y)에 있는 유닛을 찾는다 | `World.unitAt` | 이식 |
| 0x004174a6 | allocSprite | 표시 객체 풀에서 빈 칸을 찾거나 새 칸을 연다(최대 512) | — | 미이식 |
| 0x00441231 | savePath | 게임 폴더 + `\SAVE\SV%03d.` + 확장자(환경변수 `LOG_ID` 앞 3글자, 없으면 `DAT`) | — | 미이식 |
| 0x00441359 | readSave | 세이브 파일을 읽어 블록에 풀고 체크섬을 확인한다 | `decodeSaveFile` | 이식 |
| 0x00441401 | writeSave | 블록을 인코딩해 세이브 파일로 쓴다 | `encodeSaveFile` | 이식 |
| 0x0044147f | encodeSave | 체크섬 기록 후 바이트 뒤섞기 | `encodeSaveFile` | 이식(오라클 픽스처) |
| 0x00441546 | decodeSave | 바이트 뒤섞기 해제 후 체크섬 확인 | `decodeSaveFile` | 이식(오라클 픽스처) |
| 0x00441960 | storeWindowRects | 저장 직전 MDI 창 위치를 블록에 기록한다 | — | 미이식(③) |
| 0x00441e36 | saveContinue | 전투 중 저장: 유닛 압축 후 슬롯 100~107에 저장 | — | 미이식 |
| 0x00402272 | lightPhase | 맵 +0x34(밝기 변화 플래그)가 서 있으면 하루 중 시각으로, 아니면 맵 +0x38의 고정 값으로 밝기를 정한다(0 희미함, 1 낮, 2 밤) | `lightPhase` | 이식(오라클 픽스처) |
| 0x0040f696 | restoreMaster | 압축 레코드와 진영 레코드(192바이트)로 마스터 유닛을 되살린다. 그래픽을 읽는다(0x4227d5). AI 가중치 +0x60 = 0x9c4, +0x5c = 0x50 | `initialWeights` | 오라클 도우미로 실행 |
| 0x0040fc66 | restoreNatial | 압축 레코드와 네이티얼 표로 네이티얼 유닛을 되살린다. 맵 포인터(0x48391c)가 있어야 한다. AI 가중치 +0x60 = +0x64 = 표 +0x4c | `initialWeights` | 오라클 도우미로 실행 |
| 0x0040fe72 | natialStats | 종류·레벨·밝기로 공격·방어·마력·마법방어(밝기 보정 포함)와 속도를 정한다 | `natialStats` | 이식(오라클 픽스처) |
| 0x0045580c | runInitializers | C 초기화 표(0x45e0a8~0x45e0bc)와 C++ 정적 초기화 표(0x45e000~0x45e0a4)를 실행한다. 포인터 전역(0x476ad8 등)이 여기서 채워진다 | — | 오라클 부팅(`boot.py`)은 C++ 표만 실행한다(C 초기화 표·FPU 초기화·WinMain 나머지는 건너뜀) |
| 0x0040f910 | summonNatial | (마스터 유닛, 종류, x, y)로 네이티얼을 소환한다(0x40f47e 칸). 진영 = 마스터 진영, 소환 순번 = 두 진영 유닛 수 합, 레벨 0, HP(+0x30) 10, 경험치 0, 방향 = 마스터 방향, 자세 = 방향 × 3, OA = 0x4113da(종류 속도[0], 이동함, 0), 진영 유닛 수 +1, 진영 유지 MP += 소환 MP / 8 | `summonNatial`(rules/summon.ts) | 이식(오라클 픽스처: 판 단위 차례 실행). 다른 픽스처 준비에도 쓴다 |
| 0x0040fb43 | createNatial | (종류, 진영)으로 플래그 0x4001 네이티얼을 만든다(시나리오 배치로 추정) | `tempNatial`(CPU AI 평가용) | 이식 |
| 0x0040218f | startSideMp | 전투 시작 때 두 진영의 현재 MP를 최대 MP로, 유닛 수·유지 MP를 0으로 | `startFreeBattle` | 이식(오라클 픽스처) |
| 0x004224a0 | loadMap | 맵 스크립트·배경·팔레트·부품·격자를 읽는다(`re/maps.md`) | `loadMap` | 이식(오라클 픽스처, 배경·팔레트 제외) |
| 0x0042d190 | setupScenarioPlayer | 우리 진영: 이름(0x483efc), 마스터, 레벨(시나리오 0·Expert 22), 능력치, 시작 네이티얼·마법 | `scenarioPlayer` | 이식(오라클 픽스처) |
| 0x0042d2e9 | setupEnemyMaster | 맵의 MAS로 적 진영(Easy 레벨 낮춤, 아이템 0x42d64f) | `scenarioEnemy` | 이식(오라클 픽스처) |
| 0x00450da0 | startScenario | 시나리오 플래그·네트워크 0·맵 플래그 첫 묶음·진영 조종 → Master making | `scenarioBlock` | 이식(오라클 픽스처) |
| 0x00450e35 | startExpert | Expert(+0xc = 2, 맵 30부터) → Master making | `scenarioBlock` | 이식(오라클 픽스처) |
| 0x0045157b | scenarioProgress | 깬 맵 2, 묶음 절반 규칙으로 열기, 0x42da93(레벨 + 1·보상), 다음 장면 종류 | `progressScenario` | 이식(오라클 픽스처) |
| 0x0041bd98 | addScenarioStats | 블록 +0xd78 통계 59칸 누적 | `accumulateStats` | 이식(오라클 픽스처) |
| 0x0041bce9 | clearScenarioStats | 통계 59칸(0x482dc4)을 0으로. 부르는 곳은 0x450f4e(0x451009)와 월드 시작 0x45102d(0x4510a0; 0x45102d는 Master making 끝 0x42749c·Free Battle 0x450f45·0x450f4e가 부름) | `scenarioBlock` | 이식(오라클 픽스처) |
| 0x0042d64f | addSideItem | 아이템(0x468d60 번호, −1은 없음)을 진영의 네이티얼 목록(0x42d7d0) 또는 마법 목록(0x42d966)에 | `addItem` | 이식(오라클 픽스처) |
| 0x0042d7d0 | addSideNatial | 진영 +0x38 소환할 수 있는 네이티얼 종류 목록에 오름차순으로 넣는다(최대 24) | `addItem` | 이식(오라클 픽스처) |
| 0x0042d966 | addSideSpell | 진영 +0x1c 마법 번호 목록에 오름차순으로 넣는다(최대 6) | `addItem` | 이식(오라클 픽스처) |
| 0x0042da93 | levelUpScenario | 우리 진영 레벨 + 1·능력치 다시 계산(0x42dae0)·고른 맵의 보상 아이템(0x42da6c → 0x42d64f) | `progressScenario` | 이식(오라클 픽스처) |
| 0x0042da6c | mapReward | 맵 0~25의 보상 아이템(표 0x468f40), 그 밖은 −1 | `readScenarioData` rewards | 이식(오라클 픽스처) |
| 0x00426d90 | makeMasterWindow | Master making 창(608 × 448 DIB, 창 객체 0x4ec, 장면 2) 만들고 첫 스텝 | `MasterMakingWindow` | 이식(오라클 픽스처) |
| 0x00427166 | makeMasterStep | 스텝 기계(시나리오 0~0x19, Expert 0x32~0x45) | `MasterMaking.next` | 이식(오라클 픽스처) |
| 0x00426ff9 | makeMasterTimer | 48ms: 번쩍임 끝 → 다음 스텝, 두 틱마다 프레임(0x427882) | `MasterMaking.tick` | 이식(오라클 픽스처) |
| 0x0042930f | makeMasterClick | 답(0x427e4f)·다음 스텝, 소리 1 | `MasterMaking.click` | 이식(오라클 픽스처) |
| 0x0042937e | makeMasterHit | 답 칸 판정(입력 모드 1), 모드 2는 0 | `MasterMaking.hit` | 이식(오라클 픽스처) |
| 0x004279ea | makeMasterStars | 바탕 바꾸기·별가루(난수)·그리기(0x427ca2) | `MasterMaking.moveStars` | 이식(오라클 픽스처) |
| 0x00428ca4 | makeMasterDraw | 바탕·판·글·질문·카드·결과(0x42876c)·설명·얻은 아이템 | `MasterMaking.draw` | 이식(오라클 픽스처) |
| 0x0042842d | makeMasterResult | 점수 → 마스터(0x465f34), 0x42d190, 팔레트, 이름 상자 | `MasterMaking.next` 0xc | 이식(오라클 픽스처) |
| 0x00428542 | specialMasterName | 마스터 기본 이름이면 숨은 마스터 0x12~0x1a | `MasterMaking.special` | 이식(오라클 픽스처) |
| 0x004295e9 | masterNameDialog | 이름 상자 0x7c: OK 1~16바이트(0x42959e), Esc 무시 | `MasterMakingWindow` | 이식 |
| 0x0041becb | sceneWindow | 장면 창(장면 6): 768 × 512 DIB 팝업, 시계 0x34bc0, 스크립트 읽기 | `SceneWindow`·`SceneEngine` | 이식(오라클 픽스처) |
| 0x0041c193 | loadSceneScript | 종류·ED 번호로 스크립트(0x460168·0x460180·0x4601e8), 객체·팔레트 칸·스레드 비우기, 첫 스텝 | `SceneEngine.load`·`sceneScript` | 이식(오라클 픽스처) |
| 0x0041d7e8 | sceneScriptEnd | ED 번호 + 1: 다음 ED·보고서·타이틀, 종류 0~5는 월드 | `SceneEngine.finish` | 이식(오라클 픽스처) |
| 0x0041d843 | sceneTick | 스케줄러: 스레드 한 번씩, 끝 판정, 객체 갱신, 시계 −3(늦으면 되풀이), 그리기, 번쩍임 | `SceneEngine.tick` | 이식(오라클 픽스처) |
| 0x0041da0d | sceneInterpret | 명령 0~0x31(re/scene.md) | `SceneEngine.interpret` | 이식(오라클 픽스처) |
| 0x0041f1fa | sceneUpdate | 객체 트윈·자세 차례·알파·부모 따라가기·화면 사각형(0x420014) | `SceneEngine.update`·`area` | 이식(오라클 픽스처) |
| 0x0041f82a | sceneText | 글 객체(%M 이름, 그림자 10 → 0xb, 높이 17) | `SceneEngine.text` | 이식(오라클 픽스처) |
| 0x0041fa90 | sceneDraw | 다시 그릴 사각형(0x421c6d), 깊이·y 차례, 지우기·그리기(0x41ff02 → 0x420287 네 갈래) | `SceneEngine.draw` | 이식(오라클 픽스처) |
| 0x0041c2f2 | sceneReport | 보고서 TBREP: 바탕·팔레트, 단추 칩 굽기(0x43fac3), 세 쪽(0x41c62f·0x41d077·0x41d3c6) | `SceneEngine.report` | 이식(오라클 픽스처) |
| 0x00421fc8 | sceneReportClick | 보고서 단추 누르기(마우스 위 다시 정함, 소리 1) | `SceneEngine.click` | 이식(오라클 픽스처) |
| 0x00408034 | resultEnd | 결과 창 END: 시나리오·진영 0 승이면 통계(0x41bd98)·진행(0x45157b), 장면이면 0x41beb4 → 장면 창, 아니면 월드(0x44fd31) | `afterBattle` | 이식(오라클 픽스처) |
| 0x00429a8e | mapInfoContent | 맵 정보 내용: 시나리오면 보상(0x42da6c), 깬 맵이면 미리보기 2/3 | `mapInfoImage` reward·`worldPalette` cleared | 이식(오라클 픽스처) |
| 0x0042d473 | setupFreeBattle | 두 진영: 이름(0x468fa8), 마스터 0·1, 레벨 24, 마법 10~15, 네이티얼 1~24 | `startFreeBattle`(sideRecord) | 이식(오라클 픽스처) |
| 0x0042dae0 | masterStats | 진영 레코드의 마스터·레벨로 능력치 표를 읽어 넣는다 | `readMasterTable` | 이식(오라클 픽스처) |
| 0x0042dc10 | allocateArena | 7.3MB 메모리 덩어리를 잡고 구역 포인터 전역을 채운다(`re/maps.md`) | — | 오라클 부팅에서 원작 그대로 실행 |
| 0x00453558 | atexit | C 런타임 종료 처리 등록. 오라클에서는 등록만 성공시키는 대역 | — | 대역 |
| 0x00401019 | findStones | 작업 격자에서 마정석 칸을 모으고 맵 +0x2c8의 초기 소유를 반영해 진영 MP 회복 배수를 정한다 | `startFreeBattle`(findStones) | 이식(오라클 픽스처) |
| 0x004017a2 | startBattle | 새 전투 시작: 맵·그림 준비(0x401a0c), 통계·마정석·물높이·진영 MP 초기화, 마스터 생성, 첫 차례 준비(0x401b12) | `startFreeBattle` | 블록을 바꾸는 단계만 이식(오라클 픽스처: 블록 전체, 창·메뉴 구간 제외) |
| 0x00401b12 | firstTurn | 첫 차례 준비: 커서 객체(0x4021ee), 시각 설정(0x40224d), 창·메뉴 갱신(블록은 바꾸지 않음), 마지막에 0x40536c | `startFreeBattle`(시각), `startTurn` | 이식(오라클 픽스처: 프리 배틀 한 판, `startFreeBattle` → `startTurn` → 승패) |
| 0x0040536c | beginTurn | 쓰러진 네이티얼 정리(0x412843), 차례 받을 유닛 고르기(0x4129fb), 그만큼 시간 진행(0x4022d7). MP 부족으로 네이티얼을 없앴으면 연출 뒤 다시 한다. 전투 시작 때 첫 시간 진행도 이것이다(맵 0 기본 진영: 33분) | `beginTurn` | 이식(오라클 픽스처) |
| 0x00412843 | removeDead | HP가 1 미만인 유닛이 있으면 1을 돌려주고, 그중 네이티얼은 0x4128c8로 없앤다(유닛 표 칸은 빈 칸으로 남는다) | `removeDead`(칸을 null로) | 이식(오라클 픽스처) |
| 0x004128c8 | removeNatial | 뒤 소환 순번을 하나씩 당기고, 진영 유닛 수 −1, 유지 MP −소환 MP/8, 표시 객체와 유닛 칸을 비운다. 마스터면 OA = 1440 | `removeDead` | 네이티얼 부분 이식 |
| 0x004129fb | nextActor | OA + 상태 이상 남은 분이 가장 작은 유닛. 같으면 소환 순번이 같거나 작은 뒤쪽 유닛. 2880분 이상만 있으면 널 | `nextActor` | 이식(오라클 픽스처) |
| 0x00425755 | returnWater | 물이 돌아올 때까지 남은 분을 깎고, 다하면 단계 0은 물높이 +1(0x4255d0), 2는 −1(0x4255ff) | `advanceTime` | 이식(오라클 픽스처) |
| 0x004071bd | rebuildWorkGrid | 작업 격자를 원래 격자로 되돌린 뒤 물높이(0x4256a3)와 마정석 소유(0x4016b6, 칸 += 소유 × 12)를 반영한다. 전투 시작 때는 0x43b6c2 → 0x43cb1f 끝에서 부른다 | `workGrid` | 이식(오라클 픽스처) |
| 0x004256a3 | applyWaterToGrid | 물높이 1이면 부품 +0x63 & 4인 칸 +4, −1이면 & 8인 칸 −4 | `workGrid` | 이식(오라클 픽스처) |
| 0x004016b6 | overlayStones | 마정석마다 작업 격자 칸 += 소유(0·1·2) × 12 | `workGrid` | 이식(오라클 픽스처) |
| 0x00440210 | buildTerrainGraphs | 이동 타입 5개마다 칸(31바이트) 1024개의 그래프(0x49dfc0 + 타입 × 0x7c00): 좌표, 멈출 수 없는 지형 플래그 2(표 0x473fa0), 6방향 이웃 비용(표 0x473f48, 격자 밖 0x7f). 비행이 아니면 높이(부품 +0x61) 차이 > 1은 0x7f, 오르막은 +1 | `terrainGraph` | 이식(오라클 픽스처, SHA-256) |
| 0x004404c9 | movementRange | 그래프를 작업 버퍼 0x4c4bf0에 복사(0x440458, 칸 +0x13 = 이동력 + 1) → 다른 유닛 칸 멈출 수 없음·적 칸 못 감(0x440e74) → 상태 이상 없는 적의 이웃 ZOC(0x440f33, 비행 제외) → 시작 칸(0x440567) → 10칸 고리 버킷으로 이동력 + 1번 넓히기(0x440763, 0x440827: 버킷을 높이 내림차순 삽입 정렬 후 처리) | `movementRange` | 이식(오라클 픽스처, SHA-256) |
| 0x00440ba9 | canStop | 작업 버퍼 칸 +0x12 & 8 | `canStop` | 이식 |
| 0x00440bcd | pathStep | 도착 칸부터 도착 방향(+8+k)·이전 비용(+0x14+k)을 거꾸로 따라가 지금 칸의 다음 칸으로 위치를 옮기고 방향을 정한다(0x417957) | `walkPath` | 이식(오라클 픽스처) |
| 0x00417957 | setDirection | 위치 객체 +0x0a = 방향, +0x0b = 방향 × 3 + (+0x0b % 3) | `moveUnit` | 이식 |
| 0x00406c5b | moveTo | 제자리면 바로 다음 처리, 아니면 0x41377b로 이동 연출 | `moveUnit` | 이식 |
| 0x0041377b | startWalk | 이동 연출을 대기열에 넣는다: 정렬 키 1·종류 0, 걷기 0x415829, 비행 0x415a11(경로 최대 높이 0x440ca4 + 4까지 떠오름) | `moveUnit`, `Stage.walk` | 이식(오라클 픽스처 moves·walk) |
| 0x00415829 | walkEffect | 6프레임마다 0x440bcd로 한 칸(그 사이는 0x4177ee로 지금 칸 쪽으로 물러섬, 내려갈 때는 높은 칸 높이로). 2프레임마다 위치 객체 +0x12 += 2(8이면 0), +0x0b 프레임 부분 갱신. 도착하면 0x412b50·키 0·연출 끝 | `moveUnit`(위치·방향), `Stage.walk` | 이식(오라클 픽스처 walk) |
| 0x00415a11 | flyEffect | 비행: 떠오름(틱마다 한 층) → 걷기와 같은 이동(지형 종류 0xb 위면 그림자 끔) → 내려앉음 | `Stage.walk` | 이식(오라클 픽스처 walk) |
| 0x00412f6d | runFrame | 연출 대기열 콜백을 모두 실행하고(부를 때마다 처음부터), 표시 객체 애니메이션(풀 0x47c2b0, +0x11 종류: 1 대기, 2 튀어 오름, 3 표식 돌기, 4 상대 표식, 5 범위 표식 흔들기, 6 차례 유닛 깜빡임, 덧그림 프레임)을 갱신한다. 살아 있던 연출이 모두 끝난 틱에 1 | `Stage.tick` | 이식(오라클 픽스처 walk, 종류 2·4 제외) |
| 0x00401616 | canCapture | 작업 격자 칸이 마정석 부품(+0x63 & 0x80)이고 그 진영 것이 아니면 참 | `canCapture` | 이식(오라클 픽스처) |
| 0x00401401 | captureStone | 이전 소유 진영 회복 배수 −1, 새 진영 +1, 소유 = 진영 + 1, 작업 격자 칸 다시 계산. 마정석 부품 가드(+0x63 & 0x80)가 있다. 0x40124c는 가드 없이 같은 규칙에 화면 갱신을 더한 것(실제 게임 경로, 마정석 칸은 늘 그 비트를 가져 결과가 같음) | `captureStone` | 이식(오라클 픽스처) |
| 0x0040623b | afterAction | 행동 뒤(되풀이): 쓰러진 유닛 정리(0x412843) → 공격으로 마스터가 쓰러졌으면(0x476b28, 0x40354b가 둠) 사라짐 연출만 하고 다시 / 행동 주체가 남의 마정석 위면 점령(0x41481d → 0x40124c) / 경험치가 있고 주체가 남아 있으면 경험치 보정(0x412ca0)·종류별 경험치 통계·반영 연출(0x4147f2) / 아니면 승패 확인(0x40612c), 이어지면 +0x2dc = 0, 다음 차례(0x40536c) | `afterAction`(turn.ts) | 이식(오라클 픽스처: 판 단위 차례 실행) |
| 0x0040672d | runCommand | 받은 명령: 유닛이 이동할 칸에 없으면 이동 범위(0x4404c9) 후 0x406c5b로 이동, 끝나면 0x4067b1 | `applyCommand` | 이식(오라클 픽스처: 차례 실행) |
| 0x004067b1 | runCommandAction | 종류별: 0 방향(0x417957) 뒤 대기(0x406cd2), 1 방향 뒤 행동(범위 종류 5이거나 대상이 제자리면 0x406cd2(1, 행동), 아니면 화면 스크롤 확인 0x406ad9·0x406b3a 뒤 0x406d13), 2 소환(0x406d13), 3 되돌리기(대상 칸 화면 스크롤 뒤 0x406a69 → 0x406d13). 2·3은 명령의 방향을 쓰지 않는다 | `applyCommand`(받은 명령 `'received'`는 범위 종류 5면 주체 칸) | 이식(오라클 픽스처: 판 단위 차례 실행, CPU끼리 둔 판) |
| 0x00406cd2 | runSelfCommand | 주체 위치 객체의 칸을 대상으로 0x406d13. CPU는 범위 종류 5 마법에 이전 기록의 대상 칸을 남겨 보내지만 이 경로라 결과는 자기 칸 실행과 같다 | `applyCommand`(`'received'`) | 이식(오라클 픽스처: CPU끼리 둔 판) |
| 0x0040546d | waitInput | 입력 대기 처리기. +0x2dc == 0이면 차례 시작 지형 효과(지형 종류 5면 HP −3, 마정석 부품이면 +1, 이동 타입이 멈출 수 없는 지형이면 −3), +0x2dc = 1, 자동 저장(0x442045). 쓰러지면 사라짐 연출 후 0x40623b. 그 밖에는 +0x2dc와 상관없이 매번 차례 시작 위치(0x476b40) 저장(0x4055cf), CPU면 AI(0x445b20) | `startTurn`(지형 효과) | 일부 이식 |
| 0x0041798c | faceTarget | 대상 칸 쪽으로 방향을 돌린다(회전 표 1, 4, 3, 2, 5, 0) | `facing` | 이식(오라클 픽스처: 차례 실행) |
| 0x00414939 | runScript | 연출 스크립트 해석기. i32 명령이 점프 없이 이어지고 0x31에서 끝난다. 타격: 0x2c 나머지 전부, 0x2d n/10, 0x2e·0x2f 둘레(거리 d = 명령 − 0x2d ≤ 행동 효과 반경일 때, 방향 k마다 j = d~1: 0x440dba로 k j걸음 뒤 (k+1) % 6 d − j걸음 칸에 새로 계산한 전부), 0x2b 특수(0x403aaa). 몫 누적이 0일 때 타격은 데미지·경험치를 새로 계산하고, 마지막 타격(0x2c)은 계산 때의 HP로 되돌린 뒤 데미지 전부를 뺀다 | `readHits`(effectScript.ts), `strike`·`ringCells` | 타격·특수 이식(오라클 픽스처) |
| 0x00416929 | projectileEffect | 투사체가 닿으면 대상 칸에 새로 계산한 데미지 전부(0x40354b(…, 1, 0, …, 10)) | `applyCommand` | 이식 |
| 0x00401ec3 | endBattle | 승자 표시 0x476b3c(1 진영 0 마스터 쓰러짐, 0 진영 1, −1 둘 다 "You have come to a confrontation")와 결과 화면 | `afterAction`(winner, `DRAW` = −1) | 승자만 이식(결과 화면은 ③) |
| 0x00403a62 | damage | HP를 n만큼 깎아 0~10으로 자르고, 0이 되었는지 돌려준다 | `advanceTime`(MP 부족) | 일부 이식 |
| 0x0041461a | vanishEffect | 사라지는 연출을 대기열에 넣는다(네이티얼: 스크립트 0x45fcfc, 마스터: 0x416129). 마스터 연출은 방향을 (방향 + 1) % 6, 자세 = 방향 × 3 + 1로 돌리다 방향 4에서 다음 단계로 간다 | `afterAction`(쓰러진 마스터 방향 4) | 마스터 방향만 이식(나머지는 화면 ③) |
| 0x00412ed3 | allocEffect | 연출 대기열(0x47a3a8, 0x7c바이트 × 64)에서 빈 칸을 찾거나 연다. 꽉 차면 널 | — | 화면(③) |
| 0x0040354b | applyActionToTarget | 맞는 순간 칸 하나에(인자: x, y, 새로 계산, 몫 타격, 기억한 데미지*, 몫 n, 기억한 HP*). 원점 = 효과 반경 0이면 주체 칸, 아니면 지정 칸. 지정 칸 기준 효과 범위(0x410d77)가 거짓이거나 칸에 유닛이 없으면 끝(시야 불꽃 연출만). 종류 2 상태 이상: 지속 = 0x411425, 지속 < 대상 남은 분이면 끝, 경험치 += 0x411556, 비트(세부 0·1·2 → 1·2·4)와 남은 분을 바꿈. 종류 3 풀기: 경험치 += 0x411556(…, 0), 비트·남은 분 0. 그 밖(데미지, 회복은 음수): 새로 계산이면 0x410fda·경험치 0x411484(기억 칸이 있으면 데미지·HP를 기억), 몫이 아니면 HP를 기억한 값으로 되돌린 뒤 전부, 몫이면 (d × n + 5)/10. 마스터 HP가 0이 되면 0x476b28 = 1 | `strike`(turn.ts) | 이식(오라클 픽스처: 판 단위 차례 실행) |
| 0x00410fda | damage | 회복: −((0x45f6a0[마력 + 위력] + 0x7f) >> 8). 그 밖: d = 능력 차 + 위력 + 속성 상성 + 대상 방향 기준 원점 자리(+4~+8), (곡선[d] × 지형 방어율 / 100 + 0x7f) >> 8, 최대 10 | `damage` | 이식(오라클 픽스처) |
| 0x00411484 | damageExp | 데미지·회복으로 얻는 경험치(네이티얼만) | `damageExp` | 이식(오라클 픽스처) |
| 0x00411556 | statusExp | 상태 이상을 걸거나 풀어 얻는 경험치 | `statusExp` | 이식(오라클 픽스처) |
| 0x00411425 | statusMinutes | 상태 이상 지속 = 0x45f7d0[마력 + 위력] | `statusMinutesOf` | 이식(오라클 픽스처) |
| 0x004112e9 | previewDamage | 화면용 예상 데미지(방향 +5 고정) | `actionValue` 안 | 이식 |
| 0x00412ca0 | capExp | 경험치 + 얻는 양 > 100이면 얻는 양 = (얻는 양 − 경험치)/2 + 50 | `cappedExp` | 이식(오라클 픽스처) |
| 0x00412cc9 | addExp | 경험치를 더하고 100마다 레벨 +1·능력치 재계산, 최대 레벨이면 100. 연출 0x4147f2 → 0x4167a4가 2씩 나눠 부른다 | `addExp` | 이식(오라클 픽스처) |
| 0x0041074b | inRange | 행동 범위 종류(+0x08)별 사거리: 0·3 거리 + 높이 차/2, 1 포물선 0x4100f8, 2 직선 시야 0x41090b(여유 2, 유닛 가림) | `inRange` | 이식(오라클 픽스처) |
| 0x0040ffcd | hexDistance | 육각 거리 | `hexDistance` | 이식 |
| 0x0041090b | straightSight | 거리 + |높이 차|/2 ≤ 사거리, 2배 x 좌표로 육각 선을 따라 칸마다 0x410cb8(보간 높이 + 여유 < 칸 높이면 가림, 지형 16 가림·11 통과, 유닛 가림 선택) | `straightSight` | 이식(오라클 픽스처) |
| 0x004100f8 | arcSight | 거리 + (높이 차)/2 ≤ 사거리, 포물선 계수(0x410499, float32 저장)로 칸마다 높이를 구해 0x410646으로 가림 판정 | `arcSight` | 이식(오라클 픽스처) |
| 0x00410d77 | inArea | 같은 칸이면 범위 종류 != 4, 아니면 직선 시야(반경 = 행동 +0x0a, 여유 1, 유닛 무시) | `inArea` | 이식(오라클 픽스처) |
| 0x00405cfe | attackMenu | 공격 메뉴: 행동 = 유닛 +0x08 → 0x405d18 | `applyCommand`(대상 규칙) | 이식 |
| 0x00405d18 | actionPicked | 행동을 고른 뒤(공격·마법 공통): 비용 > 진영 MP면 막음(0x419baa). 범위 종류 4는 지정 칸 = 자기 칸으로 확인 단계(6), 5는 곧바로 0x406cd2(1, 행동), 그 밖은 대상 고르기(4) | `applyCommand`(MP), `actionTargets` | 이식(오라클 픽스처) |
| 0x0040416f | pickTarget | 대상 고르기(0x403fb0 상태 4)에서 칸을 누르면: 지정 칸 = 그 칸. 효과 반경 0이면 칸에 유닛이 있고 0x410e3d면 시전, 반경이 있으면 0x41074b면 확인 단계(6) | `actionTargets` | 이식(오라클 픽스처) |
| 0x00410e3d | canTarget | (주체, 행동, 대상 유닛): 회복(1)·풀기(3)는 같은 진영, 그 밖은 다른 진영이어야 하고 0x41074b | `canTarget` | 이식(오라클 픽스처) |
| 0x00413c45 | magicScriptEffect | (주체, 행동, x, y): 해석기 0x414939 연출, 지정 칸, 스크립트 = 0x422c16(행동, 1) = 표 0x4612b4[행동] | `readActionScripts`, `strike` | 이식 |
| 0x004141fd | castAnimation | 네이티얼 마법 시전 동작: 지정 칸 쪽으로 돌고(0x41798c) 자세 ×3 + 1, 시전 스크립트(표 0x460fc8, 타격 없음) | `applyCommand`(방향) | 이식 |
| 0x00413b45 | masterMagicEffect | 마스터 마법: 0x413c45를 주체 칸에 만들고 지정 칸으로 옮긴 뒤 0x414397(지정 칸 쪽으로 돌기) | `applyCommand` | 이식 |
| 0x00413e7c | magicProjectileEffect | 마법 투사체(0x416a4d, 타격 없음) + 0x4141fd + 0x413c45 | `applyCommand` | 이식 |
| 0x00403aaa | scriptSpecial | 스크립트 0x2b: 행동 종류 4면 0x42562e(물높이 단계·남은 분, 위치 객체 다시 구함)·그래프 0x440210, 5면 0x412d32(주체, 0) | `strike` | 이식(오라클 픽스처) |
| 0x00412d32 | bless | 주체 진영의 네이티얼(0x4000) 모두 HP +1(0x403a62(…, −1), 최대 10) | `strike` | 이식(오라클 픽스처) |
| 0x004255d0 | raiseWater | 물높이 < 1이면 +1 후 작업 격자 다시(0x4071bd). 바뀌었는지 돌려준다 | `applyCommand`(Uptide), `advanceTime` | 이식 |
| 0x004255ff | lowerWater | 물높이 > −1이면 −1 후 작업 격자 다시. 바뀌었는지 돌려준다 | `applyCommand`(Downtide), `advanceTime` | 이식 |
| 0x00417bed | refreshPositions | 표시 객체 풀(0x47c2b0, 0x16바이트)에서 쓰는 객체 모두 0x417542 | (`summonCells`가 지금 칸 높이를 쓰는 근거) | 확인 |
| 0x00440dba | stepN | (x, y, 방향, n): n걸음, 격자 밖이면 x = −1 | `ringCells`, `stepN` | 이식 |
| 0x00413820 | startAction | 행동 표 +0x0c 번호로 연출 시작 함수(0x45f8d0)를 부른다: 0 공격 0x413852(유닛 스크립트 +0x07), 1 네이티얼 마법 0x413b12(0x413c45 + 0x4141fd), 2 마스터 마법 0x413b45(0x413c45 + 0x414397), 3 마법 투사체 0x413e7c(0x416a4d + 0x4141fd + 0x413c45). 공격·마법 모두 주체가 지정 칸 쪽으로 돌고 자세 = 방향 × 3 + 1 | `applyCommand`, `strike` | 이식(오라클 픽스처: 판 단위 차례 실행) |
| 0x00406d13 | sendCommand | 명령을 결과 창 통계·Used MP에 반영하고 실행. 네트워크 대전이면 u16 두 개(x·y·방향·종류 / 번호·대상 x·y)로 보낸다. 지정 칸(0x476af8)·행동(0x476ae8)을 두고 경험치 누적·마스터 쓰러짐 표시를 0으로. 종류 1 행동: 마스터면 통계[행동 − 7](종류 0·세부 0이면 칸 2), Used MP += 비용, 물높이 마법(종류 4·범위 종류 5)은 여기서 0x4255d0(세부 0)·0x4255ff, 처리기 0x406045, 0x413820, MP −= 비용(0x407190). 종류 2 소환: 통계[8 + 종류] +1, Used MP += 소환 MP, 0x414059(연출, 0x414397이 마스터를 대상 칸 쪽으로 돌린 뒤 0x40f910), MP −= 소환 MP(0x407190), 처리기 0x4060b9. 종류 3 되돌리기: 대상 칸 유닛(0x40ff5c) HP −10, 사라짐 연출, 처리기 0x40536c(행동 뒤 흐름 없음: +0x2dc가 1로 남아 다음 유닛은 차례 시작 지형 효과를 받지 않는다) | `applyCommand` | 이식(오라클 픽스처: 판 단위 차례 실행) |
| 0x004127bb | markSummonCells | 소환 칸 선택(메뉴 상태 5): 칸마다 0x410055(주체, x, y) == 1이고 0x4126d7을 만족하면 표시(y 바깥, x 안쪽) | `summonCells` | 이식(오라클 픽스처: 판 단위 차례 실행) |
| 0x004126d7 | canSummonAt | (주체, 종류, x, y): 그 종류의 이동 타입(표 +0x48)이 칸 지형에 멈출 수 있고(0x473fa0), 주체 위치 객체 +8(칸 높이, movsx)과 칸 높이 차가 1 이하이고, 칸에 유닛이 없다 | `summonCells` | 이식(오라클 픽스처). 주체 높이는 지금 칸 높이와 같다(0x417542 행) |
| 0x00410055 | unitDistance | 유닛 위치와 칸의 육각 거리(0x40ffcd와 같은 식) | `hexDistance` | 이식 |
| 0x00405dcc | summonMenuPick | 소환할 종류를 고르면 소환 MP > 진영 MP일 때 막고(0x419baa), 아니면 칸 선택(상태 5)으로 | `applyCommand`(MP 확인) | 이식 |
| 0x0040496f | commandMenu | 이동 뒤 명령 메뉴(입력 상태 3): 대기는 늘 켬. 주체 칸 지형이 그 이동 타입(+0x28)이 멈출 수 없는 곳(0x473fa0)이면 공격·마법·소환을 끈다. 아니면 공격 = 0x410f40(공격 행동), 마법 = 마법 중 하나라도 0x410f40, 소환 = 마스터이고 진영 유닛 수(+0x08) ≤ 24 | `applyCommand`(지형·25개 규칙), `actionTargets` | 이식(오라클 픽스처) |
| 0x00410f40 | hasTarget | (유닛, 행동): 범위 종류 5이거나 효과 반경이 있으면 참, 아니면 0x410e3d를 통과하는 유닛이 있으면 참 | `actionTargets`(비었는지) | 이식 |
| 0x004045ee | rightClick | 오른쪽 클릭: 입력 상태 1(이동 전)이면 칸의 유닛을 0x476b30에 두고 유닛 메뉴(상태 7), 그 밖은 앞 상태로 되돌림 | `applyCommand`(되돌리기는 이동 전) | 이식 |
| 0x00404c02 | unitMenu | 유닛 메뉴: 되돌리기 항목은 누른 유닛이 주체와 같은 진영이고, 그 진영이 사람(제어 0)이며, 누른 유닛이 마스터가 아니고, 주체가 그 진영 마스터일 때만 켠다 | `applyCommand`(되돌리기 규칙) | 이식(오라클 픽스처) |
| 0x00405f13 | returnMenu | 되돌리기(유닛 메뉴 0x404c02의 처리기, 0x45e298 표 14번): 메뉴를 연 유닛(0x476b30)의 칸을 대상으로 0x406d13(3, …). 명령의 이동 칸은 주체(마스터)의 지금 칸 | `applyCommand` | 이식(오라클 픽스처: 판 단위 차례 실행) |
| 0x00407190 | spendMp | 진영 MP −= n | `spendMp`(turn.ts) | 이식 |
| 0x00417542 | updatePosition | 위치 객체의 높이(+8·+9 = 칸 부품 +0x61)와 화면 좌표(+2·+3)를 칸에서 다시 구한다. 걷기·소환·되살리기, 그리고 0x417bed(0x42562e 끝: 모든 표시 객체)가 부른다. 물높이는 0x4255d0·0x4255ff 직후 잠깐 낡지만 그 경로는 모두 0x42562e로 이어진다(시간 진행 0x402742, 마법 스크립트 0x2b → 0x403aaa) | `summonCells`(주체 높이 = 지금 칸 높이) | 이식(오라클 확인) |
| 0x00405fd7 | afterStandBy | 이동함 = 차례 시작 위치(0x476b40)와 다름, OA = 0x4113da(속도, 이동함, 0) → 0x40623b. 행동 뒤 0x406045는 행동 번호로, 소환 뒤 0x4060b9는 행동 1로 같은 일 | `applyCommand` | 이식(오라클 픽스처: 판 단위 차례 실행) |
| 0x0040612c | checkDefeat | 마스터 HP < 1인 진영의 네이티얼을 모두 HP −10·사라짐 연출 하고 처리기를 0x40623b로, 남은 네이티얼이 없으면 전투 끝(0x401ec3). 마스터가 쓰러졌으면 1을 돌려준다(이때 +0x2dc는 1로 남는다) | `afterAction` | 이식(오라클 픽스처: 판 단위 차례 실행) |
| 0x004255bb | resetWaterLevel | 물높이(블록 +0xba0)를 0으로 하고 0x42562e를 부른다 | `startFreeBattle`(블록 값) | 이식 |
| 0x0042562e | applyWaterLevel | 물높이 −1·0·1에 따라 블록 +0xba4를 0·1·2, +0xba8을 120·0·120으로, 끝에 0x417bed(표시 객체 풀 0x47c2b0의 모든 객체를 0x417542로 다시 구함) | `advanceTime`, `startFreeBattle` | 이식(오라클 픽스처) |
| 0x0040224d | setTime | 하루 중 시각을 정하고 팔레트·화면을 갱신한다 | `startFreeBattle`(시각) | 시각 부분만 이식 |
| 0x004022d7 | advanceTime | 경과 분만큼 유닛 OA(상태 이상이면 남은 분 먼저)를 깎고, 정각마다 진영 MP += 마스터 마력 × 회복 배수 − 유지 MP. 모자라면 소환 순번이 작은 네이티얼부터 HP −10 하며 소환 MP/8씩 돌려받는다(정리 전이라 HP 0인 네이티얼도 다시 고름). 넘치면 최대 MP로. 시각·누적 시각·수위 갱신 | `advanceTime` | 이식(오라클 픽스처) |
| 0x00407c39 | resetBattleStats | 누적 시각과 진영별 전투 통계를 0으로 | `startFreeBattle`(누적 시각 0) | 이식 |
| 0x0040f521 | createMasters | 맵의 시작 위치·방향에 두 마스터를 만들고 OA를 정한다 | `startFreeBattle`(masterUnit) | 이식(오라클 픽스처) |
| 0x004113da | oaCost | (속도, 이동함, 행동) → OA | `oaCost` | 이식(오라클 픽스처) |
| 0x00450ed7 | freeModeMenu | 프리 모드: 모드 셀(블록 +0x8·+0xc·+0x10), 맵 선택 플래그 52개(+0x198), 진영 설정(0x42d473), 진영 0 사람·1 CPU, 0x45102d | `startFreeBattle` | 블록 부분만 이식(오라클 픽스처는 원작 함수를 창 대역과 함께 실행) |
| 0x00450f4e | freeModeMenu2 | 0x450ed7과 같고 +0x10 = 1, 진영 1 제어 2(네트워크 대전 쪽으로 추정, 0x483f60 == 2면 창 단계가 다름) | — | 미이식 |
| 0x0045102d | freeModeWindows | 맵 선택 −1(+0x2d4), +0x14 = +0x10이 0이면 3·아니면 1, 창 표시 플래그(+0x288·+0x294·+0x2bc·+0x2c8), 창 배치(0x4510ca·0x4516f4) | `startFreeBattle`(+0x14), Play Free Battle(창 구간 비우기) | 이식 |
| 0x0043b8a8 | buildTerrainLists | 물 프레임 4개마다 화면 칩 65 × 84의 지형 겹 목록(0x48e654[프레임])을 짓는다(칩마다 0x43be78, 덮기 0x43c1e1, 넣기 0x43e05b). 다 덮인 칩 표시 0x48f6c8 | `terrainLists` | 이식(오라클 픽스처) |
| 0x0043c374 | patchStoneChips | 마정석 점령(0x40124c) 뒤 네 프레임 목록에서 그 칸의 칩 번호만 새 부품 것으로 바꾼다. 다시 지은 목록과 결과 픽셀이 같다(맵 52) | (`terrainLists`로 다시 지음) | 확인 |
| 0x0043d636 | composeLists | 지형 목록(물 프레임 0x49de20) 복사 → 강조·커서 칩 +0x400 → 하늘(0x43d913) → 그림자(0x43dd39) → 정렬 키 순 몸(0x43daab) | `terrainLists`·`dimTerrain`·`addSky`·`addSprites` | 이식(오라클 픽스처) |
| 0x0043d535 | skyTick | 하늘 줄마다 틱 수가 주기에 닿으면 스크롤(0x48f664) += 이동, 프레임 차례(0x48e650) 한 칸 | `skyTick` | 이식(오라클 픽스처) |
| 0x0043ef06 | drawChip | 화면 칩 하나: 앞 겹부터 투명(0x10) 자리만 채움, 첫 겹은 통째(어긋남·색 바꿈·가림 무늬). 합성 칩 캐시(0x48f6bc, 칩 0x800~)를 쓰는 갈래와 픽셀이 같다 | `drawChip` | 이식(오라클 픽스처) |
| 0x00417542 | placeSprite | 표시 객체 위치: 칩 x = (y & 1) + 2x, 칩 y = 2y + 23 − 칸 높이, 그릴 높이 = 칸 높이 | `unitSprite` | 이식(오라클 픽스처) |
| 0x00412b50 | unitLook | 유닛 상태 이상 → 표시 객체 종류·색 바꿈 선택·덧그림 | `unitSprite` | 이식(오라클 픽스처) |
| 0x004227d5 | loadUnitGraphics | exe 0x460704[(그림 × 2 + 진영)] 리소스를 그림 페이지에(유닛 칸 k = 페이지 14k + 10, 0x40f42f) | `loadUnitGraphics` | 이식(오라클 픽스처) |
| 0x004029ab | timePalette | 하루 중 시각으로 팔레트 6~0x75번을 다시 계산(맵 +0x34 = 0이면 맵 배율만). 0x41b08f가 DIB 색 표 10~245번에 | `timePalette` | 이식(오라클 픽스처) |
| 0x00403020 | battleTimer | 대기 루프(0x44db4f)가 48ms마다(16ms 카운터 3) 부른다: 하늘(옵션 & 1), 2틱마다 커서 프레임, 4틱마다 물 프레임(옵션 & 2)·상태 창 그림(옵션 & 6, 0x40aff3), 틱마다 0x412f6d, 연출이 다 끝나면 이어 하기 0x476b2c | `Stage.tick` | 이식(오라클 픽스처 walk, 옵션 메뉴는 ③b-5) |
| 0x00452ecf | srand | 시작 때 GetSystemTime의 분·60000 + 초·1000 + 밀리초로 시드 | `seedFromClock` | 이식 |
| 0x004031c5 | cellAt | 픽셀(확대 1) → 칸(지형 목록과 같은 차례로 칸 윗면·앞면) | `cellAt` | 이식(오라클 픽스처) |
| 0x004033ee | directionAt | 칸 중심에서 픽셀 쪽 방향(좌우·기울기 1/3) | `directionAt` | 이식(오라클 픽스처) |
| 0x0040484b | setInputPhase | 입력 단계(0x476af4)를 바꾸며 앞 단계 정리(0x4052b8) 뒤 진입 함수 표 0x45e244 | `session.ts` | 이식(단계 1~0x14, re/ui-input.md) |
| 0x00411a79 | reachFrom | 유닛이 선 칸에서 행동이 닿는 칸 되돌리기(효과 반경 0·1, 2 이상은 없음) | `rangeView.ts` | 이식(오라클 픽스처) |
| 0x00411e8f | reachWithMove | 멈출 칸마다 위치 객체를 옮겨 0x411a79 | `rangeView.ts` | 이식(오라클 픽스처) |
| 0x004122b2 | areaCentersFor | 이동+마법 범위 안에서 그 칸을 효과 범위에 넣는 중심 | `rangeView.ts` | 이식(오라클 픽스처) |
| 0x004115dc | hasRangedSpell | 사거리(행동 +9)가 0이 아닌 마법이 있는가 | `hasRangedSpell` | 이식 |
| 0x00403fb0 | pressLeft | 왼쪽 누름: 단계별 유닛 고르기·이동·방향·대상·소환 칸·효과 범위 실행 | `press` | 이식 |
| 0x004045ee | pressRight | 오른쪽 누름: 앞 단계로, 단계 1은 유닛 메뉴 | `pressRight` | 이식 |
| 0x0040496f | commandMenuPhase | 명령 메뉴 켬: 멈출 수 있는 칸, 0x410f40(쓸 수 있는 행동), 진영 유닛 ≤ 24 | `menuEnabled` | 이식 |
| 0x00404c02 | unitMenuPhase | 유닛 메뉴 켬 10칸(마법·효과 반경 마법·되돌리기) | `unitMenuEnabled` | 이식(Detail Info는 ③b-4a) |
| 0x004027e3 | darkPalette | 팔레트 0x76~0xe5 = 6~0x75번의 (v − 20)/3. 사람 입력 시작·범위 보이기·유닛 메뉴 닫기 | `darkenPalette` | 이식(오라클 픽스처) |
| 0x004165bb | scrollStep | 화면 이동 연출 객체 처리기: 한 단계(가로 먼저 48px, 다음 세로), 다 오면 끝 | `scrollStep`·`centerOn`, `Stage.scrollTo` | 이식 |
| 0x00414059 | summonEffect | 소환 연출: 소환 스크립트 0x45f9ac, 모으기 0x414397, 새 유닛 0x40f910(숨김), 소환 그림 둘 | `flow.ts` summon | 이식(오라클 픽스처) |
| 0x0041481d | captureEffect | 마정석 점령 연출(스크립트 0x45fd5c, 0x32에서 0x4168ea → 0x40124c) | `flow.ts` capture | 이식(오라클 픽스처) |
| 0x004167a4 | expBar | 경험치 반영 연출(0x4147f2): 6틱 쉬고 틱마다 +2, 6틱 쉼 | `flow.ts` ExpEffect | 이식(오라클 픽스처) |
| 0x0044dd9f | winMain | 프레임 FALCOMVM2MAIN(메뉴 0x66, 가속기 0x8e, 아이콘 0x7e) 최대화, MDICLIENT, 창 클래스 FALCOMCHILD·VANTAGEPOPUP | `FrameWindow`·`MdiChild`(src/ui/frame) | 이식(가상 화면) |
| 0x00407334 | updateMenu | 메뉴 켬·체크(장면·창 유무)와 프레임 제목 | `menuState`·`frameTitle` | 이식 |
| 0x00451361 | arrangeBottom | 채팅·도움말 창 자리(나란히 또는 위아래) | `worldLayout` | 이식(오라클 픽스처) |
| 0x004510ca | worldLayout | 월드 창(768 × 512, 스크롤 크기 맞춤), 맵 정보·마스터 정보 창 자리, 전장 확대 −1 | `worldLayout` | 이식(오라클 픽스처) |
| 0x0040e3be | battleLayout | 미니맵 오른쪽 위, 정보 창 그 아래, 전장 창 남은 왼쪽(아래는 채팅·도움말 위) | `battleLayout` | 이식(오라클 픽스처) |
| 0x00443d19 | playSound | 일반 효과음(번호 0~13, 버퍼 둘, 우선순위 SND_NOSTOP) | `Sound`(sound.ts) | 이식 |
| 0x00443e38 | loopSound | 반복 효과음(SND_LOOP, 경험치 막대) | `Sound` | 이식 |
| 0x00443f0a | loadEffectSound | 연출 효과음 칸에 미리 읽기(상태 2면 먼저 끔) | `Sound`, `preloadSounds`(0x4157bf) | 이식(오라클 픽스처: 호출) |
| 0x00443f4b | playEffectSound | 연출 효과음 칸 내기(스크립트 0x34 등) | `Sound` | 이식(오라클 픽스처: 호출) |
| 0x004147b3 | scrollEffect | 화면 이동 연출 객체(처리기 0x4165bb, 목표 점 +0x20·+0x24) | `Stage.scrollTo` | 이식 |
| 0x0041a73f | drawCommandMenu | 명령 메뉴 그림(DATA00 3번)에 항목 이름(0x46004c)을 비트맵 글꼴(0x424707)로 | `commandMenu` | 이식(오라클 픽스처) |
| 0x00444ec8 | fillNatialInfo | 네이티얼 정보 칸(0x6f·0x81·0x7f): 미리보기 유닛(0x40fb43 → 0x40fe72(레벨, 밝기))의 이름·속성·성향·능력치·이동, 소환 MP·유지(/8), 공격 이름·사거리 글, 마법(없으면 None과 빈 칸), 그림 페이지 0x2e6 | `natialInfo`·`unitPortrait`(infoDialogs.ts) | 이식(오라클 픽스처) |
| 0x00444c2b | infoRadios | 레벨·밝기 라디오: 체크(밝기 0 Lettle Bright, 1 Bright, 2 Dark), 켬(허용 +0x28·유닛, 밝기는 성향 ≠ 0·맵 +0x34 ≠ 0) | `infoRadios` | 이식(오라클 픽스처) |
| 0x004258ca | selectMagic | 마법 목록 선택이 바뀌면 소리 0, 종류·이름·사거리·사거리 글·효과 글·MP, 그림(0x4228b2·0x422a89 묶음 7), 도움말 0x424fd5 | `magicInfo`·`magicPicture` | 이식(오라클 픽스처) |
| 0x00444376 | fillMasterInfo | 마스터 정보(0x80): 진영 레코드만(이름 & → &&, 레벨 + 1, "Max HP" = 최대 MP, 속성·성향·이동 고정), 그림 페이지 0x2d8 | `masterInfo` | 이식(오라클 픽스처) |
| 0x00402902 | basePaletteShade | 대화 상자 초기화: 팔레트 0x76~0xe5 = 기본 팔레트 6~0x75번(시각 보정 없음) | `Shade` 'base' | 이식 |
| 0x0041b878 | attachChild | 자식 대화 상자를 가장 안쪽에 붙이고 부모를 끈다 | BattleWindow 대화 상자 쌓임 | 이식 |
| 0x00419cea | attachToPopup | 팝업에 대화 상자: 비었으면 팝업을 숨기고 부모로, 아니면 0x41b878 | BattleWindow `popupHidden` | 이식 |
| 0x0041bbfc | fitPicture | 그림 사각형에 정수 배율로 가운데 | `fitPicture`(dialogLayout.ts) | 이식 |
| 0x00401ec3 | battleEnd | 승자·이름 진영·문구·이김, 알림판, BGM, 다음 0x4020dc | `battleEndText`, BattleWindow | 이식(시험) |
| 0x00402020 | surrender | "<항복 진영> has surrendered", 승자 = 다른 진영 | `battleEndText(…, surrendered)` | 이식(시험) |
| 0x0042e090 | notice | 알림판 만들기(폭 공식, 프레임 가운데, 프레임 끔) | `noticeWidth`·`noticeAt`, `NoticeBoard` | 이식(오라클 픽스처) |
| 0x0042e38f | drawNotice | 알림판 그림(칩 테두리, 글자 그림자) | `noticeImage` | 이식(오라클 픽스처) |
| 0x0042e186 | waitNotice | 0.96초 뒤 클릭, 28.8초 자동, 전투 콜백 멈춤 | `NoticeBoard` | 이식 |
| 0x00407d43 | resultWindow | 결과 창(팔레트, 그림 읽기 0x4080ac, 가운데, 장면 5) | `loadResultArt`·`resultPalette`·`resultRect`, `ResultWindow` | 이식(오라클 픽스처) |
| 0x004084c4 | drawResultPage | 쪽 0 요약 0x408614·0x408826, 1·3 네이티얼 0x409688, 2·4 마법 0x409a5c, 단추 0x40a55e | `drawResultPage`·`drawResultButtons` | 이식(오라클 픽스처) |
| 0x0040aa34 | resultHit | 단추 판정 | `resultHit` | 이식(시험) |
| 0x00401bd8 | closeBattle | 닫기: 저장 가능이면 0x84, 아니면 "Unable to save…" MessageBox, 정리(창 셋, 장면 0, SV080 지우기) | BattleWindow `askClose`·`leave` | 이식 |
| 0x00441e36 | saveContinue | 슬롯 대화 상자 0x76(저장 모드) → 0x4071ea·0x441960·식별값 → SV1xx | `continueBlock`, `SlotDialog`, `saveTo` | 이식(오라클 픽스처) |
| 0x00441960 | placeWindows | 창 8개의 바깥 사각형을 블록 +0x268~+0x2d3에 | `writeWindows`·`readWindows` | 이식(오라클 픽스처) |
| 0x0044161a | continueRow | 슬롯 목록 줄(구분·마스터 종류 이름·맵 이름·파일 시각) | `continueRow` | 이식(오라클 픽스처) |
| 0x00441cb3 | loadContinue | 슬롯 대화 상자 읽기 모드 → 블록 → 그 슬롯 식별값 새 rand(0x442098) | TitleScreen Load Data | 이식 |
| 0x00442045 | autosave | 입력 대기(지형 효과 뒤) SV080(식별값 1) | BattleWindow 입력 시작 | 이식 |
| 0x00441fd3 | traceCheck | 앱 시작 때 SV080 질문 | TitleScreen `askTrace` | 이식 |
| 0x0040e762 | setZoom | 전장 확대 0 x /2·1 x 1·2 x 2: 0x40ee74(들어감)·0x40ef93(나옴), 전장 창 칩 크기·시트(0x40f03c) | `Panes.zoom`, `enterHalf`·`leaveHalf` | 이식 |
| 0x0040ee74 | enterHalf | 반 시트 채우기: 유닛 페이지·배경 줄이기, 페이지 0 리소스 7, 하늘 0x42362b, UI 페이지(0x476bb4 줄이기, 0x476bb0 리소스 9) | `buildHalf`(halfSheet.ts) | 이식(오라클 픽스처) |
| 0x00423651 | shrinkSky | 하늘 줄이기: 홀짝 표본 순서, 넷의 거리는 개수배, 최소를 개수²로 나눠 0xfff와 비교 | `shrinkChips(…, sky)` | 이식(오라클 픽스처) |
| 0x00422db7 | halfCommon | 그림 페이지 0의 반 크기(리소스 7: 16칩 묶음의 앞 8칩을 4등분) | `placeHalfArt` | 이식(오라클 픽스처) |
| 0x004516f4 | worldScene | 장면 3: 월드 창(0x451d50), 48ms 콜백 0x451d12(96ms 깜빡임), 고른 맵이 있으면 0x4514a2(맵, 1)로 두 창 다시 | `WorldScene` | 이식 |
| 0x004514a2 | selectMap | 소리 1(강제 0일 때), 고른 맵 +0x2d4, 맵 정보·마스터 정보 만들기/갱신, 도움말 = 맵 설명(0x424e78), 월드 창 맨 아래로 | `WorldScene` select | 이식 |
| 0x00452175 | drawWorld | 월드 창 그림: 지도 위 맵 점 52개(고른 맵·마우스 위·깜빡임 프레임) | `worldImage` | 이식(오라클 픽스처) |
| 0x00452385 | hitWorld | 맵 점 판정 16 × 16(가운데 ±8, 플래그 ≠ 0인 첫 맵) | `worldHit` | 이식(오라클 픽스처) |
| 0x00429eec | drawMapInfo | 맵 정보 창: 미리보기·이름표·시작 시각·밝기·READY/FIGHT·시간 제한 | `mapInfoImage` | 이식(오라클 픽스처) |
| 0x0042ab35 | hitMapInfo | READY 0, 시간 제한 2~5(줄 사이 2px 틈) | `mapInfoHit` | 이식(오라클 픽스처) |
| 0x00429db7 | setTimeLimit | 시간 제한(블록 +0x14) 바꾸고 소리 4(같은 값도) | `WorldScene` | 이식 |
| 0x0042b5c2 | drawMasterInfo | 마스터 정보 창: 두 진영 능력치·초상·아이콘 30개(꺼짐은 색 바꿈 표 1)·User/Computer | `masterInfoImage` | 이식(오라클 픽스처) |
| 0x0042bef4 | hitMasterInfo | 진영 × 32 + (초상 0, 조종 1, 아이콘 2~31), 편집 가능일 때만 | `masterInfoHit` | 이식(오라클 픽스처) |
| 0x0042d762 | toggleItem | 아이템을 진영 목록에서 빼거나 오름차순으로 넣기(빈 목록 됨) | `toggleItem` | 이식(오라클 픽스처) |
| 0x0042b502 | toggleController | 진영 조종 0 ↔ 1, 소리 4 | `WorldScene` | 이식(오라클 픽스처) |
| 0x004512fc | arrangeWorld | Window arrange(장면 3): 0x4510ca로 다시 배치 | `WorldScene` arranged | 이식 |
| 0x00407926 | thinkTimeTick | 생각 시간 틱(48ms 콜백·걷기 끝): 남은 1/6초, 경고음 10·11, 연장(소리 12, 원작 셈 n = ⌊초과/연장 초⌋ + 1), 다 쓰면 소리 13·강제 Stand by(0x406cd2) | `tickTimer`, BattleWindow `tickTime` | 이식(오라클 픽스처) |
| 0x0040ca6d | drawTimeStrip | 정보 창 시간 칸: 남은 초 숫자, 막대(마지막 60초), 끝 불꽃 칩 | `StatusWindow.timeStrip` | 이식(오라클 픽스처) |
| 0x00401d98 | humanSides | 조종 0인 진영 수와 마지막 사람 진영(연장 아이콘 진영 0x476af0) | `shownSide` | 이식(오라클 픽스처) |
| 0x0042bd5e | clickMasterInfo | 마스터 정보 클릭: 편집이 열려 있으면 무시, 초상이면 소리 1과 편집 0x7d(0x42c034 → 0x42c495) | `WorldScene` | 이식 |
| 0x0042c4d6 | initMasterEdit | 목록 27개, 업다운 범위, 글자, 자리(커서 기준), 초상 페이지, 도움말 마스터 설명 | `editOf`·`editDialogAt`, `MasterEditDialog` | 이식(오라클 픽스처) |
| 0x0042ce52 | masterEditProc | 목록 바뀜 0x42c9ac, 레벨 EN_UPDATE, 0x4b2 이름, Edit Name·Standard Name·OK·Cancel | `selectMaster`·`setLevel`·`renamed`·`useStandardName`, `MasterEditDialog` | 이식(오라클 픽스처) |
| 0x0042db87 | standardStats | 공격 행동 0x470710[마스터], 능력치 0x4690f0[마스터][레벨] | `withStandardStats` | 이식(오라클 픽스처) |
| 0x0042c0ff | applyMasterEdit | 편집 → 진영 레코드(목록·조종 그대로) | `applyEdit` | 이식(오라클 픽스처) |
| 0x0042cb2a | paintMasterEdit | 초상 48 × 67 ×2, 0x10 투명(SRCAND·SRCPAINT) | `masterEditPortrait` | 이식(오라클 픽스처) |
| 0x0042c3f6 | nameDialogProc | 이름 입력 OK: 1~16바이트면 소리 1·0x4b2, 아니면 소리 3 | `acceptName`, `MasterEditDialog` | 이식(오라클 픽스처) |
| 0x0042c2a6 | initNameDialog | 이름 글자, 자리(부모 가운데·7/8, 화면 안) | `nameDialogAt` | 이식(오라클 픽스처) |
| 0x0044ee63 | customize | Customize(0x7b): 처음 라디오(켜진 가장 낮은 애니메이션 비트), OK면 비트 8·7/6/4/0, 장면 4에서 끈 하늘(0x43d4b8)·물(물 프레임 0, 0x43e2e0) | `customizeInit`·`customizeApply`, `OptionDialogs` | 이식(오라클 픽스처) |
| 0x00443511 | soundDialog | Sound(0x79/0x7a): BGM 0x10·효과음 0x20·장치, 바뀌면 0x44380e·0x44372e | `soundInit`·`soundApply`, `OptionDialogs` | 이식(오라클 픽스처, BGM 재생은 ③b-5) |
| 0x00441aea | saveGameData | Save GameData(장면 3): 0x78 저장 모드 → 0x441960 → +0 = 0 → SV0ii | `gameDataBlock`, `GameDataDialog` | 이식(오라클 픽스처) |
| 0x0044198d | loadGameData | 0x78 읽기 모드 → 블록 → 0x4510b6(월드) | `worldFromGameData`, `GameDataDialog`, TitleScreen | 이식(오라클 픽스처) |
| 0x00425fcd | firstTitle | 앱 시작: 검은 전체 화면 팝업, FALCOM.AVI(MCIWnd 320 × 240 가운데, 클릭이면 끝으로), 끝나면 오프닝 애니메이션(0x426c54) 또는 건너뜀(0x426c7c) | `TitleScreen` opening, `OpeningMovie` | 이식(오라클 픽스처) |
| 0x0043307e | openingClock | 오프닝 시계: 대기 전이면 쉼, 스텝(0x4330fa)마다 가상 시계 −3, 60 안쪽이면 그린다(뒤지면 그리지 않고 더 돈다) | `Engine.tick`·`step` | 이식(오라클 픽스처: 1860틱 DIB·색 표 CRC) |
| 0x004327fb | projectSprite | 스프라이트 투영: 카메라·회전 행렬, 초점 / z, 반올림 0에서 먼 쪽, 바뀌면 옛·새 자리를 고친 사각형(0x421c6d)에 | `Engine.project` | 이식(오라클 픽스처) |
| 0x00433538 | openingScript | 오프닝 대본 0x473388(21칸: 7장 × (그림 읽기, 장면, 장면) + 글 카드 0x439f89, 로고 0x43946e·0x439756, 타이틀 0x439d23) | `Opening` (`opening/scenes.ts`) | 이식(오라클 픽스처) |
| 0x00426c7c | skipOpening | 오프닝 건너뜀: 엔진을 타이틀 대본(0x473438)으로(0x433340), BGM 8, 상태 1 → 다음 틱에 메뉴 | `TitleScreen` press(opening) | 이식 |
| 0x00425fa0 | returnTitle | 타이틀로 돌아옴: AVI·애니메이션 없이 타이틀 + 메뉴(BGM 8) | `TitleScreen` | 이식(오라클 픽스처: 같은 그림) |
| 0x00439d23 | titleScene | 타이틀 그림: 팔레트(DATA00 1·2, DATA07 0x15b·0x1a7, 16 검정·15 파랑), 바탕 0x1a8·0x1a9 − 7, 로고 0x18a (67, 17) | `loadTitleArt`·`titleImage`·`titlePalette` | 이식(오라클 픽스처) |
| 0x00439f40 | titleGlint | 로고 반짝임: 200틱마다 25프레임(0x18b~0x1a3, 사각형 0x4731e8) | `glintFrame` | 이식(오라클 픽스처) |
| 0x0042626f | drawTitleMenu | 메뉴 6항목 (316, 336 + 20i): 그림자 10, 본문 0xb·마우스 위 0xf | `titleImage` | 이식(오라클 픽스처) |
| 0x004269d0 | titleHit | x 316~451, y 336 + 20i ~ 351 + 20i | `titleHit` | 이식(오라클 픽스처) |
| 0x00426a3a | titleClick | 소리 1: Scenario 0x83 → 0x450da0, Expert 0x450e35, Free Battle 0x450ed7, Network 0x44f2e0, Load Data, Quit | `TitleScreen` press | 이식(시나리오·Expert는 소리까지, Network는 지원하지 않는다는 안내창 — 사용자 결정 10) |
| 0x00443770 | playBgm | 곡 바꾸기: BGM 끔이면 번호만, 같은 곡을 틀고 있으면 그대로, 아니면 멈추고 CD(0x443973)·MIDI(0x443b26) | `Bgm.play` | 이식(오라클 픽스처) |
| 0x00443973 | playCd | CD 트랙 한 곡(MCI cdaudio), 끝나면 알림 | `CdDevice`(`original/CDDA/TRACKnn.mp3`) | 이식 |
| 0x00443847 | bgmNotify | 끝 알림: 지금 장치·곡의 성공 알림이면 반복 곡은 다시(0x443beb), 아니면 0x4437fa(멈추고 −1) | `Bgm.ended` | 이식(오라클 픽스처) |
| 0x0044372e | applyBgm | Sound OK 뒤: 꺼졌으면 멈춤·CD 닫기, 켜졌으면 (CD면 열고) 지금 곡 | `Bgm.apply`·`soundOk` | 이식(오라클 픽스처) |
| 0x00401a0c | battleMusic | 전투 곡 = 맵 +0x2c | `battleTrack` | 이식 |

## 참고 문자열

| 주소 | 문자열 | 메모 |
|---|---|---|
| 0x0046218c | `DATA%02d.DAT` | readEntry가 사용 |
| 0x004740f4 | `\SAVE\SV%03d.` | 세이브 파일 이름(0x441231) |
| 0x004744e8~ | `CR0xxGM.MID` 등 | BGM 파일 표(GM/GS/S8 세 벌) |
