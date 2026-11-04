import { describe, expect, it } from 'vitest';
import { decodeState } from '../../src/engine/state.ts';
import { MAP_COUNT, loadMap } from '../../src/formats/mapData.ts';
import { decodeSaveFile } from '../../src/formats/saveFile.ts';
import type { Point, Rect } from '../../src/ui/frame/layout.ts';
import { continueBlock, continueRow, firstSlotIds, readMasterClassNames, readWindows, slotCommand, writeWindows } from '../../src/ui/battle/continueData.ts';
import { readGolden } from '../engine/block.ts';
import { exe, read } from './screenCases.ts';
import { inflateSync } from 'node:zlib';

type Box = readonly [number, number, number, number] | null;
interface Row {
  readonly n?: number;
  readonly id?: number;
  readonly date?: readonly number[];
  readonly valid: number;
  readonly text: string;
}
interface Case {
  readonly kind: 'save' | 'row';
  readonly args: { readonly map: number; readonly block?: string; readonly windows?: Readonly<Record<'battle' | 'view' | 'status' | 'help', Box>>; readonly slot?: number; readonly id: number; readonly file?: string; readonly n?: number; readonly date?: readonly number[] };
  readonly expected: { readonly file?: string; readonly rows?: readonly Row[] } & Partial<Row>;
}
const cases = readGolden<Case>('continue');
const names = { maps: Array.from({ length: MAP_COUNT }, (_, i) => loadMap(exe, read, i).header.name), masters: readMasterClassNames(exe) };
const b64 = (s: string) => new Uint8Array(Buffer.from(s, 'base64'));
const rect = (b: Box): Rect | undefined => (b ? { left: b[0], top: b[1], right: b[2], bottom: b[3] } : undefined);
const point = (b: Box): Point | undefined => (b ? { x: b[0], y: b[1] } : undefined);

// 원작 압축은 유닛 수 뒤 칸에 이전 압축을 남기고, 표시 애니메이션 값(+0x03 % 3, +0x04)은 저장 순간 값이다. 진영 상태 +0x14는 실행 중 주소
function comparable(block: Uint8Array): Uint8Array {
  const out = new Uint8Array(block);
  const count = new DataView(out.buffer).getInt32(0x9e8, true);
  for (let i = 0; i < count; i++) {
    out[0x2e0 + i * 0x24 + 3] -= out[0x2e0 + i * 0x24 + 3] % 3;
    out[0x2e0 + i * 0x24 + 4] = 0;
  }
  out.fill(0, 0x2e0 + count * 0x24, 0x9e8);
  out.fill(0, 0xa00, 0xa04);
  out.fill(0, 0xa18, 0xa1c);
  return out;
}

describe('이어 하기', () => {
  it('저장 블록(0x441e36): 유닛 압축, 있는 창만 바깥 사각형(MDI 클라이언트 좌표), 블록 +0 = 슬롯 식별값이 원작 파일과 같다', () => {
    for (const c of cases.filter((k) => k.kind === 'save')) {
      const before = new Uint8Array(inflateSync(Buffer.from(c.args.block!, 'base64')));
      const w = c.args.windows!;
      const ours = continueBlock(decodeState(before), { battle: rect(w.battle), status: point(w.status), view: point(w.view), help: point(w.help) }, c.args.id);
      const theirs = decodeSaveFile(b64(c.expected.file!));
      const diff = [...comparable(ours)].flatMap((v, i) => (v === comparable(theirs)[i] ? [] : [`+0x${i.toString(16)}`]));
      expect(diff, `칸 ${c.args.slot}`).toEqual([]);
    }
  });

  it('목록 줄(0x44161a): 이어 하기·게임 데이터 형식, 식별값이 틀리면 대시 줄, 날짜(월·일·시 공백 채움), 넘치면 앞 76자', () => {
    const rows: { file: Uint8Array; row: Row }[] = [];
    for (const c of cases) {
      if (c.kind === 'save') for (const r of c.expected.rows!) rows.push({ file: b64(c.expected.file!), row: r });
      else rows.push({ file: b64(c.args.file!), row: { n: c.args.n, id: c.args.id, date: c.args.date, valid: c.expected.valid!, text: c.expected.text! } });
    }
    for (const { file, row } of rows) {
      expect(continueRow(exe, file, row.n!, row.id!, row.date!, names), row.text).toEqual({ valid: row.valid === 1, text: row.text.slice(0, 76) });
    }
    expect(rows.some((r) => r.row.text.length > 76)).toBe(true);
    expect(continueRow(exe, null, 103, 5, [2026, 1, 2, 3, 4], names)).toEqual({ valid: false, text: rows.find((r) => r.row.valid === 0)!.row.text });
  });

  it('창 구간을 쓰고 읽으면 같다(되살리기 0x401899·0x401b12)', () => {
    const block = new Uint8Array(0xe6c);
    const places = {
      world: { left: 0, top: 0, right: 790, bottom: 560 },
      mapInfo: { x: 790, y: 0 },
      masterInfo: { x: 600, y: 365 },
      help: { x: 0, y: 566 },
      chat: { left: 0, top: 566, right: 536, bottom: 730 },
      battle: { left: 0, top: 0, right: 758, bottom: 566 },
      status: { x: 758, y: 196 },
      view: { x: 758, y: 0 },
      flags: { help: true, chat: false, status: true, view: false },
      zoom: 2,
    };
    writeWindows(block, places);
    expect(readWindows(block)).toEqual(places);
  });

  it('처음 슬롯 식별값은 시드 1의 rand 8개(2 미만은 + 2), 슬롯 대화 상자 규칙(0x441199·0x44112c)', () => {
    expect(firstSlotIds()).toEqual([41, 18467, 6334, 26500, 19169, 15724, 11478, 29358]);
    expect(slotCommand('save', null, 'ok')).toEqual({ sound: 3, close: null });
    expect(slotCommand('save', false, 'ok')).toEqual({ sound: 1, close: 'ok' });
    expect(slotCommand('save', true, 'double')).toEqual({ sound: null, close: null });
    expect(slotCommand('load', false, 'ok')).toEqual({ sound: 3, close: null });
    expect(slotCommand('load', true, 'double')).toEqual({ sound: 1, close: 'ok' });
    expect(slotCommand('load', false, 'double')).toEqual({ sound: 3, close: null });
    expect(slotCommand('load', null, 'cancel')).toEqual({ sound: 2, close: 'cancel' });
  });
});
