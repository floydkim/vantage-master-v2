import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DAT_NUMBERS, datFileName, openVmDat } from '../../src/formats/vmFiles.ts';
import { readOriginal } from '../original.ts';

const GOLDEN: Record<number, { entries: number; bytes: number; sha256: string }> = {
  0: { entries: 75, bytes: 4454692, sha256: 'afcf558861a5a12beb87a901cf735d799d31f64ad2dfd2c444e5340ee56e4dc3' },
  1: { entries: 210, bytes: 7973568, sha256: '9e6f3342583f9ee563913619abb977e94a844a0e3026b3e24600ecfe666a33e8' },
  2: { entries: 204, bytes: 5355360, sha256: '6c8994d33caa792c3a11e72971eeb7953c59d489006a29e60441dd0dd367dad4' },
  3: { entries: 206, bytes: 5729472, sha256: '8c0d5a1dc3b1c89bc21df26e5b08b41bf926fa79d7f0b13230aa4feb341068fb' },
  4: { entries: 264, bytes: 861696, sha256: 'e5d68900cdf19ddf741456a1579a168ac9d5124a7f23e63c323ec848a2b51b04' },
  7: { entries: 426, bytes: 17589479, sha256: '9e2e078f7f3b22b99681489fe9ba93ee693daee3429fcbde3f1b7b67268b8559' },
  8: { entries: 22, bytes: 3276656, sha256: '3faf9fc845bfbfce56884285ae219a26d5ef7c8dba76f0625cdfb067169ce015' },
  9: { entries: 170, bytes: 10984661, sha256: 'a088aba0bf2848b3b077d87195680c462388cef8772474b36dc38cd76c955e77' },
  10: { entries: 276, bytes: 15031248, sha256: 'c8dc69222aa3b77c926461ea1eae1a206f50670b46b980d3475eb4e6895a1b88' },
  11: { entries: 30, bytes: 2940392, sha256: 'e0de7fe6a41dde888758f3dd0aea4567184eaf135a087a419e8e649f1fe846b2' },
  12: { entries: 85, bytes: 92800, sha256: '1ba4280f78c52240165f85d6ed001541ddefe41b4e34e6e2be0c0c53777855ee' },
  13: { entries: 154, bytes: 7057324, sha256: '053ea026219879b73bdc51762f1391eb470ca1309d3b67dba256abac5f9e54bb' },
};

describe.each(DAT_NUMBERS)('DATA%i', (n) => {
  it('모든 항목이 참조 구현과 같은 결과로 풀린다', () => {
    const dat = openVmDat(n, readOriginal(datFileName(n)));
    const hash = createHash('sha256');
    let bytes = 0;
    for (let i = 0; i < dat.entryCount; i++) {
      const data = dat.read(i);
      hash.update(data);
      bytes += data.length;
    }
    expect({ entries: dat.entryCount, bytes, sha256: hash.digest('hex') }).toEqual(GOLDEN[n]);
  });
});

it('DATA13 항목은 WAV 원본 그대로다', () => {
  const head = openVmDat(13, readOriginal('DATA13.DAT')).read(0).subarray(0, 4);
  expect(new TextDecoder('ascii').decode(head)).toBe('RIFF');
});
