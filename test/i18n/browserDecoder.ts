import { vi } from 'vitest';

// 노드의 TextDecoder('latin1'·'ascii')는 바이트를 그대로 풀지만 브라우저(WHATWG)는 windows-1252라 0x80~0x9f가 다른 글자가 된다. 시험에서 브라우저처럼
const WIN1252 = '€\x81‚ƒ„…†‡ˆ‰Š‹Œ\x8dŽ\x8f\x90‘’“”•–—˜™š›œ\x9džŸ'; // 0x80~0x9f

export function browserLatin1(): void {
  vi.stubGlobal(
    'TextDecoder',
    class extends TextDecoder {
      override decode(input?: AllowSharedBufferSource, options?: TextDecodeOptions): string {
        const s = super.decode(input, options);
        return this.encoding === 'windows-1252' ? s.replace(/[\x80-\x9f]/g, (c) => WIN1252[c.charCodeAt(0) - 0x80]) : s;
      }
    },
  );
}
