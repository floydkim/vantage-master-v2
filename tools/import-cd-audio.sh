#!/bin/sh
# 사용자가 준 BGM 음원을 original/CDDA/TRACKnn.mp3(CD 음원)·original/SC88/TRACKnn.mp3(SC-88 녹음)로 들인다(nn = 원작 CD 트랙, 곡 표 0x4742f0의 CD 칸).
# 커밋하지 않는다(original/는 git 제외). 사용법: pnpm import-cd-audio <앨범 폴더>  (폴더 안 'CD Audio/NN_….mp3', 'SC-88/NN_….mp3')
# CD Audio의 NN은 오디오 트랙 차례(CD 트랙 1은 데이터)라 NN 01~18 → CD 트랙 NN + 1. SC-88은 같은 곡이 21~38번.
# CD 트랙 20(엔딩 2)은 V2 판(CD Audio 20번·SC-88 40번)이다: V2의 CR005GM.MID 길이 392.8초가 V2 판(392.6초·391.8초)과 맞고, VM1 판 SC-88은 204.5초다.
set -eu
[ $# -eq 1 ] || { echo "사용법: pnpm import-cd-audio <앨범 폴더>" >&2; exit 2; }
ALBUM=$1
cd "$(dirname "$0")/.."
copy() { # <앨범 하위 폴더> <파일 번호> <대상 폴더> <CD 트랙>
  f=$(ls "$ALBUM/$1"/"$2"_*.mp3 2>/dev/null | head -n 1)
  [ -n "$f" ] || { echo "없음: $ALBUM/$1/$2_*.mp3" >&2; exit 1; }
  mkdir -p "original/$3"
  cp "$f" "original/$3/TRACK$4.mp3"
}
for n in 01 02 03 04 05 06 07 08 09 10 11 12 13 14 15 16 17 18; do
  t=$(printf %02d "$(expr "$n" + 1)")
  copy 'CD Audio' "$n" CDDA "$t"
  [ -d "$ALBUM/SC-88" ] && copy SC-88 "$(expr "$n" + 20)" SC88 "$t"
done
copy 'CD Audio' 20 CDDA 20
[ -d "$ALBUM/SC-88" ] && copy SC-88 40 SC88 20
ls original/CDDA original/SC88 2>/dev/null | tr '\n' ' '
echo
