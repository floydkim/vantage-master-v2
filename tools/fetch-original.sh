#!/bin/sh
# 팔콤 공식 무료 배포판 Vantage Master Online(V2 영문판)을 받아 original/ 에 푼다.
# 결과: original/VMO_WIN/(게임 파일), original/readme.txt, original/VMOnline.exe(받은 그대로: LHA 풀기 시험·설치 마법사 확인용)
set -eu
URL=https://www.falcom.co.jp/vantage/download/VMOnline.exe
SHA256=d3303710ff7699b18ab56b085a8aa9b2a77bc09ad70910d9f461a7960d818e45
LHA_OFFSET=37376 # LHA 자체 압축 해제 파일 안에서 LHA 아카이브가 시작하는 위치

cd "$(dirname "$0")/.."
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

curl -fsSL -o "$TMP/VMOnline.exe" "$URL"
echo "$SHA256  $TMP/VMOnline.exe" | shasum -a 256 -c -
tail -c +$((LHA_OFFSET + 1)) "$TMP/VMOnline.exe" > "$TMP/VMOnline.lzh"
mkdir -p original
tar -xf "$TMP/VMOnline.lzh" -C original # macOS bsdtar(libarchive)는 LHA를 풀 수 있다
cp "$TMP/VMOnline.exe" original/VMOnline.exe
ls original/VMO_WIN/vmv2.exe
