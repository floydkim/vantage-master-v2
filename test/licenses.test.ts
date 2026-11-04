import { mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, it } from 'vitest';
import viteConfig, { soundFont, thirdPartyLicenses } from '../vite.config.ts';

it('빌드 결과에 THIRD-PARTY-LICENSES.txt: 글꼴 OFL 둘(Neo둥근모·갈무리)과 번들에 든 npm 패키지마다 이름·판·라이선스·LICENSE 글', () => {
  const react = dirname(createRequire(import.meta.url).resolve('react/package.json'));
  const emitted: { fileName: string; source: string }[] = [];
  const bundle = {
    'index.js': { type: 'chunk', moduleIds: [`${react}/index.js`, `${react}/cjs/react.production.js`, '\0vite/preload-helper.js', `${process.cwd()}/src/main.tsx`] },
    'neodgm.woff2': { type: 'asset' },
  };
  (thirdPartyLicenses().generateBundle as (this: unknown, o: unknown, b: unknown) => void).call({ emitFile: (f: { fileName: string; source: string }) => emitted.push(f) }, {}, bundle);
  expect(emitted.map((f) => f.fileName)).toEqual(['THIRD-PARTY-LICENSES.txt']);
  const text = emitted[0].source;
  expect(text).toContain('Reserved Font Name NeoDunggeunmo');
  expect(text).toContain('Minseo Lee');
  expect(text).toContain('SIL OPEN FONT LICENSE Version 1.1');
  expect(text.match(/^react \S+ \(MIT\)$/gm)).toHaveLength(1); // 같은 패키지의 모듈 여럿은 한 번
  expect(text).toContain('Copyright (c) Meta Platforms, Inc. and affiliates.');
  expect(text).not.toContain('scheduler'); // 번들에 없는 패키지는 넣지 않는다
});

it('원본 폴더(original/: 게임 데이터·CD 음원·오프닝)는 개발 서버만 서빙하고 빌드 결과에는 복사하지 않는다', () => {
  const config = viteConfig as (env: { command: 'build' | 'serve'; mode: string }) => { publicDir?: string | false };
  expect(config({ command: 'serve', mode: 'development' }).publicDir).toBe('original');
  expect(config({ command: 'build', mode: 'production' }).publicDir).toBe(false);
});

it('사운드폰트(배포 가능, GeneralUser GS 라이선스)는 받아 두었으면 빌드 결과 맨 위 GeneralUser-GS.sf2로, 없으면 경고만', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sf-'));
  const sf2 = join(dir, 'GeneralUser-GS.sf2');
  writeFileSync(sf2, Uint8Array.of(1, 2, 3));
  const run = (path: string) => {
    const emitted: { fileName: string; source: Uint8Array }[] = [];
    const warnings: string[] = [];
    (soundFont(path).generateBundle as (this: unknown) => void).call({ emitFile: (f: { fileName: string; source: Uint8Array }) => emitted.push(f), warn: (w: string) => warnings.push(w) });
    return { emitted: emitted.map((f) => [f.fileName, [...f.source]]), warnings: warnings.length };
  };
  expect(run(sf2)).toEqual({ emitted: [['GeneralUser-GS.sf2', [1, 2, 3]]], warnings: 0 });
  expect(run(join(dir, 'none.sf2'))).toEqual({ emitted: [], warnings: 1 });
});
