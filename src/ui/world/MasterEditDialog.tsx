import { useContext, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { readDescriptions } from '../../formats/descriptions.ts';
import { readDialog } from '../../formats/dialogs.ts';
import { readMasterNames, readMasterTable } from '../../formats/masterTable.ts';
import { hangulOn } from '../../i18n/hangul.ts';
import { readMasterClassNames } from '../battle/continueData.ts';
import type { Original } from '../battle/original.ts';
import { Picture } from '../battle/Picture.tsx';
import type { Sound } from '../battle/sound.ts';
import { ScreenLayer } from '../frame/Desktop.tsx';
import { DialogBox } from '../frame/DialogBox.tsx';
import { dialogLayout, fitPicture } from '../frame/dialogLayout.ts';
import { WIN98 } from '../frame/frame.ts';
import type { Point } from '../frame/layout.ts';
import {
  acceptName,
  EDIT_NAME,
  EDIT_RANGES,
  EDIT_SOUNDS,
  LEVEL,
  LIST,
  type MasterEdit,
  NAME_EDIT,
  NAME_LABEL,
  nameDialogAt,
  nameLabel,
  portraitRect,
  renamed,
  selectMaster,
  setLevel,
  setStat,
  STANDARD_NAME,
  STAT_EDITS,
  useStandardName,
} from './masterEdit.ts';
import { masterEditPortrait, type WorldArt } from './worldArt.ts';

/** 열린 마스터 편집(0x483ef8 객체)과 그 자식 이름 입력 */
export interface Editing {
  readonly side: number;
  readonly edit: MasterEdit;
  /** 바깥 왼쪽 위(가상 화면 좌표, 0x42c4d6) */
  readonly at: Point;
  readonly name: { readonly text: string; readonly at: Point } | null;
}

const PORTRAIT_SIZE = { width: 48, height: 67 };

/**
 * 마스터 편집 대화 상자(0x7d, 모달리스, 처리기 0x42ce52)와 이름 입력(0x86, 0x42c3f6). onEditing으로 바뀐 편집을, onDone으로 OK(편집)·Cancel(null)을 알린다.
 * 도움말 문구는 열 때·목록이 바뀔 때 마스터 설명(onHelp)
 */
export function MasterEditDialog({
  original,
  art,
  colors,
  sound,
  editing,
  onEditing,
  onHelp,
  onDone,
}: {
  readonly original: Original;
  readonly art: WorldArt;
  readonly colors: Uint8Array;
  readonly sound: Sound;
  readonly editing: Editing;
  readonly onEditing: (e: Editing) => void;
  readonly onHelp: (text: string) => void;
  readonly onDone: (edit: MasterEdit | null) => void;
}) {
  const { exe } = original;
  const layer = useContext(ScreenLayer);
  const t = useMemo(
    () => ({
      edit: readDialog(exe, 0x7d),
      name: readDialog(exe, 0x86),
      data: { masters: readMasterTable(exe) },
      names: readMasterNames(exe),
      classes: readMasterClassNames(exe),
      descriptions: readDescriptions(exe).masters,
    }),
    [exe],
  );
  const { edit, side } = editing;
  const portrait = useMemo(() => masterEditPortrait(art, edit.master, side), [art, edit.master, side]);
  const play = (sounds: readonly number[]) => sounds.forEach((n) => sound.call(['ui', n]));
  const set = (e: MasterEdit) => onEditing({ ...editing, edit: e });
  const stats = [edit.maxMp, edit.attack, edit.defense, edit.magic, edit.magicDefense, edit.speed, edit.movement];
  const values = {
    texts: { [LEVEL]: String(edit.level + 1), [NAME_LABEL]: nameLabel(edit.name), ...Object.fromEntries(STAT_EDITS.map((id, k) => [id, String(stats[k])])) },
    lists: { [LIST]: { items: t.classes, selected: edit.master } },
    ranges: EDIT_RANGES,
  };
  const ok = () => {
    play(EDIT_SOUNDS.ok); // 0x42b427
    onDone(edit);
  };
  const command = (id: number, code: 'click' | 'select' | 'double' | 'update', index?: number, text?: string) => {
    if (id === LIST && (code === 'select' || code === 'double') && index !== undefined) {
      const next = selectMaster(t.data, t.names, edit, index); // 0x42c9ac
      if (next) {
        play(EDIT_SOUNDS.select);
        onHelp(t.descriptions[next.master]);
      }
      if (code === 'double') {
        play(EDIT_SOUNDS.ok);
        onDone(next ?? edit);
      } else if (next) set(next);
      return;
    }
    if (code === 'update') {
      const v = Number.parseInt(text ?? '', 10);
      if (id === LEVEL) set(setLevel(t.data, edit, v - 1)); // EN_UPDATE(0x5dc) → 0x42db87
      else set(setStat(edit, id, v));
      return;
    }
    if (code !== 'click') return;
    if (id === 1) ok();
    else if (id === 2) {
      play(EDIT_SOUNDS.cancel); // 0x42b3f0
      onDone(null);
    } else if (id === EDIT_NAME) {
      play(EDIT_SOUNDS.editName);
      const outer = dialogLayout(t.edit, WIN98).outer;
      const size = dialogLayout(t.name, WIN98).outer;
      const parent = { left: editing.at.x, top: editing.at.y, right: editing.at.x + outer.width, bottom: editing.at.y + outer.height };
      onEditing({ ...editing, name: { text: edit.name, at: nameDialogAt(parent, size, layer.size) } });
    } else if (id === STANDARD_NAME) {
      play(EDIT_SOUNDS.standardName);
      set(useStandardName(t.names, edit));
    }
  };
  const nameCommand = (id: number, code: 'click' | 'select' | 'double' | 'update', _index?: number, text?: string) => {
    const name = editing.name!;
    if (id === NAME_EDIT && code === 'update') return onEditing({ ...editing, name: { ...name, text: text ?? '' } });
    if (code !== 'click') return;
    if (id === 1) {
      // 0x42c3ab: 1~16바이트가 아니면 소리 3, 열린 채
      if (!acceptName(name.text)) return play(EDIT_SOUNDS.nameRejected);
      play(EDIT_SOUNDS.nameOk);
      onEditing({ ...editing, edit: renamed(edit, name.text), name: null });
    } else if (id === 2) {
      play(EDIT_SOUNDS.cancel);
      onEditing({ ...editing, name: null });
    }
  };
  if (!layer.element) return null;
  return createPortal(
    <>
      <DialogBox dialog={t.edit} at={editing.at} metrics={WIN98} values={values} enabled={editing.name === null} onCommand={command}>
        <Picture image={portrait} size={PORTRAIT_SIZE} rect={fitPicture(portraitRect(hangulOn()), PORTRAIT_SIZE)} colors={colors} />
      </DialogBox>
      {editing.name && <DialogBox dialog={t.name} at={editing.name.at} metrics={WIN98} values={{ texts: { [NAME_EDIT]: editing.name.text } }} onCommand={nameCommand} />}
    </>,
    layer.element,
  );
}
