import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { expect, it } from 'vitest';
import { reviewAnswersHandler } from '../../tools/i18n/review-answers.ts';

/** 요청 하나를 보내고 상태 코드를 받는다 */
function post(file: string, body: string, contentType: string): Promise<number> {
  const req = Object.assign(Readable.from([Buffer.from(body)]), { method: 'POST', headers: { 'content-type': contentType } }) as unknown as IncomingMessage;
  return new Promise((done) => {
    const res = { statusCode: 200, setHeader() {}, end: () => done(res.statusCode) };
    reviewAnswersHandler(file)(req, res as unknown as ServerResponse);
  });
}

it('검수 답 서버: JSON 요청은 항목 하나씩 합쳐 저장한다', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'review-')), 'answers.json');
  expect(await post(file, JSON.stringify({ key: 'k1', answer: { status: 'ok', at: '1' } }), 'application/json')).toBe(200);
  expect(await post(file, JSON.stringify({ key: 'k2', answer: { status: 'proposed', proposal: '가', at: '2' } }), 'application/json')).toBe(200);
  expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ k1: { status: 'ok', at: '1' }, k2: { status: 'proposed', proposal: '가', at: '2' } });
  expect(await post(file, '{"key":"k3"}', 'application/json')).toBe(400);
});

it('검수 답 서버: JSON이 아닌 요청(다른 사이트의 폼 POST 등)은 받지 않는다', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'review-')), 'answers.json');
  expect(await post(file, JSON.stringify({ key: 'k1', answer: { status: 'proposed', proposal: '악성', at: '1' } }), 'text/plain')).toBe(400);
  expect(existsSync(file)).toBe(false);
});
