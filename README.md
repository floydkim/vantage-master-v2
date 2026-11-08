# Vantage Master V2 웹 복각

니혼 팔콤의 『밴티지 마스터 V2』(국내 정발명 『밴티지 마스터 택틱스』)를 브라우저에서 돌아가게 다시 만든 비공식 팬 프로젝트입니다. 규칙과 CPU AI는 원작 실행 파일을 분석해 그대로 옮겼고, 그래픽·맵·수치·음악은 사용자가 넣은 원본 파일에서 읽습니다.

## 플레이

**<https://floydkim.github.io/vantage-master-v2/>**

처음 열면 설치 마법사가 뜹니다. 데스크톱 브라우저를 권합니다.

- **게임 파일(필수)**: 팔콤 공식 무료 배포판 Vantage Master Online의 `VMOnline.exe`(21MB). 팔콤 배포 페이지 <https://www.falcom.co.jp/vantage/download.html>에서 받습니다. 설치된 영문판 게임 폴더를 골라도 됩니다.
- **한국어판(선택)**: 한국어판 게임 폴더를 고르면 공식 한국어 글로 볼 수 있습니다. 없으면 새로 번역한 한국어로 나옵니다.
- **CD 음악(선택)**: 원작 CD 음악(CD Audio·SC-88) mp3가 든 앨범 폴더. 넣지 않으면 MIDI로 연주합니다.

넣은 파일은 이 브라우저 안(IndexedDB)에만 저장되고 어디로도 보내지 않습니다. 지우려면 화면 위 [원본 파일…] → [제거…]에서 고르면 됩니다.

## 개발

[Node.js](https://nodejs.org/) 22와 [pnpm](https://pnpm.io/)이 필요합니다.

```sh
pnpm install
pnpm fetch-original    # 팔콤 공식 배포판을 받아 original/에 풉니다(커밋하지 않음)
pnpm fetch-soundfont   # BGM 사운드폰트 GeneralUser GS
pnpm dev               # 개발 서버: original/을 서빙. /#play가 게임(마법사 없이), /는 자료 보기
pnpm test              # 시험(대부분 original/의 원본을 읽음)
pnpm typecheck
pnpm build             # dist/
```

- `pnpm import-korean <한국어판 폴더>`, `pnpm import-cd-audio <앨범 폴더>`: 개발 서버에서 한국어판·CD 음악을 쓰려면 `original/`에 들입니다.
- `pnpm oracle-setup`, `pnpm oracle-check`, `pnpm oracle <이름>`: 원작 코드를 에뮬레이터로 돌려 시험 기준 데이터(`test/golden`)를 만드는 도구(Python).
- 분석 기록은 `re/`에 있습니다.

## 고지

이 저장소와 사이트는 팔콤의 게임 파일(그림·소리·맵 등)을 포함하지 않습니다. 분석 기록·시험·코드 주석에는 영문판의 이름·수치·짧은 메시지 일부를 인용합니다. 『밴티지 마스터』의 상표와 저작권은 니혼 팔콤에 있으며, 이 프로젝트는 팔콤과 관계없는 비공식 팬 프로젝트입니다.

## 라이선스

코드는 [MIT](LICENSE)입니다. 함께 쓰는 글꼴(Galmuri, NeoDunggeunmo: SIL OFL 1.1)은 각 폴더의 라이선스 파일을, 빌드에 들어가는 사운드폰트(GeneralUser GS)와 npm 패키지의 라이선스는 빌드 결과의 `THIRD-PARTY-LICENSES.txt`를 보세요.
