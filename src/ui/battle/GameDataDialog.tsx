import { useContext, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { readDialog } from '../../formats/dialogs.ts';
import type { ExeImage } from '../../formats/exeImage.ts';
import { decodeSaveFile, encodeSaveFile } from '../../formats/saveFile.ts';
import { ScreenLayer } from '../frame/Desktop.tsx';
import { DialogBox } from '../frame/DialogBox.tsx';
import { centerDialog, dialogLayout } from '../frame/dialogLayout.ts';
import { WIN98 } from '../frame/frame.ts';
import { IDOK, messageBox } from '../frame/messageBox.ts';
import { gameDataRows } from './gameData.ts';
import { readSave, writeSave } from './saveStore.ts';
import { SlotDialog } from './SlotDialog.tsx';
import type { Sound } from './sound.ts';

const LIST = 0x834;
const LEAVE = 0x84; // Save·Cancel·Surrender(3021), 글 3022
const SAVE_QUESTION = 0x475cdc; // "Do you wish to save the game data?"
const ERROR_TITLE = 0x4758cc;
const WRITE_FAILED = 0x474234; // "Writing failed."
export const READ_FAILED = 0x474224; // "Reading failed."

/**
 * 게임 데이터 대화 상자 0x78(목록 0x834, 80줄 SV000~SV079, 모달, 부모 가운데). 저장(0x441aea: block을 고른 칸에, 덮어쓰기 확인 없음)·
 * 읽기(0x44198d). 실패면 MessageBox(소리 없음). onDone은 읽은 블록·저장한 블록, Cancel·실패는 null
 */
export function GameDataDialog({
  exe,
  mode,
  sound,
  block,
  onDone,
}: {
  readonly exe: ExeImage;
  readonly mode: 'save' | 'load';
  readonly sound: Sound;
  /** 저장할 블록(저장 모드) */
  readonly block?: () => Uint8Array;
  readonly onDone: (block: Uint8Array | null) => void;
}) {
  const layer = useContext(ScreenLayer);
  const dialog = useMemo(() => readDialog(exe, 0x78), [exe]);
  const rows = useMemo(() => gameDataRows(exe), [exe]);
  const [error, setError] = useState<ReturnType<typeof messageBox> | null>(null);
  const close = (slot: number | null) => {
    if (slot === null) return onDone(null);
    if (mode === 'save') {
      const b = block!();
      if (writeSave(slot, encodeSaveFile(b))) return onDone(b);
      return setError(messageBox(exe.cString(ERROR_TITLE), exe.cString(WRITE_FAILED), [{ id: IDOK, text: 'OK' }]));
    }
    try {
      onDone(decodeSaveFile(readSave(slot)!.bytes));
    } catch {
      setError(messageBox(exe.cString(ERROR_TITLE), exe.cString(READ_FAILED), [{ id: IDOK, text: 'OK' }]));
    }
  };
  if (!layer.element) return null;
  const at = (d: typeof dialog) => centerDialog(null, dialogLayout(d, WIN98).outer, layer.size);
  return createPortal(
    <>
      <div className="battle-backdrop" onContextMenu={(e) => e.preventDefault()} />
      {error ? (
        <DialogBox dialog={error} at={at(error)} metrics={WIN98} onCommand={(id) => (id === IDOK || id === 2) && onDone(null)} />
      ) : (
        <SlotDialog dialog={dialog} list={LIST} rows={rows} mode={mode} at={at(dialog)} metrics={WIN98} sound={sound} onClose={close} />
      )}
    </>,
    layer.element,
  );
}

/**
 * vmv2.exe 0x00451bbb(1): 시나리오 월드를 떠날 때 0x42e92b(대화 상자 0x84, 글 0x475cdc). Save(소리 1) → 게임 데이터 저장(0x441aea), 저장하면 떠남·아니면 남음.
 * Surrender(소리 1, 0x42e897) → 떠남, Cancel(소리 2) → 남음
 */
export function LeaveWorldDialog({ exe, sound, block, onDone }: { readonly exe: ExeImage; readonly sound: Sound; readonly block: () => Uint8Array; readonly onDone: (leave: boolean) => void }) {
  const layer = useContext(ScreenLayer);
  const dialog = useMemo(() => readDialog(exe, LEAVE), [exe]);
  const [saving, setSaving] = useState(false);
  if (saving) return <GameDataDialog exe={exe} mode="save" sound={sound} block={block} onDone={(b) => onDone(b !== null)} />;
  if (!layer.element) return null;
  return createPortal(
    <>
      <div className="battle-backdrop" onContextMenu={(e) => e.preventDefault()} />
      <DialogBox
        dialog={dialog}
        at={centerDialog(null, dialogLayout(dialog, WIN98).outer, layer.size)}
        metrics={WIN98}
        values={{ texts: { 3022: exe.cString(SAVE_QUESTION) } }}
        onCommand={(id) => {
          if (id === 2) {
            sound.call(['ui', 2]);
            return onDone(false);
          }
          if (id !== 1 && id !== 3021) return;
          sound.call(['ui', 1]);
          if (id === 1) setSaving(true);
          else onDone(true);
        }}
      />
    </>,
    layer.element,
  );
}
