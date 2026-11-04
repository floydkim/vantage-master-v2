"""original/VMO_WIN 파일 읽기."""
import os

ROOT = os.path.join(os.path.dirname(__file__), '..', '..', 'original', 'VMO_WIN')


def read_original(name: str) -> bytes:
    path = os.path.normpath(os.path.join(ROOT, name))
    if not os.path.exists(path):
        raise SystemExit(f'원본 데이터가 없습니다: {path}\n먼저 `pnpm fetch-original`을 실행하세요.')
    with open(path, 'rb') as f:
        return f.read()
