import { expect, it } from 'vitest';
import { battlePaused, freeBattlePanes, rearrangeNeeded } from '../../src/ui/battle/windowState.ts';

it('창 다시 배치는 Window arrange·클라이언트 크기가 바뀔 때만(마운트 때는 처음 값: 되살린 블록 자리를 덮지 않는다)', () => {
  const at = { arranged: 0, width: 1016, height: 690 };
  expect(rearrangeNeeded(null, at)).toBe(false);
  expect(rearrangeNeeded(at, at)).toBe(false);
  expect(rearrangeNeeded(at, { ...at, arranged: 1 })).toBe(true);
  expect(rearrangeNeeded(at, { ...at, width: 800 })).toBe(true);
  expect(rearrangeNeeded(at, { ...at, height: 500 })).toBe(true);
});

it('원작에서 모달인 것(0x84·MessageBox·슬롯 대화 상자·알림판·결과 창) 동안 전투 콜백·CPU 생각이 멈춘다. 모달리스 정보 대화 상자는 멈추지 않는다', () => {
  const none = { notice: false, ending: false, dialogs: [] };
  expect(battlePaused(none)).toBe(false);
  for (const kind of ['close', 'abort', 'slots', 'writeError', 'giveup']) expect(battlePaused({ ...none, dialogs: [kind] }), kind).toBe(true);
  for (const kind of ['magic', 'summon', 'natial', 'master', 'magicList', 'summonList', 'mp', 'confirm']) expect(battlePaused({ ...none, dialogs: [kind] }), kind).toBe(false);
  expect(battlePaused({ ...none, notice: true })).toBe(true);
  expect(battlePaused({ ...none, ending: true })).toBe(true);
});

it('Free Battle(0x45102d)은 도움말·정보 창·미니맵을 켬으로 되돌린다(채팅은 프리 배틀에 없음). 확대 등 나머지는 그대로', () => {
  const p = { status: false, help: false, view: false, zoom: 2 as const, arranged: 3 };
  expect(freeBattlePanes(p)).toEqual({ status: true, help: true, view: true, zoom: 2, arranged: 3 });
});
