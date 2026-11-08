import { expect, it } from 'vitest';
import type { Source } from '../../src/i18n/sources.ts';
import { isAnswer, mergeAnswer, type ReviewItem } from '../../src/ui/review/answers.ts';
import { checkText, context, filterItems, placeLabel, statusOf } from '../../src/ui/review/review.ts';

const item = (where: string, extra: Partial<ReviewItem> = {}): ReviewItem => ({ where, key: `k-${where}`, reason: '이유', candidates: [], ...extra });

it('mergeAnswer는 다른 항목의 답을 지우지 않는다', () => {
  const a = mergeAnswer({}, 'k1', { status: 'ok', at: '1' });
  expect(mergeAnswer(a, 'k2', { status: 'proposed', proposal: '가', at: '2' })).toEqual({ k1: { status: 'ok', at: '1' }, k2: { status: 'proposed', proposal: '가', at: '2' } });
  expect(mergeAnswer(a, 'k1', { status: 'proposed', choice: 1, at: '3' })).toEqual({ k1: { status: 'proposed', choice: 1, at: '3' } });
});

it('isAnswer: 서버가 받는 답의 꼴', () => {
  expect([{ status: 'ok', at: 'x' }, { status: 'proposed', choice: 2, proposal: '가', memo: '메모', at: 'x' }].every(isAnswer)).toBe(true);
  expect([null, {}, { status: 'no', at: 'x' }, { status: 'ok' }, { status: 'ok', at: 'x', choice: '1' }, { status: 'ok', at: 'x', proposal: 3 }].some(isAnswer)).toBe(false);
});

it('statusOf: 답 없음 → 안 봄, recheck이고 답 없음 → 다시 확인, ok → 좋음, proposed → 제안함', () => {
  expect([statusOf(item('a')), statusOf(item('a', { recheck: true })), statusOf(item('a'), { status: 'ok', at: '' }), statusOf(item('a', { recheck: true }), { status: 'proposed', at: '' })]).toEqual(['안 봄', '다시 확인', '좋음', '제안함']);
});

it('checkText: CP949로 못 쓰는 글자와 칸 넘침을 알린다', () => {
  expect(checkText('ending:7:21', '좋아😀', 'x'.repeat(10)).badChars).toEqual(['😀']);
  expect(checkText('map:0:0x0', '가'.repeat(12), 'x')).toMatchObject({ bytes: 24, limit: 0x17, fits: false });
  expect(checkText('ending:7:21', '가'.repeat(31), 'x'.repeat(10))).toMatchObject({ bytes: 62, limit: 60, fits: false });
  expect(checkText('ending:7:21', '가'.repeat(31), 'x'.repeat(70))).toMatchObject({ limit: 70, fits: true });
  expect(checkText('map:0:0x78', `《가》\n${'나'.repeat(32)}\n`, '')).toMatchObject({ limit: 0x127, fits: false }); // 한 줄 64바이트 > 62
  expect(checkText('dialog:0x7d:3', '이름😀', '')).toMatchObject({ badChars: [], limit: null, fits: true }); // 리소스 글은 유니코드
});

it('filterItems: 종류·상태·찾기', () => {
  const items = [item('exe:0x1'), item('ending:1:2', { recheck: true }), item('ending:1:3')];
  const answers = { 'k-ending:1:3': { status: 'ok' as const, at: '' } };
  const text = (i: ReviewItem) => (i.where === 'ending:1:2' ? '멜레트의 말' : '');
  expect(filterItems(items, answers, { kind: 'ending' }, text).map((i) => i.where)).toEqual(['ending:1:2', 'ending:1:3']);
  expect(filterItems(items, answers, { status: '다시 확인' }, text).map((i) => i.where)).toEqual(['ending:1:2']);
  expect(filterItems(items, answers, { query: '멜레트' }, text).map((i) => i.where)).toEqual(['ending:1:2']);
  expect(filterItems(items, answers, {}, text)).toHaveLength(3);
});

it('context: 같은 편 앞뒤 3줄(자기 포함), exe는 exe끼리', () => {
  const src = (where: string): Source => ({ where, kind: where.startsWith('exe') ? 'exe' : 'ending', text: where, wide: false });
  const all = [src('exe:0x1'), src('exe:0x2'), ...Array.from({ length: 9 }, (_, i) => src(`ending:1:${i}`)), src('ending:2:0')];
  expect(context(all, 'ending:1:5').map((s) => s.where)).toEqual(['ending:1:2', 'ending:1:3', 'ending:1:4', 'ending:1:5', 'ending:1:6', 'ending:1:7', 'ending:1:8']);
  expect(context(all, 'ending:1:0', 1).map((s) => s.where)).toEqual(['ending:1:0', 'ending:1:1']);
  expect(context(all, 'exe:0x2').map((s) => s.where)).toEqual(['exe:0x1', 'exe:0x2']);
});

it('placeLabel: 목록에 보일 사람이 읽는 자리 이름', () => {
  expect(['ending:24:17', 'scene:3:0', 'map:17:0x1a0', 'map:30:0x78', 'map:2:0x0', 'mas:78:0x1c', 'dialog:0x7f:t', 'dialog:0x6f:21', 'menu:0x66:0.2', 'exe:0x45e458'].map(placeLabel)).toEqual([
    '엔딩 24 · 18줄',
    '장면 3 · 1줄',
    '맵 17 설명',
    '맵 30 시나리오 설명',
    '맵 2 이름',
    '적 마스터 78 소개',
    '대화 상자 0x7f 제목',
    '대화 상자 0x6f 글 21',
    '메뉴 0.2',
    '게임 글 0x45e458',
  ]);
});
