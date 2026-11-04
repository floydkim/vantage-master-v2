#!/bin/sh
# 사용법: pnpm oracle <이름>  →  tools/oracle/gen_<이름>.py 로 정답 픽스처를 만든다.
set -eu
cd "$(dirname "$0")/../.."
[ $# -eq 1 ] || { echo "사용법: pnpm oracle <이름> (예: save_file)" >&2; exit 2; }
exec sh tools/oracle/py.sh "tools/oracle/gen_$1.py"
