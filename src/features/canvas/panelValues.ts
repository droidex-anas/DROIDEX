// How the element panel reads a computed value back to a designer: the kit
// token it matches, a colour as hex and opacity or none at all, a length's
// zero or keyword as a muted placeholder and its fraction rounded, a shadow by
// its layers, and a font stack by its first family.
// Computed values arrive in CSS pixels and rgb(); token values as the kit wrote
// them, in px, rem, hex or rgb().

import { parseShadow, type ShadowLayer, type ShadowLength } from './systemDocument/shadowLayers';
import type { ValueOption } from './ValuePickerField';

/** CSS's initial root font size, which a kit's rem tokens resolve against. */
const REM_PX = 16;

const KEYWORD_PLACEHOLDERS: Record<string, string> = {
  auto: 'Auto',
  none: 'None',
  normal: 'Normal',
};

/** What a length field shows at rest: its text, or a placeholder when that is empty. */
export interface LengthFace {
  text: string;
  placeholder: string;
  /** The whole name of the token whose step alone is the text. */
  token?: string;
}

/**
 * A length at rest: `space-2` or `md` when it matches one of the property's tokens,
 * as a colour reads as its token, a muted `0`, `Auto`, `None` or `Normal`
 * for zero and keywords, else the value with its fraction rounded.
 */
export function lengthFace(value: string, tokens: readonly ValueOption[] = []): LengthFace {
  const trimmed = value.trim();
  const keyword = KEYWORD_PLACEHOLDERS[trimmed.toLowerCase()];
  if (keyword) return { text: '', placeholder: keyword };
  const px = pixelsOf(trimmed);
  if (px === 0) return { text: '', placeholder: '0' };
  const token =
    px === null ? undefined : tokens.find((option) => pixelsOf(option.hint ?? '') === px);
  if (token) return tokenFace(token.label);
  return { text: roundedPixels(trimmed), placeholder: '' };
}

/**
 * A length field's token is named `<scale>-<step>` and the field already names
 * the scale, so a step that is a word reads alone (`md` for `radius-md`) and
 * fits a half-width field. A step such as `2`, `2-5` or `px` keeps its scale,
 * as alone it would read as a length.
 */
function tokenFace(name: string): LengthFace {
  const step = name.slice(name.indexOf('-') + 1);
  if (step === name || /^(?:[\d-]+|px)$/.test(step)) return { text: name, placeholder: '' };
  return { text: step, placeholder: '', token: name };
}

/**
 * A fractional pixel length to three significant figures, but never short of
 * whole pixels, so it fits a half-width field: 213.578px reads as 214px, as
 * the element's size does, while 22.5px and -0.08px keep their fractions.
 */
function roundedPixels(value: string): string {
  const match = /^(-?\d*\.\d+)px$/i.exec(value);
  if (!match) return value;
  const amount = Number(match[1]);
  const wholeDigits = Math.max(1, Math.floor(Math.log10(Math.abs(amount))) + 1);
  return `${String(Number(amount.toFixed(Math.max(0, 3 - wholeDigits))))}px`;
}

/** A length in px or rem as CSS pixels, rounded to a hundredth; null for anything else. */
function pixelsOf(value: string): number | null {
  const match = /^(-?\d*\.?\d+)(px|rem)?$/i.exec(value.trim());
  if (!match) return null;
  const [, number, unit] = match;
  const amount = Number(number);
  // A bare number is a length only when it is zero.
  if (!unit) return amount === 0 ? 0 : null;
  const px = unit.toLowerCase() === 'rem' ? amount * REM_PX : amount;
  return Math.round(px * 100) / 100;
}

/** What a colour field shows at rest. `none` is a colour that paints nothing. */
export interface ColourFace {
  text: string;
  none: boolean;
}

/** A colour at rest: its token's name, else hex with any opacity, else `None` when it paints nothing. */
export function colourFace(value: string, tokens: readonly ValueOption[] = []): ColourFace {
  const trimmed = value.trim();
  const colour = parseColour(trimmed);
  if (colour?.alpha === 0) return { text: 'None', none: true };
  const token = tokens.find((option) => sameColour(option.hint ?? '', trimmed));
  if (token) return { text: token.label, none: false };
  if (colour?.space !== 'rgb') return { text: trimmed, none: false };
  const hex = `#${colour.channels.map(channelHex).join('')}`;
  const opacity = colour.alpha < 1 ? ` ${String(Math.round(colour.alpha * 100))}%` : '';
  return { text: hex + opacity, none: false };
}

/**
 * Whether a token's value, as the kit wrote it, is the value the preview
 * computed: the same length in pixels, the same shadow, the same colour, or
 * the same text.
 */
export function sameValue(written: string, computed: string): boolean {
  const px = pixelsOf(written);
  if (px !== null) return px === pixelsOf(computed);
  const layers = parseShadow(written);
  if (layers) return sameShadow(layers, computed);
  return sameColour(written, computed);
}

const SHADOW_LENGTHS = ['x', 'y', 'blur', 'spread'] as const;

/**
 * Chromium computes a shadow's colour first and every length in px, as a kit
 * seldom writes it, and keeps the transparent ring layers Tailwind's shadow
 * classes lead with, which draw nothing.
 */
function sameShadow(written: ShadowLayer[], computed: string): boolean {
  const shown = written.filter(isDrawnLayer);
  const drawn = parseShadow(computed)?.filter(isDrawnLayer);
  if (drawn?.length !== shown.length) return false;
  return shown.every((layer, index) => {
    const other = drawn[index];
    return (
      layer.inset === other.inset &&
      sameColour(layer.color, other.color) &&
      SHADOW_LENGTHS.every((key) => {
        const px = shadowPixels(layer[key]);
        return px !== null && px === shadowPixels(other[key]);
      })
    );
  });
}

function isDrawnLayer(layer: ShadowLayer): boolean {
  return layer.alpha > 0;
}

function shadowPixels({ amount, unit }: ShadowLength): number | null {
  return pixelsOf(`${String(amount)}${unit}`);
}

function sameColour(a: string, b: string): boolean {
  const left = parseColour(a);
  const right = parseColour(b);
  if (!left || !right) return normalized(a) === normalized(b);
  return (
    left.space === right.space &&
    left.channels.every((channel, index) => Math.abs(channel - right.channels[index]) < 0.001) &&
    Math.abs(left.alpha - right.alpha) < 0.005
  );
}

/**
 * A colour the way Chromium computes it: hex, transparent, rgb(), hsl() and
 * hwb() become whole sRGB channels in `rgb`, while lab(), lch(), oklab(),
 * oklch() and color() keep their own space, with percentages and angles
 * resolved to the numbers it writes.
 */
interface Colour {
  space: string;
  channels: number[];
  alpha: number;
}

/** The forms a kit's colour token may take, as the style edits accept them; null for any other. */
function parseColour(value: string): Colour | null {
  if (value.toLowerCase() === 'transparent') return { space: 'rgb', channels: [0, 0, 0], alpha: 0 };
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(value);
  if (hex) {
    const full = hex[1].length <= 4 ? hex[1].replace(/./g, '$&$&') : hex[1];
    const [red, green, blue, alpha = 255] = pairs(full).map((pair) => parseInt(pair, 16));
    return { space: 'rgb', channels: [red, green, blue], alpha: alpha / 255 };
  }
  const call = /^([a-z]+)\(([^()]*)\)$/i.exec(value);
  if (!call) return null;
  const [main, ...slashed] = call[2].split('/');
  const parts = main.split(/[\s,]+/).filter((part) => part.length > 0);
  const name = call[1].toLowerCase();
  const space = name === 'color' ? (parts.shift() ?? '').toLowerCase() : name.replace(/a$/, '');
  // The legacy comma syntax gives the alpha as a fourth argument.
  const alphaText = slashed.at(0)?.trim() ?? parts.at(3);
  const colour = channelsIn(space, parts);
  const alpha = alphaText === undefined ? 1 : amount(alphaText, 0.01);
  if (!colour || ![...colour.channels, alpha].every(Number.isFinite)) return null;
  return { ...colour, alpha };
}

function channelsIn(space: string, parts: string[]): Omit<Colour, 'alpha'> | null {
  const [a = '', b = '', c = ''] = parts;
  const rgb = (channels: number[]) => ({ space: 'rgb', channels: channels.map(Math.round) });
  switch (space) {
    case 'rgb':
      return rgb([a, b, c].map((channel) => amount(channel, 2.55)));
    case 'hsl':
      return rgb(hslChannels(degrees(a), amount(b, 1) / 100, amount(c, 1) / 100));
    case 'hwb':
      return rgb(hwbChannels(degrees(a), amount(b, 1) / 100, amount(c, 1) / 100));
    case 'lab':
      return { space, channels: [amount(a, 1), amount(b, 1.25), amount(c, 1.25)] };
    case 'lch':
      return { space, channels: [amount(a, 1), amount(b, 1.5), degrees(c)] };
    case 'oklab':
      return { space, channels: [amount(a, 0.01), amount(b, 0.004), amount(c, 0.004)] };
    case 'oklch':
      return { space, channels: [amount(a, 0.01), amount(b, 0.004), degrees(c)] };
    default:
      // color()'s predefined spaces, such as srgb and display-p3.
      return parts.length === 3
        ? { space, channels: [a, b, c].map((channel) => amount(channel, 0.01)) }
        : null;
  }
}

/** A channel's number, with a percentage scaled to the number it stands for and `none` as zero. */
function amount(text: string, percentScale: number): number {
  if (text.toLowerCase() === 'none') return 0;
  return text.endsWith('%') ? Number(text.slice(0, -1)) * percentScale : Number(text);
}

const DEGREES_PER: Record<string, number> = { deg: 1, grad: 0.9, rad: 180 / Math.PI, turn: 360 };

function degrees(text: string): number {
  const unit = /(deg|grad|rad|turn)$/i.exec(text)?.[1];
  if (unit === undefined) return amount(text, 1);
  return Number(text.slice(0, -unit.length)) * DEGREES_PER[unit.toLowerCase()];
}

/** CSS Color 4's hsl() to sRGB, as channels from 0 to 255. */
function hslChannels(hue: number, saturation: number, lightness: number): number[] {
  const turned = ((hue % 360) + 360) % 360;
  const chroma = saturation * Math.min(lightness, 1 - lightness);
  return [0, 8, 4].map((offset) => {
    const k = (offset + turned / 30) % 12;
    return 255 * (lightness - chroma * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
  });
}

/** CSS Color 4's hwb() to sRGB: the pure hue, washed with white and black. */
function hwbChannels(hue: number, white: number, black: number): number[] {
  if (white + black >= 1) return [0, 0, 0].map(() => (255 * white) / (white + black));
  return hslChannels(hue, 1, 0.5).map((channel) => channel * (1 - white - black) + 255 * white);
}

function pairs(digits: string): string[] {
  return digits.match(/../g) ?? [];
}

function channelHex(channel: number): string {
  return Math.min(255, Math.max(0, channel)).toString(16).padStart(2, '0');
}
function normalized(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Whether two font stacks name the same families, however each is quoted and spaced. */
export function sameFontStack(a: string, b: string): boolean {
  return families(a).join(',').toLowerCase() === families(b).join(',').toLowerCase();
}

/** The family a font stack asks for first, which is what a designer calls the font. */
export function firstFamily(stack: string): string {
  return families(stack)[0] ?? '';
}

function families(stack: string): string[] {
  return stack
    .split(',')
    .map((family) => family.trim().replace(/^["']|["']$/g, ''))
    .filter((family) => family.length > 0);
}
