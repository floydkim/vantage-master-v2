// 전장 창의 장면 상태 규칙(DOM 없음): 언제 창을 다시 배치하나, 언제 전투가 멈추나

/** 원작에서 모달인 대화 상자: 닫기 확인 0x84·MessageBox(0x42e7f7·0x44ea4c)·슬롯 대화 상자 0x76. 정보·목록·알림 0x6f~0x82·0x73·0x74는 모달리스 */
const MODAL = new Set(['close', 'abort', 'slots', 'writeError', 'giveup']);

/** 대기 루프 0x44db4f가 48ms 콜백(0x50400c)을 부르지 않는 동안: 모달 상자, 알림판(0x42e186), 결과 창(콜백이 0x4083df로 바뀜). CPU 생각도 멈춘다 */
export function battlePaused(o: { readonly notice: boolean; readonly ending: boolean; readonly dialogs: readonly string[] }): boolean {
  return o.notice || o.ending || o.dialogs.some((d) => MODAL.has(d));
}

/** Free Battle(0x45102d): 창 켬 플래그(블록 +0x288 도움말·+0x2bc 정보 창·+0x2c8 미니맵)를 1로. 나머지는 그대로 */
export function freeBattlePanes<T extends { readonly help: boolean; readonly status: boolean; readonly view: boolean }>(p: T): T {
  return { ...p, help: true, status: true, view: true };
}

export interface ArrangeKey {
  readonly arranged: number;
  readonly width: number;
  readonly height: number;
}

/** Window arrange(0x40e4cd)·MDI 클라이언트 크기가 바뀔 때만 다시 배치한다. 마운트 때(prev 없음)는 처음 값(새 전투는 배치, 되살리기는 블록 자리) */
export function rearrangeNeeded(prev: ArrangeKey | null, next: ArrangeKey): boolean {
  return prev !== null && (prev.arranged !== next.arranged || prev.width !== next.width || prev.height !== next.height);
}
