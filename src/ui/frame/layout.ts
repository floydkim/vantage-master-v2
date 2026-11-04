// MDI 자식 창 배치 공식(MDI 클라이언트 좌표). 창 바깥 크기는 고정 창이 클라이언트 + 대화 틀·캡션, 크기 조절 창이 + 크기 틀(+ 스크롤 막대)
import type { Metrics } from './frame.ts';

export interface Rect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}
export interface Point {
  readonly x: number;
  readonly y: number;
}
export interface Size {
  readonly width: number;
  readonly height: number;
}
/** 켜 둔 창: 도움말(블록 +0x288)·채팅(+0x294) */
export interface Panes {
  readonly help: boolean;
  readonly chat: boolean;
}

// 고정 창(최대·최소·크기 조절 없음)의 바깥 크기
const fixed = (m: Metrics, width: number, height: number): Size => ({ width: width + m.dlgFrame * 2, height: height + m.caption + m.dlgFrame * 2 });

/** 창 클라이언트 크기 */
export const CLIENT = {
  view: { width: 260, height: 168 }, // 0x40d449·0x40d45d 미니맵
  status: { width: 260, height: 339 }, // 0x40ac39·0x40ac4d 정보 창
  help: { width: 624, height: 136 }, // 0x424b69·0x424b7d 도움말
  mapInfo: { width: 308, height: 340 }, // 0x4297d9·0x4297ed
  masterInfo: { width: 416, height: 416 }, // 0x42ac69·0x42ac7d
  world: { width: 768, height: 512 }, // 월드 창(크기 조절, 스크롤)
  chatWidth: 512, // 0x417c79(크기 조절, 세로 스크롤)
  makeMaster: { width: 608, height: 448 }, // 0x426d90 Master making
} as const;

/** 창 바깥 크기(MoveWindow에 주는 크기) */
export const outer = (m: Metrics) => ({
  view: fixed(m, CLIENT.view.width, CLIENT.view.height),
  status: fixed(m, CLIENT.status.width, CLIENT.status.height),
  help: fixed(m, CLIENT.help.width, CLIENT.help.height),
  mapInfo: fixed(m, CLIENT.mapInfo.width, CLIENT.mapInfo.height),
  masterInfo: fixed(m, CLIENT.masterInfo.width, CLIENT.masterInfo.height),
  chatWidth: CLIENT.chatWidth + m.scroll + m.frame * 2,
  makeMaster: fixed(m, CLIENT.makeMaster.width, CLIENT.makeMaster.height),
});

/** vmv2.exe 0x00426d90: Master making 창은 프레임 클라이언트 가운데(위가 0보다 작으면 0) */
export function makeMasterRect(client: Size, m: Metrics): Rect {
  const { width, height } = outer(m).makeMaster;
  const left = Math.trunc((client.width - width) / 2);
  const top = Math.max(Math.trunc((client.height - height) / 2), 0);
  return { left, top, right: left + width, bottom: top + height };
}

export interface WorldLayout {
  readonly world: Rect;
  readonly mapInfo: Point;
  readonly masterInfo: Point;
  readonly help: Point;
  readonly chat: Rect;
}

// vmv2.exe 0x00451361: 채팅 창은 왼쪽 아래(높이는 도움말 창 높이), 도움말 창은 아래. 둘 다 켜져 있으면 나란히 둘 자리가 있으면 채팅 오른쪽,
// 아니면(정보 창까지 나란히 못 두고 미니맵 + 정보 창 + 도움말이 세로로 안 들어가면) 높이가 남을 때 채팅 위로. 아래 띠의 윗변을 돌려준다
function arrange(client: Size, m: Metrics, panes: Panes): { help: Point; chat: Rect; top: number } {
  const o = outer(m);
  const { width: w, height: h } = client;
  const chat = { left: 0, top: h - o.help.height, right: Math.min(w, o.chatWidth), bottom: h };
  let help = { x: 0, y: h - o.help.height };
  if (panes.help && panes.chat) {
    const beside = () => (help = { ...help, x: help.x + o.chatWidth });
    if (w < o.chatWidth + o.help.width + o.status.width) {
      if (o.chatWidth + o.help.width <= w && o.status.height + o.help.height + o.view.height <= h) beside();
      else if (o.help.height + 0x80 < h - o.help.height) help = { ...help, y: help.y - o.help.height };
    } else beside();
  }
  return { help, chat, top: help.y };
}

/** vmv2.exe 0x004510ca: 월드 장면 배치(월드 창, 맵 정보·마스터 정보 창 자리, 도움말·채팅) */
export function worldLayout(client: Size, m: Metrics, panes: Panes): WorldLayout {
  const { help, chat, top } = arrange(client, m, panes);
  const worldW = CLIENT.world.width + m.frame * 2;
  const worldH = CLIENT.world.height + m.caption + m.frame * 2;
  let right = Math.min(worldW + m.scroll, client.width);
  let bottom = Math.min(worldH + m.scroll, top);
  if (worldW <= right && worldH <= bottom) {
    right = worldW; // 스크롤 막대가 필요 없는 크기
    bottom = worldH;
  }
  const o = outer(m);
  const beside = (width: number) => (width < client.width - right ? right : Math.max(client.width - width, 0));
  let masterY = o.mapInfo.height;
  if (client.height < masterY + o.masterInfo.height) masterY = Math.max(client.height - o.masterInfo.height, 0);
  return { world: { left: 0, top: 0, right, bottom }, mapInfo: { x: beside(o.mapInfo.width), y: 0 }, masterInfo: { x: beside(o.masterInfo.width), y: masterY }, help, chat };
}

export interface BattleLayout {
  readonly battle: Rect;
  readonly view: Point;
  readonly status: Point;
}

/** vmv2.exe 0x0040e3be: 전투 장면 배치. 미니맵은 오른쪽 위, 정보 창은 그 아래, 전장 창은 남은 왼쪽(아래는 채팅·도움말 창 위까지, 그 y가 0x80 넘을 때) */
export function battleLayout(client: Size, m: Metrics, panes: Panes, help: Point, chat: Rect): BattleLayout {
  const o = outer(m);
  const view = { x: client.width - o.view.width, y: 0 };
  const status = { x: client.width - o.status.width, y: view.y + o.view.height };
  let bottom = client.height;
  if (panes.chat && chat.top > 0x80) bottom = chat.top;
  if (panes.help && help.y > 0x80 && help.y < bottom) bottom = help.y;
  return { battle: { left: 0, top: 0, right: Math.min(view.x, status.x), bottom }, view, status };
}

/** 프리 배틀 전투 장면 창 배치(바깥 사각형): 도움말 자리는 월드 배치(도움말 켬·채팅 끔), 전장·정보 창·미니맵은 전투 배치(0x40e3be, 지금 도움말 켬) */
export function battleArrange(client: Size, m: Metrics, help: boolean): { readonly battle: Rect; readonly status: Rect; readonly help: Rect; readonly view: Rect } {
  const w = worldLayout(client, m, { help: true, chat: false });
  const b = battleLayout(client, m, { help, chat: false }, w.help, w.chat);
  const o = outer(m);
  const at = (p: Point, size: Size): Rect => ({ left: p.x, top: p.y, right: p.x + size.width, bottom: p.y + size.height });
  return { battle: b.battle, status: at(b.status, o.status), help: at(w.help, o.help), view: at(b.view, o.view) };
}

/** 점을 사각형 안으로(오른쪽·아래 변은 제외) */
export const clampPoint = (p: Point, r: Rect): Point => ({ x: Math.min(Math.max(p.x, r.left), r.right - 1), y: Math.min(Math.max(p.y, r.top), r.bottom - 1) });
