import { isDarkCanvas, mixHex } from '../../lib/themeTokens';
import type { ArtPreset } from './newChatLook';

// Ordered-dither artwork for the new-chat home. Each preset is a
// brightness field over a coarse cell grid; the field is quantized into a
// six-tone palette of one hue through an 8x8 Bayer matrix, which gives the
// halftone texture. Pure and DOM-free: the caller rasterizes any mark or image
// into a sample grid first and blits the returned pixels.

export interface ArtGrid {
  cols: number;
  rows: number;
}

// Optional per-cell inputs (0..1, row-major): a rasterized harness mark and
// its wider halo for the rotor, or image brightness for a dithered upload.
export interface ArtSamples {
  shape?: Float32Array;
  halo?: Float32Array;
}

type Rgb = [number, number, number];

const BAYER_8 = [
  0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28,
  52, 20, 62, 30, 54, 22, 3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7,
  39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21,
].map((value) => (value + 0.5) / 64);

function hash(x: number, y: number, seed: number): number {
  const h = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return h - Math.floor(h);
}

function valueNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const top = hash(ix, iy, seed) * (1 - sx) + hash(ix + 1, iy, seed) * sx;
  const bottom = hash(ix, iy + 1, seed) * (1 - sx) + hash(ix + 1, iy + 1, seed) * sx;
  return top * (1 - sy) + bottom * sy;
}

function fbm(x: number, y: number, seed: number): number {
  let sum = 0;
  let amplitude = 0.5;
  let frequency = 1;
  for (let octave = 0; octave < 4; octave++) {
    sum += amplitude * valueNoise(x * frequency, y * frequency, seed + octave * 17);
    amplitude *= 0.5;
    frequency *= 2;
  }
  return sum / 0.9375;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// 1 at the center of a light, fading to 0 at `radius` (in screen-height units).
function falloff(distance: number, radius: number, power = 1.6): number {
  return distance >= radius ? 0 : Math.pow(1 - distance / radius, power);
}

// Keeps the middle of the screen, where the greeting and composer sit, quiet.
function calm(u: number, v: number, aspect: number, floor: number): number {
  const distance = Math.hypot((u - 0.5) * aspect * 0.62, v - 0.48);
  return floor + (1 - floor) * smoothstep(0.1, 0.52, distance);
}

function glow(u: number, v: number, aspect: number): number {
  const warpX = (fbm(u * 2.6, v * 2.6, 3) - 0.5) * 0.32;
  const warpY = (fbm(u * 2.6 + 5.2, v * 2.6 + 1.3, 7) - 0.5) * 0.32;
  const billow = 0.55 + 0.9 * fbm(u * 4.2 + warpX, v * 4.2 + warpY, 11);
  const corner = falloff(Math.hypot((u + warpX - 1.04) * aspect, v + warpY - 1.08), 1.45, 1.35);
  const opposite = falloff(Math.hypot((u - warpX + 0.04) * aspect, v - warpY + 0.06), 0.7, 1.8);
  return (corner * 1.12 + opposite * 0.5) * billow;
}

function rotor(index: number, u: number, v: number, aspect: number, samples: ArtSamples): number {
  const shape = samples.shape?.[index] ?? 0;
  const halo = samples.halo?.[index] ?? 0;
  const core = falloff(Math.hypot((u - 0.8) * aspect, v - 0.74), 0.75, 1.2);
  const ambient = falloff(Math.hypot(u * aspect, v), 0.7, 2.2) * 0.32;
  return shape * (0.45 + 0.6 * core) + halo * 0.38 + ambient;
}

const RIDGES = 8;
const HORIZON = 0.6;
const SUN_U = 0.6;

function ridgeline(u: number, v: number, aspect: number): number {
  const sunward = Math.exp(-Math.pow(((u - SUN_U) * aspect) / 0.55, 2));
  const sky = falloff(Math.hypot((u - SUN_U) * aspect * 0.5, (v - HORIZON) * 1.7), 0.5, 1.8);
  let light = v < HORIZON + 0.02 ? sky * 0.95 : 0;
  for (let ridge = 0; ridge < RIDGES; ridge++) {
    const depth = ridge / (RIDGES - 1);
    const crest =
      HORIZON +
      0.015 +
      ridge * 0.042 -
      0.075 * fbm(u * (2.4 + ridge * 0.45) + ridge * 3.1, ridge * 1.7, 19) -
      0.018 * fbm(u * 11 + ridge, ridge * 2.3, 23);
    // A nearer ridge hides everything drawn behind it.
    if (v > crest) light = 0.03 + sky * 0.08 * (1 - depth);
    const line = Math.exp(-Math.pow((v - crest) / 0.0042, 2));
    light += line * (0.32 + 0.7 * sunward) * (1 - depth * 0.55);
  }
  return light;
}

function contour(u: number, v: number, aspect: number): number {
  const drift = fbm(u * 1.8, v * 1.8, 29);
  const phase = v * 13 + drift * 4.5 + Math.sin(u * aspect * 2.1) * 0.7;
  const band = Math.pow(0.5 + 0.5 * Math.cos(phase * Math.PI * 2), 9);
  const light = falloff(Math.hypot((u - 0.06) * aspect, v - 1.04), 1.2, 1.4);
  const counter = falloff(Math.hypot((u - 1.02) * aspect, v + 0.04), 0.55, 2);
  return band * (light + counter * 0.6) * 1.15 + light * 0.16;
}

export function artField(
  preset: ArtPreset,
  { cols, rows }: ArtGrid,
  samples: ArtSamples = {},
): Float32Array {
  const field = new Float32Array(cols * rows);
  const aspect = cols / rows;
  for (let row = 0; row < rows; row++) {
    const v = (row + 0.5) / rows;
    for (let col = 0; col < cols; col++) {
      const u = (col + 0.5) / cols;
      const index = row * cols + col;
      let light: number;
      if (preset === 'glow') light = glow(u, v, aspect);
      else if (preset === 'rotor') light = rotor(index, u, v, aspect, samples);
      else if (preset === 'ridgeline') light = ridgeline(u, v, aspect);
      else light = contour(u, v, aspect);
      field[index] = light * calm(u, v, aspect, 0.22);
    }
  }
  return field;
}

// An uploaded image redrawn as dither: bright areas glow on a dark canvas and
// ink darkens on a light one, with the middle kept calm for the greeting. When
// that would cover most of the screen (a dark photo on a light canvas), the
// tones flip so the dots trace the image's minority tone instead.
export function imageField(brightness: Float32Array, grid: ArtGrid, dark: boolean): Float32Array {
  const field = new Float32Array(brightness.length);
  let total = 0;
  for (let index = 0; index < brightness.length; index++) {
    field[index] = smoothstep(0.06, 0.94, dark ? brightness[index] : 1 - brightness[index]);
    total += field[index];
  }
  const flip = total / field.length > 0.5;
  const aspect = grid.cols / grid.rows;
  for (let index = 0; index < field.length; index++) {
    const u = ((index % grid.cols) + 0.5) / grid.cols;
    const v = (Math.floor(index / grid.cols) + 0.5) / grid.rows;
    const tone = flip ? 1 - field[index] : field[index];
    // Midtones sink so a photo reads as a few lit shapes, not a full-screen wash.
    field[index] = Math.pow(tone, 1.6) * 0.85 * calm(u, v, aspect, 0.3);
  }
  return field;
}

function parseHex(hex: string): Rgb {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

// Six close tones of the hue above the canvas, so neighbouring levels differ
// by a small step and the dither reads as grain rather than plaid. Dark
// canvases climb toward a warm highlight; light canvases deepen toward ink.
export function artPalette(hue: string, canvas: string): Rgb[] {
  const tones = isDarkCanvas(canvas)
    ? [
        mixHex(hue, canvas, 0.74),
        mixHex(hue, canvas, 0.52),
        mixHex(hue, canvas, 0.28),
        hue,
        mixHex(hue, '#ffffff', 0.26),
        mixHex(hue, '#ffffff', 0.52),
      ]
    : [
        mixHex(hue, canvas, 0.84),
        mixHex(hue, canvas, 0.66),
        mixHex(hue, canvas, 0.44),
        mixHex(hue, canvas, 0.2),
        hue,
        mixHex(hue, '#000000', 0.28),
      ];
  return tones.map(parseHex);
}

// RGBA pixels, one per cell. Level 0 stays transparent so the canvas color
// behind the artwork shows through the sparse low end.
export function ditherField(
  field: Float32Array,
  grid: ArtGrid,
  palette: Rgb[],
): Uint8ClampedArray<ArrayBuffer> {
  const pixels = new Uint8ClampedArray(grid.cols * grid.rows * 4);
  const levels = palette.length;
  for (let index = 0; index < field.length; index++) {
    const col = index % grid.cols;
    const row = Math.floor(index / grid.cols);
    const scaled = Math.min(1, Math.max(0, field[index])) * levels;
    const base = Math.floor(scaled);
    const level = Math.min(
      levels,
      base + (scaled - base > BAYER_8[(row % 8) * 8 + (col % 8)] ? 1 : 0),
    );
    if (level === 0) continue;
    const [red, green, blue] = palette[level - 1];
    const offset = index * 4;
    pixels[offset] = red;
    pixels[offset + 1] = green;
    pixels[offset + 2] = blue;
    pixels[offset + 3] = 255;
  }
  return pixels;
}
