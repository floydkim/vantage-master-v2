#!/bin/sh
# 공개 저장소로 내보내기: HEAD에 커밋된 파일 가운데 허용 목록만 <공개 저장소 폴더>로 옮기고, 검사·시험·빌드가 통과하면 그 폴더에 커밋 하나를 더한다.
# push는 하지 않는다. 처음이면 빈 폴더를 `git init -b main`으로 만든 뒤 돌린다. 검사·시험이 실패하면 그 폴더는 건드리지 않는다.
# 사용법: pnpm publish-public <공개 저장소 폴더>
set -eu
[ $# -eq 1 ] || { echo '사용법: sh tools/publish.sh <공개 저장소 폴더>' >&2; exit 2; }
OUT=$(cd "$1" && pwd -P) # 부른 곳 기준, 링크는 실제 경로로
cd "$(dirname "$0")/.."
ROOT=$(pwd -P)
# 공개할 것(docs/ 작업 문서와 git 밖 파일은 넣지 않는다). re/는 맨 위 .md만
ALLOW='src test tools :(glob)re/*.md index.html package.json pnpm-lock.yaml tsconfig.json vite.config.ts .gitignore README.md LICENSE .github'

# 대상 확인: 옮기기가 .git 말고 모두 지우므로 작업 저장소·다른 저장소를 잘못 주면 막는다
case "$ROOT/" in "$OUT"/*) echo "${OUT}은(는) 작업 저장소이거나 그 위 폴더입니다" >&2; exit 1 ;; esac
[ -d "$OUT/.git" ] || { echo "${OUT}에 git 저장소가 없습니다(먼저 빈 폴더에서 git init -b main)" >&2; exit 1; }
last=$(git -C "$OUT" log -1 --format=%s 2>/dev/null || true)
if [ -n "$last" ]; then
  case "$last" in '배포 '*) ;; *) echo "${OUT}의 마지막 커밋이 내보내기('배포 …')가 아닙니다: $last" >&2; exit 1 ;; esac
elif [ -n "$(ls -A "$OUT" | grep -vx .git || true)" ]; then
  echo "${OUT}은(는) 커밋이 없는데 파일이 있습니다(빈 폴더에서 시작하세요)" >&2; exit 1
fi
[ -z "$(git status --porcelain --untracked-files=no)" ] || { echo '커밋하지 않은 변경이 있습니다' >&2; exit 1; }
set -f
[ -z "$(git status --porcelain -- $ALLOW)" ] || { echo '커밋하지 않은 변경이 있습니다' >&2; exit 1; } # 공개 대상 경로는 git에 넣지 않은 파일도(무시된 파일은 나오지 않음)
set +f

# 임시 폴더에 풀어 검사한다(실패하면 대상은 그대로)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
set -f
git archive -o "$tmp/a.tar" HEAD -- $ALLOW || { echo '허용 목록의 경로가 HEAD에 없습니다(이름을 바꿨으면 ALLOW도)' >&2; exit 1; }
set +f
mkdir "$tmp/tree"
tar -xf "$tmp/a.tar" -C "$tmp/tree"

# 검사: 내 컴퓨터 경로·금지 주소, 허용 목록 밖 경로, 글꼴 밖 바이너리(스크립트 자신은 검사 글을 담으므로 뺀다)
bad=$(cd "$tmp/tree" && {
  grep -rIlE '/Users/|~/|\.claude/|khinsider|namu\.wiki' . | grep -vx './tools/publish.sh' || true
  find . -type f | while read -r f; do
    case "${f#./}" in (re/*/*) echo "$f" ;; (src/* | test/* | tools/* | re/*.md | .github/* | index.html | package.json | pnpm-lock.yaml | tsconfig.json | vite.config.ts | .gitignore | README.md | LICENSE) ;; (*) echo "$f" ;; esac
  done
  find . -type f ! -name '*.woff2' -exec file --mime-encoding {} + | grep ': binary$' | cut -d: -f1 || true
})
[ -z "$bad" ] || { echo '공개할 수 없는 파일:' >&2; echo "$bad" >&2; exit 1; }

# 시험·빌드(CI는 원본이 없어 시험을 못 돌린다)
for c in typecheck test build; do
  pnpm "$c" > "$tmp/log" 2>&1 || { tail -30 "$tmp/log" >&2; echo "pnpm $c 실패" >&2; exit 1; }
done

# 옮기기: .git 말고 모두 지우고 새로 놓는다(main에서 지운 파일은 여기서도 사라진다)
find "$OUT" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
cp -R "$tmp/tree/." "$OUT/"
cd "$OUT"
git add -A
if git diff --cached --quiet; then echo '바뀐 것 없음'; exit 0; fi
GIT_AUTHOR_NAME='Floyd Kim' GIT_AUTHOR_EMAIL='for12gm@gmail.com' GIT_COMMITTER_NAME='Floyd Kim' GIT_COMMITTER_EMAIL='for12gm@gmail.com' git commit -q -m "배포 $(date +%Y-%m-%d)"
git log -1 --format='커밋 %h %s'
