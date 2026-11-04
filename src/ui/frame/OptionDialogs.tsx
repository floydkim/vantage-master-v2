import { useContext, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { readDialog } from '../../formats/dialogs.ts';
import type { ExeImage } from '../../formats/exeImage.ts';
import type { Sound } from '../battle/sound.ts';
import { ScreenLayer } from './Desktop.tsx';
import { DialogBox } from './DialogBox.tsx';
import { dialogLayout, placeDialog, radioGroup } from './dialogLayout.ts';
import { WIN98 } from './frame.ts';
import { customizeApply, customizeInit, optionClickSounds, soundApply, soundInit } from './options.ts';

export type OptionDialog = 'customize' | 'sound';

const PATTERN = 0xbc1; // Standard ver.2.0, No Guard
const ANIMATION = 0x960; // Animate all … Stop all animation
const BGM = 0x9c4;
const EFFECT = 0x9c5;
const DEVICE = 0x9c6; // CD, MIDI(GM), (0x7a: GS, SC-88)

/**
 * System > Customize(0x44ee63, 템플릿 0x7b)·Sound(0x443511, 0x79/0x7a). 모달이고 자리는 프레임 클라이언트 왼쪽 위(DS_CENTER 없음).
 * 라디오·체크는 소리 4, OK 소리 1·Cancel 소리 2는 옛 효과음 비트로(닫힌 뒤 적용). onClose(새 옵션·장치) 또는 Cancel이면 null
 */
export function OptionDialogs({
  exe,
  which,
  options,
  device,
  devices,
  scene,
  sound,
  onClose,
}: {
  readonly exe: ExeImage;
  readonly which: OptionDialog;
  readonly options: number;
  readonly device: number;
  /** 쓸 수 있는 BGM 장치(라디오 차례 0 CD, 1 MIDI, 2 GS, 3 SC-88): 못 쓰는 것은 회색 */
  readonly devices: readonly boolean[];
  readonly scene: number;
  readonly sound: Sound;
  /** stop·restart는 BGM 장치에 줄 Sound OK 결과(0x443511) */
  readonly onClose: (next: { readonly options: number; readonly device: number; readonly stop: boolean; readonly restart: boolean } | null) => void;
}) {
  const layer = useContext(ScreenLayer);
  const custom = customizeInit(options, scene);
  // 원작은 MIDI\CR000GS.MID가 있을 때만(0x443cae) 네 장치 상자 0x7a. 리메이크는 늘 0x7a이고 GS는 파일이 없어 회색, SC-88은 녹음으로 튼다. CD·SC-88도 음원이 없으면 회색(devices)
  const audio = soundInit(options, device, true);
  const dialog = useMemo(() => readDialog(exe, which === 'customize' ? 0x7b : audio.template), [exe, which, audio.template]);
  const [checked, setChecked] = useState<Record<number, boolean>>(() =>
    which === 'customize'
      ? { [PATTERN + custom.pattern]: true, [ANIMATION + custom.animation]: true }
      : { [BGM]: audio.bgm, [EFFECT]: audio.effects, [DEVICE + audio.device]: true },
  );
  const disabled = new Set(which === 'customize' ? (custom.patternEnabled ? [] : [PATTERN, PATTERN + 1]) : devices.flatMap((ok, i) => (ok ? [] : [DEVICE + i])));
  const play = (n: number) => sound.call(['ui', n]);
  const pick = (group: number[]) => group.findIndex((id) => checked[id]);
  const command = (id: number, code: string) => {
    if (code !== 'click' || disabled.has(id)) return;
    if (id === 1) {
      play(1); // 0x41ba4d: 옛 비트로
      if (which === 'customize') {
        const r = customizeApply(options, scene, Math.max(0, pick([PATTERN, PATTERN + 1])) as 0 | 1, Math.max(0, pick(radioGroup(dialog, ANIMATION))) as 0 | 1 | 2 | 3);
        return onClose({ options: r.options, device, stop: false, restart: false });
      }
      const r = soundApply(options, device, checked[BGM] === true, checked[EFFECT] === true, Math.max(0, pick(radioGroup(dialog, DEVICE))));
      return onClose(r);
    }
    if (id === 2) {
      play(2);
      return onClose(null);
    }
    for (const n of optionClickSounds(which === 'customize' ? 0x7b : 0x79, id)) play(n);
    const group = radioGroup(dialog, id);
    if (group.includes(id)) setChecked((c) => ({ ...c, ...Object.fromEntries(group.map((g) => [g, g === id])) }));
    else if (id === BGM || id === EFFECT) setChecked((c) => ({ ...c, [id]: !c[id] }));
  };
  if (!layer.element) return null;
  const size = dialogLayout(dialog, WIN98).outer;
  const at = placeDialog({ x: 0, y: WIN98.caption + WIN98.menu }, size, WIN98, layer.size); // 프레임은 가상 화면을 채운다
  return createPortal(
    <>
      <div className="battle-backdrop" onContextMenu={(e) => e.preventDefault()} />
      <DialogBox dialog={dialog} at={at} metrics={WIN98} values={{ checked, disabled }} onCommand={command} />
    </>,
    layer.element,
  ); // 가림막: 모달 동안 주 창(프레임·MDI 자식)은 꺼져 입력을 받지 않는다
}
