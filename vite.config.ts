import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

// 함께 배포하는 글꼴(SIL OFL 1.1: 글꼴과 함께 저작권 줄·라이선스 글을 실어야 한다)
const FONT_LICENSES = ['src/i18n/fonts/neodgm-LICENSE.txt', 'src/ui/frame/fonts/galmuri-LICENSE.txt'];
// BGM 사운드폰트(pnpm fetch-soundfont, git 제외). GeneralUser GS 라이선스가 소프트웨어에 넣어 배포하는 것을 허락한다
const SOUNDFONT = 'original/GeneralUser-GS.sf2';
const SOUNDFONT_LICENSE = 'original/GeneralUser-GS-LICENSE.txt';

/** 빌드 결과에 THIRD-PARTY-LICENSES.txt: 글꼴 OFL과 번들에 든 npm 패키지마다 LICENSE 글(MIT·Apache-2.0은 사본에 고지를 함께 실어야 한다) */
export function thirdPartyLicenses(): Plugin {
  return {
    name: 'third-party-licenses',
    apply: 'build',
    generateBundle(_, bundle) {
      const packages = new Map<string, string>(); // 이름 → 폴더(pnpm 경로는 마지막 node_modules 아래)
      for (const out of Object.values(bundle)) {
        if (out.type !== 'chunk') continue;
        for (const id of out.moduleIds) {
          const m = /^(.*node_modules\/((?:@[^/]+\/)?[^/]+))\//.exec(id.replaceAll('\\', '/'));
          if (m) packages.set(m[2], m[1]);
        }
      }
      const sections = FONT_LICENSES.map((f) => readFileSync(f, 'utf8'));
      if (existsSync(SOUNDFONT) && existsSync(SOUNDFONT_LICENSE)) sections.push(readFileSync(SOUNDFONT_LICENSE, 'utf8')); // 의무는 아니지만 저작자 표시
      for (const [name, dir] of [...packages].sort(([a], [b]) => a.localeCompare(b))) {
        const { version, license } = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { version: string; license: string };
        const files = readdirSync(dir);
        const file = files.find((f) => /^(licen[cs]e|copying)/i.test(f));
        if (!file) throw new Error(`${name}에 라이선스 파일이 없습니다`);
        const notice = files.find((f) => /^notice/i.test(f)); // Apache-2.0 §4(d): 있으면 함께
        sections.push(`${name} ${version} (${license})\n\n${readFileSync(join(dir, file), 'utf8')}${notice ? `\n${readFileSync(join(dir, notice), 'utf8')}` : ''}`);
      }
      const source = `Third-party software included in this build\n\n${sections.join(`\n${'='.repeat(78)}\n\n`)}`;
      this.emitFile({ type: 'asset', fileName: 'THIRD-PARTY-LICENSES.txt', source });
    },
  };
}

/** 빌드 결과 맨 위에 사운드폰트 GeneralUser-GS.sf2(실행 때 BASE_URL 아래). 받아 두지 않았으면 경고만(BGM MIDI는 소리 없이 실패, 원작 MCI 열기 실패처럼) */
export function soundFont(sf2 = SOUNDFONT): Plugin {
  return {
    name: 'sound-font',
    apply: 'build',
    generateBundle() {
      if (!existsSync(sf2)) return this.warn(`${sf2}이 없어 빌드에 넣지 않습니다(BGM MIDI 소리 없음). pnpm fetch-soundfont로 받으세요`);
      this.emitFile({ type: 'asset', fileName: 'GeneralUser-GS.sf2', source: readFileSync(sf2) });
    },
  };
}

export default defineConfig(({ command }) => ({
  base: './', // 배포 빌드가 하위 경로(GitHub Pages /vantage-master-v2/)에서도 돌게. 개발 서버는 그대로 /
  plugins: [react(), thirdPartyLicenses(), soundFont()],
  // 원본 데이터(git 제외, 배포 불가: 게임 데이터·CD 음원·오프닝)는 개발 서버만 서빙한다: original/VMO_WIN/DATA00.DAT → /VMO_WIN/DATA00.DAT
  publicDir: command === 'serve' ? 'original' : false,
  test: { include: ['test/**/*.test.ts'] },
}));
