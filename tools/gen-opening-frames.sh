#!/bin/sh
# 오프닝 FALCOM.AVI(Microsoft Video 1, 16비트 RGB555)를 ffmpeg로 풀어 프레임마다 MD5를 정답 골든에 남긴다(해시만, 영상은 넣지 않음).
# 시험(test/formats/avi.test.ts)이 리메이크의 MS Video 1 풀기와 프레임마다 비교한다. 사용법: sh tools/gen-opening-frames.sh
set -eu
cd "$(dirname "$0")/.."
ffmpeg -loglevel error -i original/VMO_WIN/FALCOM.AVI -fps_mode passthrough -pix_fmt rgb555le -f framemd5 - \
  | awk -F', *' '!/^#/ { printf "%s\"%s\"", (n++ ? "," : ""), $6 } END { print "" }' \
  | { printf '{"source":"ffmpeg framemd5 rgb555le, FALCOM.AVI","frames":['; cat; printf ']}\n'; } > test/golden/openingFrames.json
python3 -c "import json; d = json.load(open('test/golden/openingFrames.json')); print(len(d['frames']), 'frames')"
