// What the renderer draws of a kit's tokens itself (spec §5): colour swatches,
// spacing bars, corner and shadow tiles, and the checks an edited value passes.
// A value reaches CSS only when the browser accepts it for the property it
// previews and it cannot fetch anything, so a kit cannot make the app load a URL.

import type { CSSProperties } from 'react';
import type { DocumentSection, DocumentToken, TokenKind } from '../designSystemDocumentProtocol';
import type { PreviewMode } from '../PreviewModeToggle';

// The sidecar's tokenValueSchema bound.
const MAX_VALUE_LENGTH = 160;

/** The property a specimen of each kind paints with its token. */
const SPECIMEN_PROPERTY: Partial<Record<DocumentSection['kind'], string>> = {
  colors: 'color',
  spacing: 'width',
  radius: 'border-radius',
  shadows: 'box-shadow',
};

// Kinds without a specimen still hold values CSS must accept for one of these.
const ACCEPTING_PROPERTIES: Partial<Record<TokenKind, string[]>> = {
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
  const specimen = SPECIMEN_PROPERTY[kind];
  const accepting = specimen ? [specimen] : (ACCEPTING_PROPERTIES[kind] ?? []);
  if (accepting.length > 0 && !accepting.some((property) => CSS.supports(property, trimmed)))
    return `CSS does not read this as a ${KIND_NOUN[kind]}.`;
  return null;
}

/** Whether `value` may reach CSS as `property`: the browser reads it and it fetches nothing. */
export function isPaintable(property: string, value: string): boolean {
  return !FETCHING.test(value) && CSS.supports(property, value);
}

/**
 * The kit's specimen tokens in `mode` as custom properties, set on each
 * specimen so a token that refers to another still resolves. Values a check
 * refuses are left out and their specimen stays empty.
 */
export function specimenProperties(sections: DocumentSection[], mode: PreviewMode): CSSProperties {
  const properties: Record<string, string> = {};
  for (const section of sections) {
    const property = SPECIMEN_PROPERTY[section.kind];
    if (!property) continue;
    for (const item of section.items) {
      if (item.kind !== 'group') continue;
      for (const token of item.tokens) {
        const value = modeValue(token, mode).trim();
        if (isPaintable(property, value)) properties[token.name] = value;
      }
    }
  }
  return properties;
}
