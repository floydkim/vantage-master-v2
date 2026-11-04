"""정답 픽스처 파일 쓰기: 경우 하나를 한 줄로 써서 바뀐 경우만 diff에 드러나게 한다."""
import json
import os

GOLDEN = os.path.join(os.path.dirname(__file__), '..', '..', 'test', 'golden')


def write_fixture(name: str, address: int, cases: list) -> None:
    path = os.path.normpath(os.path.join(GOLDEN, f'{name}.json'))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    lines = ',\n'.join(json.dumps(c, ensure_ascii=False, separators=(',', ':')) for c in cases)
    with open(path, 'w') as f:
        f.write(f'{{"address":"{address:#x}","cases":[\n{lines}\n]}}\n')
    print(f'{path}: {len(cases)}개')
