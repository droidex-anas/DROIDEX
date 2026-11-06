// How the element panel reads a computed value back to a designer: the kit
// token it matches, a colour as hex and opacity or none at all, a length's
// zero or keyword as a muted placeholder and its fraction rounded, and a font
// stack by its first family.
// Computed values arrive in CSS pixels and rgb(); token values as the kit wrote
// them, in px, rem, hex or rgb().

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
}

/**
 * A length at rest: `space-2` when it matches one of the property's tokens,
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
  if (token) return { text: token.label, placeholder: '' };
  return { text: roundedPixels(trimmed), placeholder: '' };
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
  if (trimmed.toLowerCase() === 'transparent' || colour?.alpha === 0)
    return { text: 'None', none: true };
  const token = tokens.find((option) => sameColour(option.hint ?? '', trimmed));
  if (token) return { text: token.label, none: false };
  if (!colour) return { text: trimmed, none: false };
  const hex = `#${[colour.red, colour.green, colour.blue].map(channelHex).join('')}`;
  const opacity = colour.alpha < 1 ? ` ${String(Math.round(colour.alpha * 100))}%` : '';
  return { text: hex + opacity, none: false };
}

function sameColour(a: string, b: string): boolean {
  const left = parseColour(a);
  const right = parseColour(b);
  if (!left || !right) return normalized(a) === normalized(b);
  return (
    left.red === right.red &&
    left.green === right.green &&
    left.blue === right.blue &&
    Math.abs(left.alpha - right.alpha) < 0.005
  );
}

interface Rgba {
  red: number;
  green: number;
  blue: number;
  alpha: number;
}

/** Hex and rgb() in either syntax, the forms a kit writes and Chromium computes; null for any other. */
function parseColour(value: string): Rgba | null {
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(value);
  if (hex) {
    const full = hex[1].length <= 4 ? hex[1].replace(/./g, '$&$&') : hex[1];
    const [red, green, blue, alpha = 'ff'] = pairs(full);
    return {
      red: parseInt(red, 16),
      green: parseInt(green, 16),
      blue: parseInt(blue, 16),
      alpha: parseInt(alpha, 16) / 255,
    };
  }
  const rgb =
    /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)$/i.exec(value);
  if (!rgb) return null;
  const [, red, green, blue, alpha, percent] = rgb;
  return {
    red: Math.round(Number(red)),
    green: Math.round(Number(green)),
    blue: Math.round(Number(blue)),
    alpha: alpha ? Number(alpha) / (percent ? 100 : 1) : 1,
  };
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
