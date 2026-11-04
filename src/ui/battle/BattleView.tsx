import { useEffect, useRef, useState } from 'react';
import { startFreeBattle } from '../../engine/battleStart.ts';
import { startTurn } from '../../engine/turn.ts';
import { loadMap, MAP_COUNT } from '../../formats/mapData.ts';
import { readFreeModeNames, readMasterTable } from '../../formats/masterTable.ts';
import '../assetViewer/assetViewer.css';
import { engineData } from './data.ts';
import { SKY_START } from './field.ts';
import { loadOriginal } from './original.ts';
import { FIELD_H, FIELD_W } from './raster.ts';
import { battleColors, drawBattle, loadBattleArt, toRgba } from './screen.ts';

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** #battle: 맵을 골라 새 전투(마스터 0·1, 레벨 24)의 첫 차례 화면을 원작 크기로 본다 */
export function BattleView() {
  const [mapIndex, setMapIndex] = useState(3);
  const [error, setError] = useState<string | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let alive = true;
    setError(null);
    (async () => {
      const { exe, read } = await loadOriginal();
      const map = loadMap(exe, read, mapIndex);
      const data = engineData(exe, read, map);
      const turn = startTurn(data, startFreeBattle({ masters: readMasterTable(exe), oa: data.oa, names: readFreeModeNames(exe) }, map));
      const art = loadBattleArt(exe, read, map);
      const image = toRgba(drawBattle(art, turn.state, { water: 0, sky: SKY_START }), battleColors(art, turn.state));
      if (alive) canvas.current?.getContext('2d')?.putImageData(new ImageData(image, FIELD_W, FIELD_H), 0, 0);
    })().catch((e: unknown) => alive && setError(messageOf(e)));
    return () => {
      alive = false;
    };
  }, [mapIndex]);

  return (
    <div className="asset-viewer">
      <aside>
        <label>
          맵{' '}
          <select value={mapIndex} onChange={(e) => setMapIndex(Number(e.target.value))}>
            {Array.from({ length: MAP_COUNT }, (_, i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))}
          </select>
        </label>
        {error && <p role="alert">{error}</p>}
      </aside>
      <canvas ref={canvas} width={FIELD_W} height={FIELD_H} />
    </div>
  );
}
