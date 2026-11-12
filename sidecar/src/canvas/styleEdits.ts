// The style properties a direct edit may set, the kit tokens each resolves to,
// and the raw values it accepts when the pinned kit has no matching token. The
// renderer's style preview reads the same properties from
// src/features/canvas/styleProperties.ts; styleEdits.test.ts fails when they drift.

import type { ElementEdit } from './protocol.js';
import { SourceElementError } from './sourceElementError.js';
import { BLUR } from './tailwindStock.js';

export type StyleEdit = Extract<ElementEdit['change'], { kind: 'style' }>['styles'][number];

/**
 * What one style edit writes: a kit token, kit tokens stacked as the layers of
 * one value, or the raw value the kit had no token for.
 */
export type StyleResolution =
  | { kind: 'token'; token: string }
  | { kind: 'tokens'; tokens: readonly string[] }
  | { kind: 'raw'; value: string };

/**
 * Which kit tokens a property resolves to: those whose names start with a
 * prefix, those whose value is a colour, or none (keywords only).
 */
type TokenFamily = `--ds-${string}-` | 'colour' | null;
type ValueForm =
  | 'length'
  | 'signed-length'
  | 'colour'
  | 'paint'
  | 'weight'
  | 'line-height'
  | 'unitless'
  | 'fraction'
  | 'border-width'
  | 'size'
  | 'max-size'
  | 'blur'
  | readonly string[];

interface StyleRule {
  tokens: TokenFamily;
  values: ValueForm;
  /** Its tokens may be listed, comma-separated, to stack as the layers of one value. */
  stacks?: true;
}

const SPACING = { tokens: '--ds-space-', values: 'length' } as const;
const MARGIN = { tokens: '--ds-space-', values: 'signed-length' } as const;
const SIZE = { tokens: '--ds-size-', values: 'size' } as const;
const MIN_SIZE = { tokens: '--ds-size-', values: 'length' } as const;
const MAX_SIZE = { tokens: '--ds-size-', values: 'max-size' } as const;
const COLOUR = { tokens: 'colour', values: 'colour' } as const;
// An SVG paint also takes none, and currentcolor to follow the text colour; the
// panel sends keywords lowercased.
const PAINT = { tokens: 'colour', values: 'paint' } as const;
// A blur is the one filter function an edit writes, so the others a class adds stay.
const BLUR_FILTER = { tokens: '--ds-blur-', values: 'blur' } as const;

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
  minWidth: MIN_SIZE,
  minHeight: MIN_SIZE,
  maxWidth: MAX_SIZE,
  maxHeight: MAX_SIZE,
  borderRadius: { tokens: '--ds-radius-', values: 'length' },
  color: COLOUR,
  backgroundColor: COLOUR,
  borderColor: COLOUR,
  fill: PAINT,
  stroke: PAINT,
  strokeWidth: { tokens: '--ds-stroke-', values: 'length' },
  // Shadows are kit-owned surface effects, so only the kit's tokens are offered.
  boxShadow: { tokens: '--ds-shadow-', values: [], stacks: true },
  filter: BLUR_FILTER,
  backdropFilter: BLUR_FILTER,
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
    values: [
      'block',
      'inline-block',
      'inline',
      'flex',
      'inline-flex',
      'grid',
      'inline-grid',
      'none',
    ],
  },
  flexWrap: { tokens: null, values: ['nowrap', 'wrap', 'wrap-reverse'] },
  flexGrow: { tokens: null, values: 'unitless' },
  alignSelf: {
    tokens: null,
    values: ['auto', 'flex-start', 'center', 'flex-end', 'stretch', 'baseline'],
  },
  borderWidth: { tokens: null, values: 'border-width' },
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
// A stack's CSS stays within the length one edit value may have (schema.ts).
const MAX_STACKED_VALUE = 128;

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
  if (!rule) throw unsupportedStyle(change.property);
  const name = styleName(change.property);
  const inFamily = (name: string) =>
    Object.hasOwn(tokens, name) && isFamilyToken(rule, name, tokens);
  if (change.value.startsWith('--')) {
    const names = rule.stacks ? change.value.split(',').map((name) => name.trim()) : [change.value];
    const outside = names.find((name) => !inFamily(name));
    if (outside !== undefined)
      throw new SourceElementError(
        'invalid_edit',
        `${outside} isn’t one of this kit’s ${name} tokens. Pick one from the list, or ask the agent to change it.`,
      );
    if (names.length === 1) return { kind: 'token', token: change.value.trim() };
    const stacked = { kind: 'tokens', tokens: names } as const;
    if (styleValue(change.property, stacked).length > MAX_STACKED_VALUE)
      throw new SourceElementError(
        'invalid_edit',
        `${String(names.length)} ${name} tokens are too many to stack in one value. Stack fewer, or ask the agent to add a kit token that holds them all.`,
      );
    return stacked;
  }
  if (!acceptsValue(rule.values, change.value))
    throw new SourceElementError(
      'invalid_edit',
      `Canvas can’t set the ${name} to ${change.value}. Try another value, or ask the agent to change it.`,
    );
  const wanted = canonicalCss(change.value);
  // A blur token holds the blur's length.
  const tokenCss = (value: string) => (rule.values === 'blur' ? `blur(${value})` : value);
  const token = Object.keys(tokens)
    .sort((a, b) => NAME_ORDER.compare(a, b))
    .find((name) => inFamily(name) && canonicalCss(tokenCss(tokens[name] ?? '')) === wanted);
  return token ? { kind: 'token', token } : { kind: 'raw', value: change.value };
}

/** How the element panel names a style property, which is how a refusal names it too. */
const PANEL_NAMES: Readonly<Record<string, string>> = {
  color: 'text colour',
  backgroundColor: 'fill',
  borderRadius: 'corner radius',
  boxShadow: 'shadow',
  filter: 'layer blur',
  backdropFilter: 'background blur',
};

export function styleName(property: string): string {
  if (Object.hasOwn(PANEL_NAMES, property)) return PANEL_NAMES[property];
  return property
    .replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`)
    .replace('color', 'colour');
}

export function unsupportedStyle(property: string): SourceElementError {
  return new SourceElementError(
    'unsupported_edit',
    `Canvas can’t change the ${styleName(property)} directly. Ask the agent to change it.`,
  );
}

/** One kit token a property's edit may name, with its value in each mode. */
export type EditToken = { name: string } & ({ value: string } | { light: string; dark: string });

/**
 * The pinned kit's tokens by the property that accepts them, for the
 * inspector's pickers; a property with none to offer is absent. Each list
 * runs in scale order (see `scaleOrder`).
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
      .sort(scaleOrder(light));
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

/** The CSS a resolution sets `property` to in the element's style. */
export function styleValue(property: string, resolution: StyleResolution): string {
  if (resolution.kind === 'raw') return resolution.value;
  const tokens = resolution.kind === 'token' ? [resolution.token] : resolution.tokens;
  const css = tokens.map((token) => `var(${token})`).join(',');
  const isBlur =
    Object.hasOwn(STYLE_PROPERTIES, property) && STYLE_PROPERTIES[property].values === 'blur';
  return isBlur ? `blur(${css})` : css;
}

/**
 * A CSS value in the one spelling two equal values share: lowercase and
 * single-spaced, a number without redundant digits, a rem length in pixels,
 * and any zero length as `0`, also as a blur's length.
 */
export function canonicalCss(value: string): string {
  const text = value.trim().toLowerCase().replace(/\s+/g, ' ');
  const blur = /^blur\((.*)\)$/.exec(text);
  if (blur) {
    const [, length = ''] = blur;
    return `blur(${canonicalCss(length)})`;
  }
  const parts = NUMBER_WITH_UNIT.exec(text);
  if (!parts) return text;
  const [, number = '', unit = ''] = parts;
  const amount = Number(number);
  if (amount === 0 && LENGTH_UNITS.has(unit)) return '0';
  if (unit === 'rem') return `${String(amount * PX_PER_REM)}px`;
  return `${String(amount)}${unit}`;
}

const NAME_ORDER = new Intl.Collator('en', { numeric: true });
// Units whose numbers a scale can compare, in the order their groups list.
const SCALE_UNITS = new Map([
  ['', 0],
  ['px', 0],
  ['em', 1],
  ['%', 2],
]);
const UNSCALED = SCALE_UNITS.size;

/**
 * A scale reads smallest first: pixels and plain numbers, then em, then
 * percentages, each by its number, then the rest. A rem counts as pixels at the
 * 16px root; the kit's own html font-size is not read. Equal steps and the rest
 * go by name, its numbers read as numbers, so space-2 comes before space-10. A
 * kit's document order is no guide, as an import appends the steps it adds.
 */
function scaleOrder(values: Readonly<Record<string, string>>) {
  return (a: string, b: string): number => {
    const left = scaleStep(values[a] ?? '');
    const right = scaleStep(values[b] ?? '');
    if (left.group !== right.group) return left.group - right.group;
    if (left.amount !== right.amount) return left.amount - right.amount;
    return NAME_ORDER.compare(a, b);
  };
}

function scaleStep(value: string): { group: number; amount: number } {
  const parts = NUMBER_WITH_UNIT.exec(canonicalCss(value));
  const group = parts ? SCALE_UNITS.get(parts[2]) : undefined;
  if (!parts || group === undefined) return { group: UNSCALED, amount: 0 };
  return { group, amount: Number(parts[1]) };
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
    case 'paint':
      return COLOUR_VALUE.test(value) || value === 'none' || value === 'currentcolor';
    case 'weight':
      return WEIGHT.test(value);
    case 'line-height':
      return UNITLESS.test(value) || LENGTH.test(value);
    case 'unitless':
      return UNITLESS.test(value);
    case 'border-width':
      return LENGTH.test(value) && !value.endsWith('%');
    case 'size':
      return LENGTH.test(value) || value === 'auto' || value === 'fit-content';
    case 'max-size':
      return LENGTH.test(value) || value === 'none';
    case 'fraction':
      return FRACTION.test(value);
    case 'blur':
      return Object.values(BLUR).some((stock) => canonicalCss(stock) === canonicalCss(value));
  }
}
