import type { ProviderKind } from '../../types/bridge';
import { AGENTS } from './agents';
import { FADE_WIDTH, type Figure } from './stage';

const CELL = 8;
const DOT = 6;
const LEVELS = 24;
// The resting brightness of the dot field, and how much a lit shape raises
// the dots around it.
const FIELD = 0.035;
const GLOW = 0.18;
// The brightness of the unlit part of a partly filled shape.
const GHOST = 0.2;
const FADE_CELLS = FADE_WIDTH / CELL;
const SPOT_RADIUS = 120;
const TEXT_TONE = 0;
const BRAND_TONE = 1;
// Text-coloured marks sit a step quieter than coloured ones, so the brand
// orange stays the loudest thing on the stage.
const TEXT_GAIN = 0.62;
const MARK_GAIN = 0.95;

type ViewBox = [number, number, number, number];

interface Mark {
  box: ViewBox;
  paths: string[];
  tone: number;
}

interface Target {
  value: Float32Array;
  tone: Uint8Array;
  shimmer: Uint8Array;
}

export interface StageEngine {
  /** Moves the stage to these figures; a scene it already shows is a no-op. */
  show: (figures: readonly Figure[]) => void;
  point: (x: number, y: number) => void;
  leave: () => void;
  stop: () => void;
}

function hash(n: number): number {
  let h = Math.imul(n ^ 0x27d4eb2d, 0x165667b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

function ease(k: number): number {
  return 1 - (1 - k) * (1 - k) * (1 - k);
}

function gainOf(tone: number): number {
  if (tone === TEXT_TONE) return TEXT_GAIN;
  return tone === BRAND_TONE ? 1 : MARK_GAIN;
}

function parseViewBox(value: string | null | undefined): ViewBox | null {
  const parts = (value ?? '').split(/[\s,]+/).map(Number);
  if (parts.length !== 4 || parts.some(Number.isNaN)) return null;
  const [x = 0, y = 0, width = 0, height = 0] = parts;
  return [x, y, width, height];
}

function cssColor(host: HTMLElement, token: string): string {
  host.style.color = `var(${token})`;
  return getComputedStyle(host).color;
}

// Reads each agent's mark from the ModelIcon rendered in `host`, so the stage
// draws the same marks the app shows. A mark painted in its own colour keeps
// that colour as a tone of its own; the rest follow the text colour.
function readMarks(host: HTMLElement): { marks: Map<ProviderKind, Mark>; markColors: string[] } {
  const marks = new Map<ProviderKind, Mark>();
  const markColors: string[] = [];
  for (const agent of AGENTS) {
    const svg = host.querySelector(`[data-agent="${agent}"] svg`);
    const box = parseViewBox(svg?.getAttribute('viewBox'));
    if (!svg || !box) continue;
    const paths = [...svg.querySelectorAll('path')];
    const fill = paths[0]?.getAttribute('fill');
    let tone = TEXT_TONE;
    if (fill && fill !== 'currentColor' && fill !== 'none') {
      markColors.push(fill);
      tone = BRAND_TONE + markColors.length;
    }
    const outlines = paths.map((path) => path.getAttribute('d') ?? '').filter(Boolean);
    marks.set(agent, { box, paths: outlines, tone });
  }
  return { marks, markColors };
}

// The X of the DROIDEX app icon: both diagonals of a 5 × 5 grid.
function pixelX(cells: number): Float32Array {
  const out = new Float32Array(cells * cells);
  for (let row = 0; row < cells; row++) {
    for (let col = 0; col < cells; col++) {
      const x = Math.floor((col * 5) / cells);
      const y = Math.floor((row * 5) / cells);
      out[row * cells + col] = x === y || x === 4 - y ? 1 : 0;
    }
  }
  return out;
}

// How much of each cell the mark covers, from a 3× supersampled drawing of its paths.
function rasterize(mark: Mark, cells: number): Float32Array {
  const ss = 3;
  const size = cells * ss;
  const out = new Float32Array(cells * cells);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return out;
  const [minX, minY, width, height] = mark.box;
  const scale = (size * 0.94) / Math.max(width, height);
  ctx.translate((size - width * scale) / 2, (size - height * scale) / 2);
  ctx.scale(scale, scale);
  ctx.translate(-minX, -minY);
  for (const d of mark.paths) ctx.fill(new Path2D(d));
  const alpha = ctx.getImageData(0, 0, size, size).data;
  for (let row = 0; row < cells; row++) {
    for (let col = 0; col < cells; col++) {
      let sum = 0;
      for (let y = 0; y < ss; y++) {
        for (let x = 0; x < ss; x++) sum += alpha[((row * ss + y) * size + col * ss + x) * 4 + 3];
      }
      out[row * cells + col] = sum / (255 * ss * ss);
    }
  }
  return out;
}

function blur(source: Float32Array, cols: number, rows: number, radius: number): Float32Array {
  const pass = (input: Float32Array, dx: number, dy: number) => {
    const out = new Float32Array(input.length);
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        let sum = 0;
        for (let k = -radius; k <= radius; k++) {
          const c = col + k * dx;
          const r = row + k * dy;
          if (c >= 0 && c < cols && r >= 0 && r < rows) sum += input[r * cols + c];
        }
        out[row * cols + col] = sum / (radius * 2 + 1);
      }
    }
    return out;
  };
  return pass(pass(source, 1, 0), 0, 1);
}

/**
 * Draws figures as a field of dots on `canvas`, easing between scenes and
 * animating only while something moves. `host` holds the rendered marks.
 */
export function createStageEngine(
  canvas: HTMLCanvasElement,
  host: HTMLElement,
  width: number,
  height: number,
): StageEngine {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const cols = Math.ceil(width / CELL);
  const rows = Math.ceil(height / CELL);
  const n = cols * rows;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const { marks, markColors } = readMarks(host);
  const shapes = new Map<string, Float32Array>();
  const cur = new Float32Array(n);
  const curTone = new Uint8Array(n);
  let from = new Float32Array(n);
  let fromTone = new Uint8Array(n);
  let target: Target = {
    value: new Float32Array(n),
    tone: new Uint8Array(n),
    shimmer: new Uint8Array(n),
  };
  // A new layout sweeps out from the setup column, so the stage answers what
  // was just done there.
  const delays = new Float32Array(n);
  const reach = Math.hypot(cols, rows / 2);
  for (let i = 0; i < n; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    delays[i] = (Math.hypot(col, row - rows / 2) / reach) * 560 + hash(i + 31) * 180;
  }
  let colors: string[] = [];
  let scene = '';
  let layout = '';
  let wave = false;
  let shimmering = false;
  let start = 0;
  let frame = 0;
  let spot = 0;
  const pointer = { x: 0, y: 0, inside: false };

  function toneOf(shape: Figure['shape']): number {
    if (shape === 'x') return BRAND_TONE;
    return marks.get(shape)?.tone ?? TEXT_TONE;
  }

  function cover(shape: Figure['shape'], cells: number): Float32Array {
    const key = `${shape}:${String(cells)}`;
    const cached = shapes.get(key);
    if (cached) return cached;
    let out: Float32Array;
    if (shape === 'x') {
      out = pixelX(cells);
    } else {
      const mark = marks.get(shape);
      if (!mark) return new Float32Array(cells * cells);
      out = rasterize(mark, cells);
    }
    shapes.set(key, out);
    return out;
  }

  function build(figures: readonly Figure[]): Target {
    const value = new Float32Array(n);
    const tone = new Uint8Array(n);
    const shimmer = new Uint8Array(n);
    const lit = new Float32Array(n);
    for (const figure of figures) {
      const cells = Math.round(figure.size / CELL);
      const coverage = cover(figure.shape, cells);
      const left = Math.round(figure.x / CELL);
      const top = Math.round(figure.y / CELL);
      const figureTone = toneOf(figure.shape);
      for (let j = 0; j < cells; j++) {
        const row = top + j;
        if (row < 0 || row >= rows) continue;
        const lifted = 1 - (j + 0.5) / cells <= figure.fill;
        const strength = lifted ? figure.strength * gainOf(figureTone) : GHOST;
        const cellTone = lifted ? figureTone : TEXT_TONE;
        for (let i = 0; i < cells; i++) {
          const col = left + i;
          if (col < 0 || col >= cols) continue;
          const c = coverage[j * cells + i];
          if (c < 0.04) continue;
          const index = row * cols + col;
          const v = c * strength * (0.72 + 0.28 * hash(index));
          if (v > value[index]) {
            value[index] = v;
            tone[index] = cellTone;
            shimmer[index] = figure.shimmer ? 1 : 0;
          }
          lit[index] = Math.max(lit[index], c * strength);
        }
      }
    }
    const halo = blur(lit, cols, rows, 5);
    for (let index = 0; index < n; index++) {
      const fade = Math.min(1, (index % cols) / FADE_CELLS);
      const base = fade * (FIELD + GLOW * halo[index]) * (0.6 + 0.4 * hash(index + 7919));
      if (base > value[index]) {
        value[index] = base;
        tone[index] = TEXT_TONE;
        shimmer[index] = 0;
      }
    }
    return { value, tone, shimmer };
  }

  function step(now: number): boolean {
    const t = now - start;
    const duration = wave ? 440 : 280;
    let moving = false;
    for (let i = 0; i < n; i++) {
      const to = target.value[i];
      const toTone = target.tone[i];
      if (reduced) {
        cur[i] = to;
        curTone[i] = toTone;
        continue;
      }
      const k = Math.min(1, Math.max(0, (t - (wave ? delays[i] : 0)) / duration));
      if (k < 1) moving = true;
      if (fromTone[i] !== toTone) {
        // A dot that changes colour fades out, then comes back in its new colour.
        if (k < 0.5) {
          cur[i] = from[i] * (1 - ease(k * 2));
          curTone[i] = fromTone[i];
        } else {
          cur[i] = to * ease((k - 0.5) * 2);
          curTone[i] = toTone;
        }
      } else {
        cur[i] = from[i] + (to - from[i]) * ease(k);
        curTone[i] = toTone;
      }
    }
    return moving;
  }

  function draw(now: number) {
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    // One path per colour and brightness level keeps a frame to a few fills.
    const buckets = new Array<Path2D | undefined>(colors.length * LEVELS);
    const phase = ((now % 1800) / 1800) * (cols + rows + 24) - 12;
    const inset = (CELL - DOT) / 2;
    for (let i = 0; i < n; i++) {
      let v = cur[i];
      const col = i % cols;
      const row = Math.floor(i / cols);
      if (shimmering && target.shimmer[i]) {
        const band = Math.abs(col + row - phase);
        if (band < 10) v *= 1 + 1.3 * (1 - band / 10);
      }
      if (spot > 0.01) {
        const dx = col * CELL + CELL / 2 - pointer.x;
        const dy = row * CELL + CELL / 2 - pointer.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < SPOT_RADIUS * SPOT_RADIUS) {
          const falloff = 1 - Math.sqrt(d2) / SPOT_RADIUS;
          v += spot * 0.3 * falloff * falloff;
        }
      }
      const level = Math.round(Math.min(1, v) * (LEVELS - 1));
      if (level <= 0) continue;
      const bucket = curTone[i] * LEVELS + level;
      let path = buckets[bucket];
      if (!path) {
        path = new Path2D();
        buckets[bucket] = path;
      }
      path.rect(col * CELL + inset, row * CELL + inset, DOT, DOT);
    }
    buckets.forEach((path, bucket) => {
      if (!path) return;
      ctx.globalAlpha = (bucket % LEVELS) / (LEVELS - 1);
      ctx.fillStyle = colors[Math.floor(bucket / LEVELS)] ?? '';
      ctx.fill(path);
    });
    ctx.globalAlpha = 1;
  }

  function tick(now: number) {
    frame = 0;
    const moving = step(now);
    const spotTarget = pointer.inside && !reduced ? 1 : 0;
    spot += (spotTarget - spot) * 0.18;
    if (Math.abs(spotTarget - spot) < 0.01) spot = spotTarget;
    draw(now);
    if (moving || shimmering || spot !== spotTarget) kick();
  }

  function kick() {
    if (frame === 0) frame = requestAnimationFrame(tick);
  }

  return {
    show(figures) {
      // Colours are read on every show, so a theme switch repaints the stage.
      const nextColors = [
        cssColor(host, '--text'),
        cssColor(host, '--brand-orange'),
        ...markColors,
      ];
      const recolored = nextColors.some((color, index) => color !== colors[index]);
      colors = nextColors;
      const nextScene = JSON.stringify(figures);
      if (nextScene === scene) {
        if (recolored) kick();
        return;
      }
      scene = nextScene;
      const nextLayout = JSON.stringify(
        figures.map(({ shape, x, y, size }) => [shape, x, y, size]),
      );
      wave = nextLayout !== layout;
      layout = nextLayout;
      from = cur.slice();
      fromTone = curTone.slice();
      target = build(figures);
      shimmering = !reduced && figures.some((figure) => figure.shimmer);
      start = performance.now();
      kick();
    },
    point(x, y) {
      pointer.x = x;
      pointer.y = y;
      pointer.inside = true;
      kick();
    },
    leave() {
      pointer.inside = false;
      kick();
    },
    stop() {
      cancelAnimationFrame(frame);
      frame = 0;
    },
  };
}
