import { useState } from 'react';
import type { Dialog } from '../../formats/dialogs.ts';
import { DialogBox } from '../frame/DialogBox.tsx';
import type { Metrics } from '../frame/frame.ts';
import type { Point } from '../frame/layout.ts';
import { type SlotMode, slotCommand } from './continueData.ts';
import type { Sound } from './sound.ts';

/** 슬롯 대화 상자 0x76 "Countinue Data"·0x78 "Game Data"(0x441060 → 0x41bb7b 모달, 목록 id는 객체 +0x24): 처음엔 고른 칸이 없다. 닫히면 고른 칸(OK) 또는 null(Cancel) */
export function SlotDialog({
  dialog,
  list = 0x898,
  rows,
  mode,
  at,
  metrics,
  sound,
  onClose,
}: {
  readonly dialog: Dialog;
  /** 목록 상자 id(0x76은 0x898, 0x78은 0x834) */
  readonly list?: number;
  readonly rows: readonly { readonly valid: boolean; readonly text: string }[];
  readonly mode: SlotMode;
  readonly at: Point;
  readonly metrics: Metrics;
  readonly sound: Sound;
  readonly onClose: (slot: number | null) => void;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const press = (action: 'ok' | 'double' | 'cancel', slot = selected) => {
    const r = slotCommand(mode, slot === null ? null : rows[slot].valid, action);
    if (r.sound !== null) sound.call(['ui', r.sound]);
    if (r.close === 'ok') onClose(slot);
    else if (r.close === 'cancel') onClose(null);
  };
  return (
    <DialogBox
      dialog={dialog}
      at={at}
      metrics={metrics}
      values={{ lists: { [list]: { items: rows.map((r) => r.text), selected } } }}
      onCommand={(id, code, k) => {
        if (code === 'select') return setSelected(k!); // LBN_SELCHANGE는 소리 없음
        if (code === 'double') return press('double', k!);
        if (id === 1) press('ok');
        else if (id === 2) press('cancel');
      }}
    />
  );
}
