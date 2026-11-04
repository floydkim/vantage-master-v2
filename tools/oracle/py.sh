#!/bin/sh
# 오라클 Python 실행기: tools/.venv의 Python을 격리 모드(-I)로 실행한다. 환경이 없으면 만드는 방법을 알려준다.
set -eu
cd "$(dirname "$0")/../.."
PY=tools/.venv/bin/python
[ -x "$PY" ] || { echo "오라클 Python 환경이 없습니다. 먼저 \`pnpm oracle-setup\`을 실행하세요." >&2; exit 1; }
exec "$PY" -I "$@"
