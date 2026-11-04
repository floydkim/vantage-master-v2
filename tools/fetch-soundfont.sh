#!/bin/sh
# BGM 사운드폰트 GeneralUser GS v2.0.3(S. Christian Collins, 소프트웨어에 넣어 배포 허락: 저장소 documentation/LICENSE.txt)과 그 라이선스 글을 original/에 받는다.
# 다른 SF2·SF3·DLS를 쓰려면 같은 이름(original/GeneralUser-GS.sf2)으로 바꿔 두면 된다. 커밋하지 않는다(original/는 git 제외).
set -eu
REPO=https://raw.githubusercontent.com/mrbumpy409/GeneralUser-GS/97049183643d5fc5a9322a69c5b09efb667c6c3a
URL=$REPO/GeneralUser-GS.sf2
SHA256=9575028c7a1f589f5770fccc8cff2734566af40cd26ed836944e9a5152688cfe
LICENSE_SHA256=7b32efefdf95ce38a043799f0659853ddc00fbaa14d8c50f0aca16b9b8b405be

cd "$(dirname "$0")/.."
mkdir -p original
curl -fsSL -o original/GeneralUser-GS.sf2.part "$URL"
echo "$SHA256  original/GeneralUser-GS.sf2.part" | shasum -a 256 -c -
mv original/GeneralUser-GS.sf2.part original/GeneralUser-GS.sf2
# 라이선스 글: 빌드가 THIRD-PARTY-LICENSES.txt에 싣는다(vite.config.ts)
curl -fsSL -o original/GeneralUser-GS-LICENSE.txt.part "$REPO/documentation/LICENSE.txt"
echo "$LICENSE_SHA256  original/GeneralUser-GS-LICENSE.txt.part" | shasum -a 256 -c -
mv original/GeneralUser-GS-LICENSE.txt.part original/GeneralUser-GS-LICENSE.txt
