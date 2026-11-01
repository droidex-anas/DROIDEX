// What a token row draws beside its value (spec §5), read from the value
// first: a colour gets its swatch, a shadow its tiles, a length a bar or, under
// a corner heading, a rounded square, and a bare number nothing. A value that
// does not say, such as a var() or calc(), takes what its section holds, or in
// a section of mixed tokens what its group's title names.

import type { TokenKind } from '../designSystemDocumentProtocol';
import { parseShadow } from './shadowLayers';

export type TokenShape = 'color' | 'shadow' | 'radius' | 'length' | 'text';

const COLOR =
  /^(?:#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark)\(.*\)|transparent)$/i;
const LENGTH = /^-?\d*\.?\d+(?:px|rem|em|%)$/;
const NUMBER = /^-?\d*\.?\d+$/;

const KIND_SHAPE: Record<TokenKind, TokenShape | null> = {
  colors: 'color',
  shadows: 'shadow',
  radius: 'radius',
  spacing: 'length',
  size: 'length',
  // Type keeps its section's specimen; its sizes are not bars.
  typography: 'text',
  motion: 'text',
  'z-index': 'text',
  tokens: null,
};

const TITLE_SHAPES: [RegExp, TokenShape][] = [
  [/\b(?:radius|radii|corners?|rounded)\b/i, 'radius'],
  [/\b(?:shadows?|elevation)\b/i, 'shadow'],
  [/\b(?:colou?rs?|palette)\b/i, 'color'],
  [/\b(?:type|typography|fonts?|text|leading|tracking|motion|z-index|layers?)\b/i, 'text'],
  [/\b(?:spacing|space|gaps?|sizes?|widths?|heights?)\b/i, 'length'],
];

export function tokenShape(value: string, kind: TokenKind, groupTitle: string): TokenShape {
  const text = value.trim();
  if (COLOR.test(text)) return 'color';
  if (parseShadow(text)) return 'shadow';
  if (NUMBER.test(text)) return 'text';
  const named =
    KIND_SHAPE[kind] ?? TITLE_SHAPES.find(([title]) => title.test(groupTitle))?.[1] ?? 'text';
  if (LENGTH.test(text)) return named === 'radius' || named === 'text' ? named : 'length';
  return named;
}

/** Whether a row of this shape draws a specimen beside its value; a colour's swatch and a shadow's tiles sit in the value. */
export function drawsSpecimen(shape: TokenShape): shape is 'radius' | 'length' {
  return shape === 'radius' || shape === 'length';
}
