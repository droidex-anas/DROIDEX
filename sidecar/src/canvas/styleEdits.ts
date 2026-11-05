// The style properties a direct edit may set, the kit tokens each resolves to,
// and the raw values it accepts when the pinned kit has no matching token. The
// renderer's style preview reads the same properties from
// src/features/canvas/styleProperties.ts; styleEdits.test.ts fails when they drift.

import type { ElementEdit } from './protocol.js';
import { SourceElementError } from './sourceElements.js';

export type StyleEdit = Extract<ElementEdit['change'], { kind: 'style' }>['styles'][number];

/** What one style edit writes: a kit token, or the raw value the kit had no token for. */
export type StyleResolution = { kind: 'token'; token: string } | { kind: 'raw'; value: string };

/**
 * Which kit tokens a property resolves to: those whose names start with a
 * prefix, those whose value is a colour, or none (keywords only).
 */
type TokenFamily = `--ds-${string}-` | 'colour' | null;
type ValueForm =
  | 'length'
  | 'signed-length'
  | 'colour'
  | 'weight'
  | 'line-height'
  | 'unitless'
  | 'fraction'
  | 'size'
  | 'max-size'
  | readonly string[];

interface StyleRule {
  tokens: TokenFamily;
  values: ValueForm;
}

const SPACING = { tokens: '--ds-space-', values: 'length' } as const;
const MARGIN = { tokens: '--ds-space-', values: 'signed-length' } as const;
const SIZE = { tokens: '--ds-size-', values: 'size' } as const;
const MAX_SIZE = { tokens: '--ds-size-', values: 'max-size' } as const;
const COLOUR = { tokens: 'colour', values: 'colour' } as const;

export const STYLE_PROPERTIES: Readonly<Record<string, StyleRule>> = {
  padding: SPACING,
  paddingTop: SPACING,
  paddingRight: SPACING,
  paddingBottom: SPACING,
  paddingLeft: SPACING,
  margin: MARGIN,
  marginTop: MARGIN,
  marginRight: MARGIN,
  marginBottom: MARGIN,
  marginLeft: MARGIN,
  gap: SPACING,
  rowGap: SPACING,
  columnGap: SPACING,
  width: SIZE,
  height: SIZE,
  minWidth: SIZE,
  minHeight: SIZE,
  maxWidth: MAX_SIZE,
  maxHeight: MAX_SIZE,
  borderRadius: { tokens: '--ds-radius-', values: 'length' },
  color: COLOUR,
  backgroundColor: COLOUR,
  borderColor: COLOUR,
  // Shadows are kit-owned surface effects, so only the kit's tokens are offered.
  boxShadow: { tokens: '--ds-shadow-', values: [] },
  fontFamily: { tokens: '--ds-font-', values: [] },
  fontSize: { tokens: '--ds-text-', values: 'length' },
  fontWeight: { tokens: '--ds-weight-', values: 'weight' },
  lineHeight: { tokens: '--ds-leading-', values: 'line-height' },
  letterSpacing: { tokens: '--ds-tracking-', values: 'signed-length' },
  flexDirection: { tokens: null, values: ['row', 'row-reverse', 'column', 'column-reverse'] },
  alignItems: { tokens: null, values: ['flex-start', 'center', 'flex-end', 'stretch', 'baseline'] },
  justifyContent: {
    tokens: null,
    values: ['flex-start', 'center', 'flex-end', 'space-between', 'space-around', 'space-evenly'],
  },
  opacity: { tokens: '--ds-opacity-', values: 'fraction' },
  display: {
    tokens: null,
    values: ['block', 'inline-block', 'inline', 'flex', 'inline-flex', 'grid', 'none'],
  },
  flexWrap: { tokens: null, values: ['nowrap', 'wrap', 'wrap-reverse'] },
  flexGrow: { tokens: null, values: 'unitless' },
  alignSelf: {
    tokens: null,
    values: ['auto', 'flex-start', 'center', 'flex-end', 'stretch', 'baseline'],
  },
  borderWidth: { tokens: null, values: 'length' },
  borderStyle: { tokens: null, values: ['solid', 'dashed', 'dotted', 'double', 'none'] },
  textAlign: { tokens: null, values: ['left', 'center', 'right', 'justify', 'start', 'end'] },
  textTransform: { tokens: null, values: ['none', 'uppercase', 'lowercase', 'capitalize'] },
  overflow: { tokens: null, values: ['visible', 'hidden', 'clip', 'scroll', 'auto'] },
};

const LENGTH = /^(?:0|(?:\d+|\d*\.\d+)(?:px|rem|em|%))$/;
const SIGNED_LENGTH = /^-?(?:0|(?:\d+|\d*\.\d+)(?:px|rem|em|%))$/;
const UNITLESS = /^(?:\d+|\d*\.\d+)$/;
const WEIGHT = /^[1-9]00$/;
const FRACTION = /^(?:0(?:\.\d+)?|\.\d+|1(?:\.0+)?)$/;
const COLOUR_VALUE =
  /^(?:#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^()]*\)|transparent)$/i;
const NUMBER_WITH_UNIT = /^(-?(?:\d+|\d*\.\d+))([a-z%]*)$/;
const LENGTH_UNITS = new Set(['px', 'rem', 'em', '%']);
// Designs render at the browser's 16px root size, which is how Tailwind's rem
// scale reads in pixels too.
const PX_PER_REM = 16;

/**
 * The value one style edit writes. A token name must be one of the pinned kit's
 * tokens for that property; a raw value becomes the first such token, by name,
 * with the same value, and stays raw only when the kit has none.
 */
export function resolveStyleChange(
  change: StyleEdit,
  tokens: Readonly<Record<string, string>>,
): StyleResolution {
  const rule = Object.hasOwn(STYLE_PROPERTIES, change.property)
    ? STYLE_PROPERTIES[change.property]
    : undefined;
  if (!rule)
    throw new SourceElementError(
      'unsupported_edit',
      `${change.property} is not a style Canvas can edit directly.`,
    );
  const inFamily = (name: string) =>
    Object.hasOwn(tokens, name) && isFamilyToken(rule, name, tokens);
  if (change.value.startsWith('--')) {
    if (!inFamily(change.value))
      throw new SourceElementError(
        'invalid_edit',
        `${change.value} is not a ${change.property} token in this design’s pinned kit.`,
      );
    return { kind: 'token', token: change.value };
  }
  if (!acceptsValue(rule.values, change.value))
    throw new SourceElementError(
      'invalid_edit',
      `${change.value} is not a ${change.property} value Canvas can write.`,
    );
  const wanted = canonicalCss(change.value);
  const token = Object.keys(tokens)
    .sort()
    .find((name) => inFamily(name) && canonicalCss(tokens[name] ?? '') === wanted);
  return token ? { kind: 'token', token } : { kind: 'raw', value: change.value };
}

/** One kit token a property's edit may name, with its value in each mode. */
export type EditToken = { name: string } & ({ value: string } | { light: string; dark: string });

/**
 * The pinned kit's tokens by the property that accepts them, for the
 * inspector's pickers; a property with none to offer is absent. Names are
 * sorted, the order a raw value's token match prefers.
 */
export function editTokens(
  light: Readonly<Record<string, string>>,
  dark: Readonly<Record<string, string>>,
): Record<string, EditToken[]> {
  const byProperty: Record<string, EditToken[]> = {};
  for (const [property, rule] of Object.entries(STYLE_PROPERTIES)) {
    if (rule.tokens === null) continue;
    const names = Object.keys(light)
      .filter((name) => isFamilyToken(rule, name, light))
      .sort();
    if (names.length === 0) continue;
    byProperty[property] = names.map((name) => {
      const lightValue = light[name] ?? '';
      const darkValue = dark[name] ?? lightValue;
      return lightValue === darkValue
        ? { name, value: lightValue }
        : { name, light: lightValue, dark: darkValue };
    });
  }
  return byProperty;
}

/** The CSS a resolution writes into the element's style. */
export function styleValue(resolution: StyleResolution): string {
  return resolution.kind === 'token' ? `var(${resolution.token})` : resolution.value;
}

/**
 * A CSS value in the one spelling two equal values share: lowercase and
 * single-spaced, a number without redundant digits, a rem length in pixels,
 * and any zero length as `0`.
 */
export function canonicalCss(value: string): string {
  const text = value.trim().toLowerCase().replace(/\s+/g, ' ');
  const parts = NUMBER_WITH_UNIT.exec(text);
  if (!parts) return text;
  const [, number = '', unit = ''] = parts;
  const amount = Number(number);
  if (amount === 0 && LENGTH_UNITS.has(unit)) return '0';
  if (unit === 'rem') return `${String(amount * PX_PER_REM)}px`;
  return `${String(amount)}${unit}`;
}

function isFamilyToken(rule: StyleRule, name: string, tokens: Readonly<Record<string, string>>) {
  if (rule.tokens === null) return false;
  if (rule.tokens === 'colour') return COLOUR_VALUE.test((tokens[name] ?? '').trim());
  return name.startsWith(rule.tokens);
}

function acceptsValue(form: ValueForm, value: string): boolean {
  if (typeof form !== 'string') return form.includes(value);
  switch (form) {
    case 'length':
      return LENGTH.test(value);
    case 'signed-length':
      return SIGNED_LENGTH.test(value);
    case 'colour':
      return COLOUR_VALUE.test(value);
    case 'weight':
      return WEIGHT.test(value);
    case 'line-height':
      return UNITLESS.test(value) || LENGTH.test(value);
    case 'unitless':
      return UNITLESS.test(value);
    case 'size':
      return LENGTH.test(value) || value === 'auto' || value === 'fit-content';
    case 'max-size':
      return LENGTH.test(value) || value === 'none';
    case 'fraction':
      return FRACTION.test(value);
  }
}
