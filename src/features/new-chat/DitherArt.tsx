import { useEffect, useRef, useState } from 'react';
import { MARK_PATHS } from '../../components/ModelIcon';
import { useStoreSelector } from '../../hooks/useStore';
import { HARNESS_ART_COLORS, isDarkCanvas } from '../../lib/themeTokens';
import type { ProviderKind } from '../../types/bridge';
import { PROVIDER_MARKS } from '../providers/providerIdentity';
import {
  artField,
  artPalette,
  ditherField,
  imageField,
  type ArtGrid,
  type ArtSamples,
} from './halftone';
import type { ArtPreset } from './newChatLook';

export type DitherSource = { kind: 'preset'; preset: ArtPreset } | { kind: 'image'; url: string };

function scratchContext(grid: ArtGrid): CanvasRenderingContext2D {
  const canvas = document.createElement('canvas');
  canvas.width = grid.cols;
  canvas.height = grid.rows;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas 2D context is unavailable');
  return context;
}

function alphaChannel(context: CanvasRenderingContext2D, grid: ArtGrid): Float32Array {
  const { data } = context.getImageData(0, 0, grid.cols, grid.rows);
  const alpha = new Float32Array(grid.cols * grid.rows);
  for (let index = 0; index < alpha.length; index++) alpha[index] = data[index * 4 + 3] / 255;
  return alpha;
}

// The harness mark, oversized and tilted into the lower right, blurred a
// little for the body and a lot for the halo around it.
function rasterizeMark(provider: ProviderKind, grid: ArtGrid): ArtSamples {
  const mark = MARK_PATHS[PROVIDER_MARKS[provider]];
  const path = new Path2D(mark.d);
  const draw = (blurCells: number) => {
    const context = scratchContext(grid);
    const scale = (grid.rows * 1.1) / Math.max(mark.width, mark.height);
    context.filter = `blur(${String(blurCells)}px)`;
    context.translate(grid.cols * 0.8, grid.rows * 0.74);
    context.rotate(-0.22);
    context.scale(scale, scale);
    context.translate(-mark.width / 2, -mark.height / 2);
    context.fill(path);
    return alphaChannel(context, grid);
  };
  return { shape: draw(grid.rows * 0.004), halo: draw(grid.rows * 0.05) };
}

async function imageBrightness(url: string, grid: ArtGrid): Promise<Float32Array> {
  const image = new Image();
  image.src = url;
  await image.decode();
  const context = scratchContext(grid);
  const cover = Math.max(grid.cols / image.naturalWidth, grid.rows / image.naturalHeight);
  const width = image.naturalWidth * cover;
  const height = image.naturalHeight * cover;
  context.drawImage(image, (grid.cols - width) / 2, (grid.rows - height) / 2, width, height);
  const { data } = context.getImageData(0, 0, grid.cols, grid.rows);
  const brightness = new Float32Array(grid.cols * grid.rows);
  for (let index = 0; index < brightness.length; index++) {
    const offset = index * 4;
    brightness[index] =
      (0.2126 * data[offset] + 0.7152 * data[offset + 1] + 0.0722 * data[offset + 2]) / 255;
  }
  return brightness;
}

async function renderPixels(
  source: DitherSource,
  provider: ProviderKind,
  canvasColor: string,
  grid: ArtGrid,
): Promise<Uint8ClampedArray<ArrayBuffer>> {
  const palette = artPalette(HARNESS_ART_COLORS[provider], canvasColor);
  if (source.kind === 'image') {
    const brightness = await imageBrightness(source.url, grid);
    return ditherField(imageField(brightness, grid, isDarkCanvas(canvasColor)), grid, palette);
  }
  const samples = source.preset === 'rotor' ? rasterizeMark(provider, grid) : {};
  return ditherField(artField(source.preset, grid, samples), grid, palette);
}

// Fills its positioned parent with dithered artwork. The canvas holds one
// pixel per cell and is scaled up without smoothing; a CSS mask cuts each cell
// down to a square dot, so a full-window render stays a few hundred thousand
// cells instead of millions of device pixels.
export function DitherArt({
  source,
  provider,
  cellPx,
  gapPx = 0,
}: {
  source: DitherSource;
  provider: ProviderKind;
  cellPx: number;
  gapPx?: number;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [grid, setGrid] = useState<ArtGrid | null>(null);
  const canvasColor = useStoreSelector((state) => state.theme.bg);
  const sourceKey = source.kind === 'image' ? source.url : source.preset;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const measure = () => {
      const cols = Math.ceil(host.clientWidth / cellPx);
      const rows = Math.ceil(host.clientHeight / cellPx);
      if (cols === 0 || rows === 0) return;
      setGrid((previous) =>
        previous?.cols === cols && previous.rows === rows ? previous : { cols, rows },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => {
      observer.disconnect();
    };
  }, [cellPx]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !grid) return;
    let cancelled = false;
    void renderPixels(source, provider, canvasColor, grid)
      .then((pixels) => {
        if (cancelled) return;
        canvas.width = grid.cols;
        canvas.height = grid.rows;
        canvas.getContext('2d')?.putImageData(new ImageData(pixels, grid.cols, grid.rows), 0, 0);
      })
      .catch(() => {
        // An upload that no longer decodes just leaves the plain canvas.
        if (!cancelled) canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
      });
    return () => {
      cancelled = true;
    };
    // `source` is identified by its key; the object itself is rebuilt each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKey, provider, canvasColor, grid]);

  const dot = `${String(cellPx - gapPx)}px`;
  return (
    <div ref={hostRef} className="absolute inset-0 overflow-hidden">
      <canvas
        ref={canvasRef}
        className="block"
        style={{
          width: grid ? grid.cols * cellPx : '100%',
          height: grid ? grid.rows * cellPx : '100%',
          imageRendering: 'pixelated',
          ...(gapPx > 0
            ? {
                maskImage: `linear-gradient(to right, #000 ${dot}, transparent ${dot}), linear-gradient(to bottom, #000 ${dot}, transparent ${dot})`,
                maskSize: `${String(cellPx)}px ${String(cellPx)}px`,
                maskComposite: 'intersect',
              }
            : {}),
        }}
      />
    </div>
  );
}
