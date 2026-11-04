import { afterEach, expect, it, vi } from 'vitest';
import { loadDat, loadPalette } from '../../src/ui/assetViewer/loadDat.ts';
import { readOriginal } from '../original.ts';

afterEach(() => vi.unstubAllGlobals());

const serveOriginal = () =>
  vi.fn(async (url: string) => new Response(readOriginal(url.replace('/VMO_WIN/', ''))));

it('원본 파일이 없으면 받는 방법을 알려주며 실패하고, 실패는 캐시하지 않는다', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));
  await expect(loadDat(1)).rejects.toThrow('pnpm fetch-original');

  vi.stubGlobal('fetch', serveOriginal());
  expect((await loadDat(1)).dat.entryCount).toBe(210);
});

it('DAT과 DIR을 받아 열고, index.html 대체 응답을 막는 Accept 헤더를 보낸다', async () => {
  const fetchMock = serveOriginal();
  vi.stubGlobal('fetch', fetchMock);
  const { dat, names } = await loadDat(9);
  expect(dat.entryCount).toBe(170);
  expect(names?.[0]).toBe('ED000._SC');
  expect(fetchMock).toHaveBeenCalledWith('/VMO_WIN/DATA09.DIR', { headers: { Accept: 'application/octet-stream' } });
});

it('팔레트 지정이 비어 있으면 회색조, 있으면 지정한 칸부터 채운다', async () => {
  vi.stubGlobal('fetch', serveOriginal());
  expect([...(await loadPalette('')).subarray(9, 12)]).toEqual([3, 3, 3]);
  const table = await loadPalette('0:1@10');
  expect([...table.subarray(0, 3)]).toEqual([255, 0, 255]);
  expect([...table.subarray(33, 36)]).toEqual([255, 255, 240]);
});
