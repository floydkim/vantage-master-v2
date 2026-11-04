import { isDeepStrictEqual } from 'node:util';
import type { Stage } from '../../src/ui/battle/stage.ts';
import { readGolden } from '../engine/block.ts';

type Call = readonly (string | number)[];
interface SoundCase {
  readonly label: string;
  readonly kind: 'attack' | 'magic' | 'turn';
  readonly calls: readonly Call[];
}
const cases = readGolden<SoundCase>('sound');

/** 원작 효과음 호출(test/golden/sound.json)과 비교: 틱마다 Stage가 남긴 호출을 [틱, 이름, ...인자]로 모은다(설정 중은 틱 −1) */
export class SoundLog {
  private readonly got: Call[] = [];
  private ticks = 0;

  take(stage: Stage, tick: number): void {
    for (const c of stage.takeSounds()) this.got.push([tick, ...c]);
    this.ticks = tick + 1;
  }

  check(kind: SoundCase['kind'], label: string, wrong: string[]): void {
    const c = cases.find((k) => k.kind === kind && k.label === label);
    if (!c) return void wrong.push(`${label}: 효과음 픽스처 없음`);
    const want = c.calls.filter((w) => (w[0] as number) < this.ticks);
    if (!isDeepStrictEqual(this.got, want)) wrong.push(`${label}: 효과음 ${JSON.stringify(this.got)} / 원작 ${JSON.stringify(want)}`);
  }
}
