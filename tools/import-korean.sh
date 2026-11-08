#!/bin/sh
# 사용자가 준 한국어판 게임 자료를 original/KO/에 들인다(커밋하지 않음, original/는 git 제외).
# 한국어판에서 바뀐 것만: Vmv2.exe(UI 문자열 CP949·대화 상자·메뉴), DATA00(GUIDE._BM), DATA08(장 사이 장면), DATA09(마스터 ED), DATA10(MAP·MAS 글), DATA13(한국어 더빙 음성).
# 사용법: pnpm import-korean <한국어판 폴더>
set -eu
[ $# -eq 1 ] || { echo "사용법: pnpm import-korean <한국어판 폴더>" >&2; exit 2; }
SRC=$1
# 주소 대응표(src/i18n/koStrings.json)를 만든 빌드. 다른 빌드는 주소가 달라 쓸 수 없다(src/ui/battle/original.ts KO_EXE_SHA256과 같음)
SHA256=bfdbd88a994b1e505acf0bc4a7c05d2020ef7c09a3b894d01569a511b28693c5
FILES="Vmv2.exe DATA00.DAT DATA08.DAT DATA09.DAT DATA10.DAT DATA13.DAT"
# 파일 이름은 대소문자를 가리지 않고 찾는다(CD에서 옮기면 VMV2.EXE 등). 폴더·파일이 심볼릭 링크여도 따라간다
pick() { find -L "$SRC" -maxdepth 1 -type f -iname "$1" | head -n 1; }
# 하나라도 없거나 다른 빌드면 아무것도 들이지 않는다(일부만 들이면 한국어로 열 수 없다)
for f in $FILES; do [ -n "$(pick "$f")" ] || { echo "없음: $SRC/$f" >&2; exit 1; }; done
echo "$SHA256  $(pick Vmv2.exe)" | shasum -a 256 -c - >/dev/null || { echo "Vmv2.exe가 대응표를 만든 한국어판 빌드가 아닙니다(SHA-256 $SHA256)" >&2; exit 1; }
DEST="$(cd "$(dirname "$0")/.." && pwd)/original/KO"
mkdir -p "$DEST"
for f in $FILES; do cp "$(pick "$f")" "$DEST/$f"; done
cd "$DEST/../.." 
ls original/KO | tr '\n' ' '
echo
