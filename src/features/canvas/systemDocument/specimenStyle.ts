// What the renderer draws of a kit's tokens itself (spec §5): colour swatches,
// length bars, corner squares and shadow tiles, and the checks an edited value
// passes. A value reaches CSS only when the browser accepts it for the property
// it previews and it cannot fetch anything, so a kit cannot make the app load a URL.

import type { CSSProperties } from 'react';
import type { DocumentSection, DocumentToken, TokenKind } from '../designSystemDocumentProtocol';
import type { PreviewMode } from '../PreviewModeToggle';
import { tokenShape, type TokenShape } from './tokenShape';

// The sidecar's tokenValueSchema bound.
const MAX_VALUE_LENGTH = 160;

/** The property a row of each shape paints with its token. */
const SHAPE_PROPERTY: Record<TokenShape, string | null> = {
  color: 'color',
  shadow: 'box-shadow',
  radius: 'border-radius',
  length: 'width',
  text: null,
};

// A value of each kind is one CSS accepts for at least one of these.
const ACCEPTING_PROPERTIES: Partial<Record<TokenKind, string[]>> = {
  colors: ['color'],
  spacing: ['width'],
  radius: ['border-radius'],
  shadows: ['box-shadow'],
  typography: ['font-size', 'font-family', 'font-weight', 'line-height', 'letter-spacing'],
  size: ['width', 'height', 'aspect-ratio'],
  'z-index': ['z-index'],
  motion: ['transition-duration', 'transition-timing-function'],
};

const KIND_NOUN: Record<TokenKind, string> = {
  colors: 'colour',
  typography: 'type value',
  spacing: 'length',
  radius: 'corner radius',
  shadows: 'shadow',
  size: 'size',
  'z-index': 'stacking order',
  motion: 'duration or easing',
  tokens: 'value',
};

// A backslash could spell `url(` as a CSS escape.
const FETCHING = /url\(|image(?:-set)?\(|\\/i;

export function modeValue(token: DocumentToken, mode: PreviewMode): string {
  return 'value' in token ? token.value : token[mode];
}

/** Why `value` cannot be kept for a token of `kind`, or null when it can. */
export function tokenValueProblem(kind: TokenKind, value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return 'Enter a value.';
  if (trimmed.length > MAX_VALUE_LENGTH)
    return `A value is at most ${String(MAX_VALUE_LENGTH)} characters.`;
  if (/[;{}<>]|\/\*|[\n\r\t]/.test(trimmed))
    return 'A value is one CSS value, without a semicolon, brace or comment.';
  const accepting = ACCEPTING_PROPERTIES[kind] ?? [];
  if (accepting.length > 0 && !accepting.some((property) => CSS.supports(property, trimmed)))
    return `CSS does not read this as a ${KIND_NOUN[kind]}.`;
  return null;
}

/** Whether `value` may reach CSS as `property`: the browser reads it and it fetches nothing. */
export function isPaintable(property: string, value: string): boolean {
  return !FETCHING.test(value) && CSS.supports(property, value);
}

const PAINTED_PROPERTIES = Object.values(SHAPE_PROPERTY).filter((property) => property !== null);

/**
 * What a token's value is checked against before it is published: the
 * property its row paints. A row that draws text, such as a bare 0, may still
 * be what another token refers to, so it is checked against what its kind
 * holds, or in a mixed section, what any specimen paints.
 */
function publishingProperties(shape: TokenShape, kind: TokenKind): string[] {
  const painted = SHAPE_PROPERTY[shape];
  if (painted !== null) return [painted];
  return ACCEPTING_PROPERTIES[kind] ?? PAINTED_PROPERTIES;
}

/**
 * The kit's tokens in `mode` as custom properties, set on each specimen so a
 * token that refers to another still resolves. Values a check refuses are left
 * out and their specimen stays empty.
 */
export function specimenProperties(sections: DocumentSection[], mode: PreviewMode): CSSProperties {
  const properties: Record<string, string> = {};
  for (const section of sections) {
    const { kind } = section;
    if (kind === 'notes' || kind === 'components' || kind === 'assets') continue;
    for (const item of section.items) {
      if (item.kind !== 'group') continue;
      for (const token of item.tokens) {
        const shape = tokenShape(modeValue(token, 'light'), kind, item.title);
        const value = modeValue(token, mode).trim();
        if (publishingProperties(shape, kind).some((property) => isPaintable(property, value)))
          properties[token.name] = value;
      }
    }
  }
  return properties;
}
