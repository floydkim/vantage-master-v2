import { useEffect, useMemo, useRef, useState } from 'react';
import { OpeningMovie } from '../title/OpeningMovie.tsx';
import { indexedToRgba, type RgbaImage } from '../../formats/indexedImage.ts';
import { mojiAtlas } from '../../formats/mojiFont.ts';
import { parsePalette } from '../../formats/palette.ts';
import { extractStrings } from '../../formats/strings.ts';
import { DAT_NUMBERS, datFileName } from '../../formats/vmFiles.ts';
import { guessKind, hexDump, type AssetKind } from './helpers.ts';
import { loadDat, loadPalette, type LoadedDat } from './loadDat.ts';
import './assetViewer.css';

const FONT_PALETTE = Uint8Array.from([0, 0, 0, 255, 255, 255]);
const SCALE = 2;

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

type Selected =
  | { readonly ok: true; readonly bytes: Uint8Array; readonly name: string | null; readonly kind: AssetKind }
  | { readonly ok: false; readonly error: string };

export function AssetViewer() {
  const [datNumber, setDatNumber] = useState(0);
  const [loaded, setLoaded] = useState<LoadedDat | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [entry, setEntry] = useState(0);
  const [width, setWidth] = useState(64);
  const [layerSpec, setLayerSpec] = useState('');
  const [palette, setPalette] = useState<Uint8Array | null>(null);
  const [paletteError, setPaletteError] = useState<string | null>(null);
  const [openingRun, setOpeningRun] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoaded(null);
    setLoadError(null);
    setEntry(0);
    loadDat(datNumber).then(
      (d) => alive && setLoaded(d),
      (e: unknown) => alive && setLoadError(messageOf(e)),
    );
    return () => {
      alive = false;
    };
  }, [datNumber]);

  useEffect(() => {
    let alive = true;
    loadPalette(layerSpec).then(
      (p) => {
        if (!alive) return;
        setPalette(p);
        setPaletteError(null);
      },
      (e: unknown) => alive && setPaletteError(messageOf(e)),
    );
    return () => {
      alive = false;
    };
  }, [layerSpec]);

  const selected = useMemo((): Selected | null => {
    if (!loaded) return null;
    try {
      const bytes = loaded.dat.read(entry);
      const name = loaded.names?.[entry] ?? null;
      return { ok: true, bytes, name, kind: guessKind(name, bytes) };
    } catch (e) {
      return { ok: false, error: messageOf(e) };
    }
  }, [loaded, entry]);

  return (
    <div className="asset-viewer">
      <aside>
        <select aria-label="DAT 파일" value={datNumber} onChange={(e) => setDatNumber(Number(e.target.value))}>
          {DAT_NUMBERS.map((n) => (
            <option key={n} value={n}>
              {datFileName(n)}
            </option>
          ))}
        </select>
        {loaded && (
          <select aria-label="항목" size={30} value={entry} onChange={(e) => setEntry(Number(e.target.value))}>
            {Array.from({ length: loaded.dat.entryCount }, (_, i) => (
              <option key={i} value={i}>
                {i} {loaded.names?.[i] ?? ''}
              </option>
            ))}
          </select>
        )}
      </aside>
      <main>
        <label>
          너비{' '}
          <input
            type="number"
            min={1}
            value={width}
            onChange={(e) => setWidth(Math.max(1, Math.floor(Number(e.target.value)) || 1))}
          />
        </label>
        <label>
          팔레트{' '}
          <input value={layerSpec} placeholder="예: 0:1@10 0:2@50" onChange={(e) => setLayerSpec(e.target.value)} />
        </label>
        <button type="button" onClick={() => setOpeningRun((n) => n + 1)}>
          오프닝 재생
        </button>
        {openingRun > 0 && (
          // key가 바뀌면 처음부터 다시
          <div style={{ position: 'relative', width: 320, height: 240 }}>
            <OpeningMovie key={openingRun} at={{ x: 0, y: 0 }} onStart={() => {}} onEnd={() => {}} />
          </div>
        )}
        {loadError && <p role="alert">{loadError}</p>}
        {paletteError && <p role="alert">{paletteError}</p>}
        {selected && !selected.ok && <p role="alert">{selected.error}</p>}
        {selected && selected.ok && palette && (
          <Preview bytes={selected.bytes} name={selected.name} kind={selected.kind} width={width} palette={palette} />
        )}
      </main>
    </div>
  );
}

function Preview(props: { bytes: Uint8Array; name: string | null; kind: AssetKind; width: number; palette: Uint8Array }) {
  const { bytes, name, kind, width, palette } = props;
  return (
    <section>
      <h2>
        {name ?? '(이름 없음)'} · {kind} · {bytes.length}바이트
      </h2>
      {kind === 'image' && <ImageCanvas image={indexedToRgba(bytes, width, palette)} />}
      {kind === 'font' && <FontPreview font={bytes} />}
      {kind === 'palette' && <Swatches bytes={bytes} />}
      {kind === 'text' && (
        <ul>
          {extractStrings(bytes).map((s) => (
            <li key={s.offset}>
              <code>{s.offset.toString(16)}</code> {s.text}
            </li>
          ))}
        </ul>
      )}
      {kind === 'wav' && <WavPlayer bytes={bytes} />}
      <pre>{hexDump(bytes)}</pre>
    </section>
  );
}

function ImageCanvas({ image }: { image: RgbaImage }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || image.height === 0) return;
    canvas.width = image.width;
    canvas.height = image.height;
    canvas.getContext('2d')?.putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
  }, [image]);
  return <canvas ref={ref} style={{ width: image.width * SCALE, height: image.height * SCALE }} />;
}

function FontPreview({ font }: { font: Uint8Array }) {
  const atlas = mojiAtlas(font);
  return <ImageCanvas image={indexedToRgba(atlas.pixels, atlas.width, FONT_PALETTE)} />;
}

function Swatches({ bytes }: { bytes: Uint8Array }) {
  return (
    <ol className="swatches">
      {parsePalette(bytes).map(([r, g, b], i) => (
        <li key={i} title={`${i}: ${r}, ${g}, ${b}`} style={{ background: `rgb(${r} ${g} ${b})` }} />
      ))}
    </ol>
  );
}

function WavPlayer({ bytes }: { bytes: Uint8Array }) {
  const url = useMemo(() => URL.createObjectURL(new Blob([bytes.slice()], { type: 'audio/wav' })), [bytes]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return <audio controls src={url} />;
}
