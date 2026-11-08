// 개발 서버만: 번역 검수 답(#review)의 미들웨어. GET은 답 모두, POST {key, answer}는 항목 하나를 파일에 합쳐 저장(임시 파일에 쓰고 바꿔 넣음)
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname } from 'node:path';
import { type Answers, isAnswer, mergeAnswer } from '../../src/ui/review/answers.ts';

export function reviewAnswersHandler(file: string): (req: IncomingMessage, res: ServerResponse) => void {
  const readAll = (): Answers => (existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Answers) : {});
  return (req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.method === 'GET') return void res.end(JSON.stringify(readAll()));
    if (req.method !== 'POST') return void ((res.statusCode = 405), res.end('{}'));
    // 다른 사이트의 폼 POST(text/plain 등, 브라우저가 미리 묻지 않음)로 답이 써지지 않게 JSON만 받는다
    if (!req.headers['content-type']?.startsWith('application/json')) return void ((res.statusCode = 400), res.end('{"ok":false}'));
    let body = '';
    req.on('data', (c: Buffer) => (body += c));
    req.on('end', () => {
      try {
        const { key, answer } = JSON.parse(body) as { key: unknown; answer: unknown };
        if (typeof key !== 'string' || !isAnswer(answer)) throw new Error('꼴이 다름');
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(`${file}.tmp`, `${JSON.stringify(mergeAnswer(readAll(), key, answer), null, 1)}\n`);
        renameSync(`${file}.tmp`, file);
        res.end('{"ok":true}');
      } catch {
        res.statusCode = 400;
        res.end('{"ok":false}');
      }
    });
  };
}
