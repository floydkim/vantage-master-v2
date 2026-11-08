import { crc32 } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { freeModeSides } from '../../src/engine/battleStart.ts';
import type { SideRecord } from '../../src/engine/state.ts';
import { readDescriptions } from '../../src/formats/descriptions.ts';
import { readFreeModeNames, readMasterNames, readMasterTable } from '../../src/formats/masterTable.ts';
import { readMasterClassNames } from '../../src/ui/battle/continueData.ts';
import {
  acceptName,
  applyEdit,
  EDIT_RANGES,
  EDIT_SOUNDS,
  editDialogAt,
  editOf,
  type MasterEdit,
  nameDialogAt,
  nameLabel,
  renamed,
  selectMaster,
  setLevel,
  setStat,
  STAT_EDITS,
  useStandardName,
} from '../../src/ui/world/masterEdit.ts';
import { loadWorldArt, mapDescription, MASTER_INFO_W, masterEditPortrait, masterInfoImage } from '../../src/ui/world/worldArt.ts';
import { readGolden } from '../engine/block.ts';
import { exe, mapOf, read } from './screenCases.ts';

type Action = [string, ...(number | string | number[])[]];
interface Step {
  sounds: number[];
  help: string;
  edit: { name: string; standardName: number; attackAction: number; master: number; level: number; stats: number[] } | null;
  records: { name: string; standardName: number; attackAction: number; master: number; level: number; stats: number[] }[];
  texts?: Record<string, string>;
  list?: number;
  items?: string[];
  ranges?: Record<string, [number, number]>;
  nameText?: string;
  hover?: number;
  bands?: number[];
  blits?: { dst: number[]; src: number[]; rop: number; crc: number }[];
}
interface Case {
  kind: 'session' | 'portraits' | 'positions';
  args: { map?: number; actions?: Action[] };
  expected: {
    steps?: Step[];
    cases?: { cursor: [number, number]; main: [number, number, number, number]; size: [number, number]; edit: [number, number]; names: { parent: [number, number, number, number]; size: [number, number]; at: [number, number] }[] }[];
  };
}
const cases = readGolden<Case>('masterEdit');
const data = { masters: readMasterTable(exe) };
const names = readMasterNames(exe);
const descriptions = readDescriptions(exe).masters;
const art = loadWorldArt(exe, read);
const map = mapOf(3);
const statsOf = (e: Pick<MasterEdit, 'maxMp' | 'attack' | 'defense' | 'magic' | 'magicDefense' | 'speed' | 'movement'>) => [e.maxMp, e.attack, e.defense, e.magic, e.magicDefense, e.speed, e.movement];
const bands = (img: Uint8Array) => Array.from({ length: 416 / 16 }, (_, b) => crc32(img.subarray(b * 16 * MASTER_INFO_W, (b + 1) * 16 * MASTER_INFO_W)));
const recordView = (r: SideRecord) => ({ name: r.name, standardName: r.standardName, attackAction: r.attackAction, master: r.master, level: r.level, stats: statsOf(r) });

// 픽스처의 사용자 흉내를 TS 함수로 따라 한다. 열린 동안은 보이는 글자(texts), 닫히면 레코드와 비교
function replay(c: Case, sides: [SideRecord, SideRecord]): string[] {
  const wrong: string[] = [];
  let edit: MasterEdit | null = null;
  let side = 0;
  let nameOpen = false;
  let nameText = '';
  let help = mapDescription(map, false);
  let hover = -1;
  c.args.actions!.forEach((a, i) => {
    const want = c.expected.steps![i];
    let sounds: readonly number[] = [];
    let redraw = false;
    const close = () => {
      edit = null;
      nameOpen = false;
      help = mapDescription(map, false); // 0x424e78
    };
    switch (a[0]) {
      case 'open':
        if (!edit) {
          side = a[1] as number;
          edit = editOf(sides[side]);
          sounds = EDIT_SOUNDS.open;
          help = descriptions[edit.master];
          hover = side * 32;
          redraw = true;
        }
        break;
      case 'select': {
        const next = selectMaster(data, names, edit!, a[1] as number);
        if (next) {
          edit = next;
          sounds = EDIT_SOUNDS.select;
          help = descriptions[next.master];
        }
        break;
      }
      case 'level':
        edit = setLevel(data, edit!, Number(a[1]) - 1);
        break;
      case 'stat':
        edit = setStat(edit!, a[1] as number, Number(a[2]));
        break;
      case 'editName':
        sounds = EDIT_SOUNDS.editName;
        nameOpen = true;
        nameText = edit!.name;
        break;
      case 'nameOk':
        nameText = a[1] as string;
        if (acceptName(nameText)) {
          sounds = EDIT_SOUNDS.nameOk;
          edit = renamed(edit!, nameText);
          nameOpen = false;
        } else sounds = EDIT_SOUNDS.nameRejected;
        break;
      case 'nameCancel':
        sounds = EDIT_SOUNDS.cancel;
        nameOpen = false;
        break;
      case 'standardName':
        sounds = EDIT_SOUNDS.standardName;
        edit = useStandardName(names, edit!);
        break;
      case 'ok':
      case 'double':
        sounds = EDIT_SOUNDS.ok;
        sides[side] = applyEdit(sides[side], edit!);
        close();
        redraw = true;
        break;
      case 'cancel':
        sounds = EDIT_SOUNDS.cancel;
        close();
        break;
      case 'closeInfo':
        close(); // 0x42aeb6: 소리 없이 버림
        break;
      case 'selectMap':
        sounds = [1];
        hover = -1;
        redraw = true;
        break;
      case 'poke': {
        const [maxMp, attack, defense, magic, magicDefense, speed, movement] = a[2] as number[];
        sides[a[1] as number] = { ...sides[a[1] as number], maxMp, attack, defense, magic, magicDefense, speed, movement };
        break;
      }
    }
    const label = `${i} ${JSON.stringify(a)}`;
    const e = edit as MasterEdit | null;
    const ours: Record<string, unknown> = { sounds, help, open: e !== null, records: sides.map(recordView) };
    const theirs: Record<string, unknown> = { sounds: want.sounds, help: want.help, open: want.edit !== null, records: want.records.map(({ name, standardName, attackAction, master, level, stats }) => ({ name, standardName, attackAction, master, level, stats })) };
    if (e && want.edit) {
      ours.edit = { name: e.name, standardName: e.standardName, attackAction: e.attackAction, master: e.master };
      theirs.edit = { name: want.edit.name, standardName: want.edit.standardName, attackAction: want.edit.attackAction, master: want.edit.master };
      ours.texts = { [0x5dc]: String(e.level + 1), [0x640]: nameLabel(e.name), ...Object.fromEntries(STAT_EDITS.map((id, k) => [id, String(statsOf(e)[k])])) };
      theirs.texts = Object.fromEntries(Object.entries(want.texts!).filter(([k]) => Number(k) !== 0x8fc));
      ours.list = e.master;
      theirs.list = want.list;
      ours.name = nameOpen ? nameText : undefined;
      theirs.name = want.nameText;
    }
    expect(ours, label).toEqual(theirs);
    if (want.items) expect(want.items, '목록 0x469014').toEqual(readMasterClassNames(exe));
    if (want.bands && redraw) {
      const d = bands(masterInfoImage(art, sides, [0, 1], hover, true));
      const diff = d.flatMap((v, k) => (v === want.bands![k] ? [] : [k]));
      if (diff.length) wrong.push(`${label}: 마스터 정보 띠 ${diff}`);
    }
    if (want.blits) {
      const p = masterEditPortrait(art, e!.master, side);
      const as = (from: number, to: number) => crc32(p.map((v) => (v === from ? to : v)));
      expect(want.blits.map((b) => [b.dst, b.src, b.crc]), `${label} 초상`).toEqual([
        [[141, 133, 96, 134], [0, 0, 48, 67], as(0x10, 0xff)],
        [[141, 133, 96, 134], [0, 0, 48, 67], as(0x10, 0)],
      ]);
    }
  });
  return wrong;
}

describe('마스터 편집(0x7d)·이름 입력(0x86)', () => {
  const fresh = (): [SideRecord, SideRecord] => freeModeSides({ masters: readMasterTable(exe), names: readFreeModeNames(exe) });
  const session = cases.find((k) => k.kind === 'session')!;

  it('사용자 흉내 세션: 글자·소리·도움말·레코드·마스터 정보 그림이 원작과 같다', () => {
    expect(replay(session, fresh())).toEqual([]);
  });

  it('초상(0x42cb2a): 마스터 5명 × 진영 둘, 0x10 투명 두 번 그리기', () => {
    // 픽스처는 세션을 마친 같은 VM에서 떴다: 세션의 편집을 먼저 적용한 진영에서
    const sides = fresh();
    replay(session, sides);
    expect(replay(cases.find((k) => k.kind === 'portraits')!, sides)).toEqual([]);
  });

  it('목록 선택(0x42c9ac): 표준 이름 칸(+0x3c)이 0이 아니면 이름도 새 마스터 기본 이름으로(손으로 고친 저장의 2도)', () => {
    const data = { masters: readMasterTable(exe) };
    const names = readMasterNames(exe);
    const e = { ...editOf(fresh()[0]), name: 'Hand', standardName: 2 };
    expect(selectMaster(data, names, e, (e.master + 1) % 5)!.name).toBe(names[(e.master + 1) % 5]);
    expect(selectMaster(data, names, { ...e, standardName: 0 }, (e.master + 1) % 5)!.name).toBe('Hand');
  });

  it('범위(UDM_SETRANGE)와 기본 이름 27개(0x468fa8)', () => {
    const open = cases.find((k) => k.kind === 'session')!.expected.steps![0];
    expect(open.ranges).toEqual(EDIT_RANGES); // 대화 상자가 쓰는 범위가 원작 UDM_SETRANGE와 같다
    expect(names.length).toBe(27);
    expect(names.slice(0, 2)).toEqual(readFreeModeNames(exe));
  });

  it('자리: 편집은 커서 기준(0x42c4d6), 이름 입력은 부모 가운데·7/8(0x42c2a6)', () => {
    for (const p of cases.find((k) => k.kind === 'positions')!.expected.cases!) {
      const [l, t, r, b] = p.main;
      const at = editDialogAt({ x: p.cursor[0], y: p.cursor[1] }, { width: p.size[0], height: p.size[1] }, { left: l, top: t, right: r, bottom: b }, { width: 1024, height: 768 });
      expect([at.x, at.y], JSON.stringify(p.cursor)).toEqual(p.edit);
      for (const n of p.names) {
        const [pl, pt, pr, pb] = n.parent;
        const nat = nameDialogAt({ left: pl, top: pt, right: pr, bottom: pb }, { width: n.size[0], height: n.size[1] }, { width: 1024, height: 768 });
        expect([nat.x, nat.y], JSON.stringify(n.parent)).toEqual(n.at);
      }
    }
  });
});
