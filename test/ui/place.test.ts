import { expect, it } from 'vitest';
import { polarOffset } from '../../src/ui/battle/place.ts';

// 방향 0~5(서, 북서, 북동, 동, 남동, 남서)의 −cos, −sin / √3. 원작은 π 대신 3.14159, √3 대신 1.73205를 쓰지만 반올림 결과는 정수 그대로다
const COS = [1, 0.5, -0.5, -1, -0.5, 0.5];
const SIN = [0, 0.5, 0.5, 0, -0.5, -0.5];

it('걷기 어긋남(0x4177ee)이 방향마다 정수 픽셀이다', () => {
  for (let dir = 0; dir < 6; dir++) {
    for (const d of [-40, -32, -24, -16, -8]) expect(polarOffset(dir * 60, d), `방향 ${dir} 거리 ${d}`).toEqual([-d * COS[dir] | 0, -d * SIN[dir] | 0]);
  }
});
