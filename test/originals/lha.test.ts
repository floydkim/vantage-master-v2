import { existsSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { readLha } from '../../src/originals/lha.ts';

const EXE = new URL('../../original/VMOnline.exe', import.meta.url);
const VMO = new URL('../../original/VMO_WIN/', import.meta.url);
const exe = existsSync(EXE) ? new Uint8Array(readFileSync(EXE)) : null;

it.skipIf(!exe)('팔콤 VMOnline.exe(LHA 자체 압축 해제)를 풀면 original/VMO_WIN과 바이트가 같다(-lh0-·-lh5-, 폴더 -lhd-는 건너뜀)', () => {
  const entries = readLha(exe!);
  expect(entries.length).toBeGreaterThan(30);
  const byPath = new Map(entries.map((e) => [e.path, e.data]));
  for (const name of ['vmv2.exe', 'DATA00.DAT', 'DATA00.DIR', 'MIDI/CR000GM.MID', 'FALCOM.AVI']) {
    expect(Buffer.from(byPath.get(`VMO_WIN/${name}`) ?? []).equals(readFileSync(new URL(name, VMO))), name).toBe(true);
  }
  expect(entries.every((e) => !e.path.endsWith('/'))).toBe(true);
}, 30_000);

it.skipIf(!exe)('압축된 데이터가 한 바이트라도 틀리면 CRC로 던진다', () => {
  const broken = exe!.slice();
  const at = broken.indexOf(0x2d, broken.length - 100000); // 아카이브 뒤쪽 데이터 한 곳
  broken[at] ^= 0xff;
  expect(() => readLha(broken)).toThrow();
}, 30_000);

it('잘린 -lh5- 자료(남은 비트가 모두 0이라 블록 크기 0)에서 멈추지 않고 던진다', () => {
  const head = new Uint8Array(26); // 머리 수준 2, 확장 머리 없음, 압축 자료 0바이트
  const v = new DataView(head.buffer);
  v.setUint16(0, 26, true);
  head.set([...'-lh5-'].map((c) => c.charCodeAt(0)), 2);
  v.setUint32(11, 10, true); // 풀면 10바이트
  head[20] = 2;
  expect(() => readLha(head)).toThrow();
});
