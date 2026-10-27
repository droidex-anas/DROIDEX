// The style properties a direct edit may set, the kit tokens each resolves to,
// and the raw values it accepts when the pinned kit has no matching token. The
// renderer's style preview reads the same table from
// src/features/canvas/styleProperties.ts; styleEdits.test.ts fails when they drift.

import type { ElementEdit, StyleResolution } from './protocol.js';
import { SourceElementError } from './sourceElements.js';

type StyleChange = Extract<
  ElementEdit['change'],
  { kind: 'spacing' | 'size' | 'colour' | 'typography' | 'layout' | 'opacity' }
>;

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
  | 'fraction'
  | readonly string[];

interface StyleRule {
  kind: StyleChange['kind'];
  tokens: TokenFamily;
  values: ValueForm;
}

const SPACING = { kind: 'spacing', tokens: '--ds-space-', values: 'length' } as const;
const MARGIN = { kind: 'spacing', tokens: '--ds-space-', values: 'signed-length' } as const;
const SIZE = { kind: 'size', tokens: '--ds-size-', values: 'length' } as const;
const COLOUR = { kind: 'colour', tokens: 'colour', values: 'colour' } as const;

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
  maxWidth: SIZE,
  maxHeight: SIZE,
  borderRadius: { kind: 'size', tokens: '--ds-radius-', values: 'length' },
  color: COLOUR,
  backgroundColor: COLOUR,
  borderColor: COLOUR,
  fontSize: { kind: 'typography', tokens: '--ds-text-', values: 'length' },
  fontWeight: { kind: 'typography', tokens: '--ds-weight-', values: 'weight' },
  lineHeight: { kind: 'typography', tokens: '--ds-leading-', values: 'line-height' },
  letterSpacing: { kind: 'typography', tokens: '--ds-tracking-', values: 'signed-length' },
  flexDirection: {
    kind: 'layout',
    tokens: null,
    values: ['row', 'row-reverse', 'column', 'column-reverse'],
  },
  alignItems: {
    kind: 'layout',
    tokens: null,
    values: ['flex-start', 'center', 'flex-end', 'stretch', 'baseline'],
  },
  justifyContent: {
    kind: 'layout',
    tokens: null,
    values: ['flex-start', 'center', 'flex-end', 'space-between', 'space-around', 'space-evenly'],
  },
  opacity: { kind: 'opacity', tokens: '--ds-opacity-', values: 'fraction' },
};

const LENGTH = /^(?:0|(?:\d+|\d*\.\d+)(?:px|rem|em|%))$/;
const SIGNED_LENGTH = /^-?(?:0|(?:\d+|\d*\.\d+)(?:px|rem|em|%))$/;
const UNITLESS = /^(?:\d+|\d*\.\d+)$/;
const WEIGHT = /^[1-9]00$/;
const FRACTION = /^(?:0(?:\.\d+)?|\.\d+|1(?:\.0+)?)$/;
const COLOUR_VALUE =
  /^(?:#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^()]*\)|transparent)$/i;

/**
 * The value one style edit writes. A token name must be one of the pinned kit's
 * tokens for that property; a raw value becomes the first such token, by name,
 * with the same value, and stays raw only when the kit has none.
 */
export function resolveStyleChange(
  change: StyleChange,
  tokens: Readonly<Record<string, string>>,
): StyleResolution {
  const rule = Object.hasOwn(STYLE_PROPERTIES, change.property)
    ? STYLE_PROPERTIES[change.property]
    : undefined;
  if (rule?.kind !== change.kind)
    throw new SourceElementError(
      'unsupported_edit',
      `${change.property} is not a ${change.kind} property Canvas can edit directly.`,
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
  const wanted = normalized(change.value);
  const token = Object.keys(tokens)
    .sort()
    .find((name) => inFamily(name) && normalized(tokens[name] ?? '') === wanted);
  return token ? { kind: 'token', token } : { kind: 'raw', value: change.value };
}

/** The CSS a resolution writes into the element's style. */
export function styleValue(resolution: StyleResolution): string {
  return resolution.kind === 'token' ? `var(${resolution.token})` : resolution.value;
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
    case 'fraction':
      return FRACTION.test(value);
  }
}

function normalized(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}
