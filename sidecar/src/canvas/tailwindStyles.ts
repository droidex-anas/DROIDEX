// The Tailwind classes a direct style edit reads and writes. Designs compile
// against stock Tailwind 3 plus the pinned kit's theme (canvasTailwindOptions),
// so a kit token is written in the arbitrary-value form kits use
// (`p-[var(--ds-space-4)]`), and a raw value as the stock class whose value
// equals it (`p-4` for 16px) or, without one or where the kit's theme gives
// that key its own value, not as a class at all. tailwindStyles.test.ts
// compiles every class this module can write with Tailwind itself.

import type { KitTheme, ThemeNamespace } from './kitTailwindTheme.js';
import { canonicalCss, type StyleResolution } from './styleEdits.js';
import {
  BLUR,
  BORDER_WIDTH,
  FONT_FAMILIES,
  FONT_SIZE_LINE_HEIGHT,
  FONT_WEIGHT,
  KEYWORD_CLASSES,
  LINE_HEIGHT,
  MAX_SIZE,
  MIN_SIZE,
  OPACITY,
  RADIUS,
  SHADOWS,
  SIZE,
  SPACING,
  TRACKING,
  type Scale,
} from './tailwindStock.js';

/** What one class sets, as far as a style edit is concerned. */
export interface ClassStyle {
  /** The CSS longhands it sets, camelCased. */
  sets: readonly string[];
  /**
   * When it applies: always, for some frames (a breakpoint or a colour mode),
   * or in some interaction state such as hover.
   */
  scope: 'always' | 'frame' | 'state';
  /** A font-size class's own line height, which it takes along when it goes. */
  lineHeight?: string;
}

interface Utility {
  prefix: string;
  /** The type an arbitrary value is marked with where Tailwind would misread it. */
  hint?: string;
  /** Stock classes by key, `''` for the bare prefix, with the value each sets. */
  scale?: Scale;
  signed?: boolean;
}

const SIDES = ['Top', 'Right', 'Bottom', 'Left'] as const;
const CORNERS = ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft'] as const;

const PADDING = SIDES.map((side) => `padding${side}`);
const MARGIN = SIDES.map((side) => `margin${side}`);
const GAP = ['rowGap', 'columnGap'];
const RADII = CORNERS.map((corner) => `border${corner}Radius`);

const LONGHANDS: Readonly<Record<string, readonly string[]>> = {
  padding: PADDING,
  margin: MARGIN,
  gap: GAP,
  borderRadius: RADII,
  borderWidth: SIDES.map((side) => `border${side}Width`),
  borderColor: SIDES.map((side) => `border${side}Color`),
};

const COLOUR_KEY =
  /^(?:inherit|current|transparent|black|white|(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|[1-9]00|950))$/;
const COLOUR_LIKE =
  /^(?:#|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(|transparent$|currentcolor$)/i;
const LENGTH_LIKE =
  /^(?:-?(?:\d+|\d*\.\d+)(?:px|rem|em|%|vw|vh|ch|ex|pt)?|(?:calc|clamp|min|max)\(.*)$/;
// Breakpoints and the colour mode decide per frame whether a class applies;
// any other variant is an interaction state the board preview is not in.
const FRAME_VARIANT = /^(?:sm|md|lg|xl|2xl|dark|(?:min|max)-.+)$/;

const UTILITIES: Readonly<Record<string, Utility>> = {
  padding: { prefix: 'p', scale: SPACING },
  paddingTop: { prefix: 'pt', scale: SPACING },
  paddingRight: { prefix: 'pr', scale: SPACING },
  paddingBottom: { prefix: 'pb', scale: SPACING },
  paddingLeft: { prefix: 'pl', scale: SPACING },
  margin: { prefix: 'm', scale: SPACING, signed: true },
  marginTop: { prefix: 'mt', scale: SPACING, signed: true },
  marginRight: { prefix: 'mr', scale: SPACING, signed: true },
  marginBottom: { prefix: 'mb', scale: SPACING, signed: true },
  marginLeft: { prefix: 'ml', scale: SPACING, signed: true },
  gap: { prefix: 'gap', scale: SPACING },
  rowGap: { prefix: 'gap-y', scale: SPACING },
  columnGap: { prefix: 'gap-x', scale: SPACING },
  width: { prefix: 'w', scale: SIZE },
  height: { prefix: 'h', scale: SIZE },
  minWidth: { prefix: 'min-w', scale: MIN_SIZE },
  minHeight: { prefix: 'min-h', scale: MIN_SIZE },
  maxWidth: { prefix: 'max-w', scale: MAX_SIZE },
  maxHeight: { prefix: 'max-h', scale: MAX_SIZE },
  borderRadius: { prefix: 'rounded', scale: RADIUS },
  color: { prefix: 'text', hint: 'color' },
  backgroundColor: { prefix: 'bg', hint: 'color' },
  borderColor: { prefix: 'border', hint: 'color' },
  boxShadow: { prefix: 'shadow', hint: 'shadow' },
  filter: { prefix: 'blur', scale: BLUR },
  backdropFilter: { prefix: 'backdrop-blur', scale: BLUR },
  fontFamily: { prefix: 'font', hint: 'family-name' },
  fontSize: { prefix: 'text', hint: 'length' },
  fontWeight: { prefix: 'font', hint: 'number', scale: FONT_WEIGHT },
  lineHeight: { prefix: 'leading', scale: LINE_HEIGHT },
  letterSpacing: { prefix: 'tracking', scale: TRACKING, signed: true },
  opacity: { prefix: 'opacity', scale: OPACITY },
  borderWidth: { prefix: 'border', hint: 'length', scale: BORDER_WIDTH },
};

/** The theme namespace each stock scale's keys come from, where a kit's theme can give one its own value. */
const SCALE_NAMESPACES = new Map<Scale, ThemeNamespace>([
  [SPACING, 'spacing'],
  [SIZE, 'spacing'],
  [MIN_SIZE, 'spacing'],
  [MAX_SIZE, 'spacing'],
  [RADIUS, 'borderRadius'],
  [FONT_WEIGHT, 'fontWeight'],
  [LINE_HEIGHT, 'lineHeight'],
  [TRACKING, 'letterSpacing'],
]);

const KEYWORD_PROPERTIES = new Map(
  Object.entries(KEYWORD_CLASSES).flatMap(([property, classes]) =>
    Object.values(classes).map((name) => [name, property] as const),
  ),
);

/** Utilities whose value says nothing about which property they set, by prefix. */
const BOX_UTILITIES: Readonly<Record<string, readonly string[]>> = {
  p: PADDING,
  px: ['paddingLeft', 'paddingRight'],
  py: ['paddingTop', 'paddingBottom'],
  ps: ['paddingLeft'],
  pe: ['paddingRight'],
  pt: ['paddingTop'],
  pr: ['paddingRight'],
  pb: ['paddingBottom'],
  pl: ['paddingLeft'],
  m: MARGIN,
  mx: ['marginLeft', 'marginRight'],
  my: ['marginTop', 'marginBottom'],
  ms: ['marginLeft'],
  me: ['marginRight'],
  mt: ['marginTop'],
  mr: ['marginRight'],
  mb: ['marginBottom'],
  ml: ['marginLeft'],
  gap: GAP,
  'gap-x': ['columnGap'],
  'gap-y': ['rowGap'],
  w: ['width'],
  h: ['height'],
  size: ['width', 'height'],
  'min-w': ['minWidth'],
  'min-h': ['minHeight'],
  'max-w': ['maxWidth'],
  'max-h': ['maxHeight'],
  leading: ['lineHeight'],
  tracking: ['letterSpacing'],
  opacity: ['opacity'],
  rounded: RADII,
  'rounded-t': ['borderTopLeftRadius', 'borderTopRightRadius'],
  'rounded-r': ['borderTopRightRadius', 'borderBottomRightRadius'],
  'rounded-b': ['borderBottomRightRadius', 'borderBottomLeftRadius'],
  'rounded-l': ['borderTopLeftRadius', 'borderBottomLeftRadius'],
  'rounded-s': ['borderTopLeftRadius', 'borderBottomLeftRadius'],
  'rounded-e': ['borderTopRightRadius', 'borderBottomRightRadius'],
  'rounded-tl': ['borderTopLeftRadius'],
  'rounded-tr': ['borderTopRightRadius'],
  'rounded-br': ['borderBottomRightRadius'],
  'rounded-bl': ['borderBottomLeftRadius'],
  'rounded-ss': ['borderTopLeftRadius'],
  'rounded-se': ['borderTopRightRadius'],
  'rounded-es': ['borderBottomLeftRadius'],
  'rounded-ee': ['borderBottomRightRadius'],
};
const SIGNED_UTILITIES = /^(?:m[xytrblse]?|tracking)$/;
/** Longest first, so `gap-x-2` is read as `gap-x` and `rounded-tl` before `rounded-t`. */
const BOX_PREFIXES = Object.keys(BOX_UTILITIES).sort((a, b) => b.length - a.length);
const BORDER_SIDES: Readonly<Record<string, readonly string[]>> = {
  '': SIDES,
  x: ['Left', 'Right'],
  y: ['Top', 'Bottom'],
  t: ['Top'],
  r: ['Right'],
  b: ['Bottom'],
  l: ['Left'],
  s: ['Left'],
  e: ['Right'],
};

/** The longhands a style property sets: its own name unless it is a shorthand. */
export function longhands(property: string): readonly string[] {
  return (Object.hasOwn(LONGHANDS, property) ? LONGHANDS[property] : undefined) ?? [property];
}

/**
 * The class that writes `resolution` to `property`, or null when no class
 * says exactly that and the value has to stay inline. `theme` is the pinned
 * kit's Tailwind theme: a stock key it names no longer sets the stock value.
 */
export function styleClass(
  property: string,
  resolution: StyleResolution,
  theme: KitTheme = {},
): string | null {
  const utility = Object.hasOwn(UTILITIES, property) ? UTILITIES[property] : undefined;
  if (resolution.kind === 'token') {
    if (!utility) return null;
    const hint = utility.hint ? `${utility.hint}:` : '';
    return `${utility.prefix}-[${hint}var(${resolution.token})]`;
  }
  const keyword = keywordClass(property, resolution.value);
  if (keyword !== undefined) return keyword;
  const scale = utility?.scale;
  if (!scale) return null;
  const namespace = SCALE_NAMESPACES.get(scale);
  const kitValues = namespace ? theme[namespace] : undefined;
  // Tailwind's bare `rounded` is the theme's DEFAULT key.
  const stockKey = (value: string) => {
    const key = scaleKey(scale, value);
    return key !== null && kitValues && Object.hasOwn(kitValues, key || 'DEFAULT') ? null : key;
  };
  const direct = stockKey(resolution.value);
  if (direct !== null) return stockClass(utility.prefix, direct);
  if (!utility.signed || !resolution.value.startsWith('-')) return null;
  const negated = stockKey(resolution.value.slice(1));
  return negated === null ? null : `-${stockClass(utility.prefix, negated)}`;
}

/**
 * A box or size utility (`p-4`, `rounded-tl`, `-mt-2`): its prefix says which
 * longhands it sets. Undefined for anything else, so the caller reads on; null
 * for a negation Tailwind has no utility for.
 */
function boxUtility(utility: string): Omit<ClassStyle, 'scope'> | null | undefined {
  const negative = utility.startsWith('-');
  const body = negative ? utility.slice(1) : utility;
  const prefix = BOX_PREFIXES.find((each) => body === each || body.startsWith(`${each}-`));
  if (prefix !== undefined && (body !== prefix || prefix.startsWith('rounded'))) {
    if (negative && !SIGNED_UTILITIES.test(prefix)) return null;
    return { sets: BOX_UTILITIES[prefix] ?? [] };
  }
  return negative ? null : undefined;
}

/**
 * A blur or backdrop blur (`blur-md`, `backdrop-blur-[var(--x)]`), which sets
 * one function of its filter; grayscale and the other functions are not read.
 */
function blurUtility(utility: string): Omit<ClassStyle, 'scope'> | null {
  const blur = /^(backdrop-)?blur(?:-(.+))?$/.exec(utility);
  if (!blur) return null;
  const [, backdrop, key = ''] = blur;
  if (!Object.hasOwn(BLUR, key) && arbitrary(key) === null) return null;
  return { sets: [backdrop ? 'backdropFilter' : 'filter'] };
}

/**
 * What one class token sets, or null for a class no style edit concerns.
 * `theme` is the pinned kit's Tailwind theme, as for styleClass.
 */
export function classStyle(token: string, theme: KitTheme = {}): ClassStyle | null {
  const variants = splitOutside(token, ':');
  const utility = (variants.pop() ?? '').replace(/^!/, '');
  const read = utilityStyle(utility, theme);
  if (!read) return null;
  let scope: ClassStyle['scope'] = 'always';
  if (variants.some((variant) => FRAME_VARIANT.test(variant))) scope = 'frame';
  else if (variants.length > 0) scope = 'state';
  return { ...read, scope };
}

function utilityStyle(utility: string, theme: KitTheme): Omit<ClassStyle, 'scope'> | null {
  const property = /^\[([a-z-]+):.+\]$/.exec(utility)?.[1];
  if (property) return { sets: longhands(camelCase(property)) };
  const keyword = KEYWORD_PROPERTIES.get(utility);
  if (keyword) return { sets: [keyword] };
  const box = boxUtility(utility);
  if (box !== undefined) return box;
  const [name = '', ...rest] = utility.split('-');
  const value = rest.join('-');
  switch (name) {
    case 'text':
      return textStyle(value, theme);
    case 'bg':
      return isColour(value) ? { sets: ['backgroundColor'] } : null;
    case 'border':
      return borderStyle(value);
    case 'shadow':
      return isShadow(value) ? { sets: ['boxShadow'] } : null;
    case 'font':
      return fontStyle(value);
    case 'grow':
      // `grow` and `grow-0` are keywords above; this reads an arbitrary one.
      return arbitrary(value) ? { sets: ['flexGrow'] } : null;
    default:
      return blurUtility(utility);
  }
}

/** A font-size modifier's line height, arbitrary or from the stock scale. */
function modifierLineHeight(modifier: string | undefined): string | undefined {
  if (modifier === undefined) return undefined;
  return arbitrary(modifier)?.body ?? LINE_HEIGHT[modifier];
}

/** A stock font size's own line height; none where the kit's theme redefines that size. */
function stockLineHeight(key: string, theme: KitTheme): string | undefined {
  if (!Object.hasOwn(FONT_SIZE_LINE_HEIGHT, key)) return undefined;
  if (theme.fontSize !== undefined && Object.hasOwn(theme.fontSize, key)) return undefined;
  return FONT_SIZE_LINE_HEIGHT[key];
}

function textStyle(value: string, theme: KitTheme): Omit<ClassStyle, 'scope'> | null {
  const [key = '', ...modifiers] = splitOutside(value, '/');
  const custom = arbitrary(key);
  const isSize =
    Object.hasOwn(FONT_SIZE_LINE_HEIGHT, key) ||
    custom?.hint === 'length' ||
    (!custom?.hint && LENGTH_LIKE.test(custom?.body ?? ''));
  if (!isSize) return isColour(value) ? { sets: ['color'] } : null;
  const lineHeight = modifierLineHeight(modifiers.at(0)) ?? stockLineHeight(key, theme);
  return lineHeight ? { sets: ['fontSize'], lineHeight } : { sets: ['fontSize'] };
}

function borderStyle(value: string): Omit<ClassStyle, 'scope'> | null {
  const side = /^([xytrblse])(?:-|$)/.exec(value)?.[1] ?? '';
  const sides = BORDER_SIDES[side] ?? SIDES;
  const rest = side === '' ? value : value.slice(side.length + 1);
  const custom = arbitrary(rest);
  const isWidth =
    Object.hasOwn(BORDER_WIDTH, rest) ||
    custom?.hint === 'length' ||
    (!custom?.hint && LENGTH_LIKE.test(custom?.body ?? ''));
  if (isWidth) return { sets: sides.map((each) => `border${each}Width`) };
  return isColour(rest) ? { sets: sides.map((each) => `border${each}Color`) } : null;
}

function fontStyle(value: string): Omit<ClassStyle, 'scope'> | null {
  if (FONT_FAMILIES.has(value)) return { sets: ['fontFamily'] };
  if (Object.hasOwn(FONT_WEIGHT, value)) return { sets: ['fontWeight'] };
  const custom = arbitrary(value);
  if (!custom) return null;
  if (custom.hint === 'family-name') return { sets: ['fontFamily'] };
  const isWeight =
    custom.hint === 'number' || (!custom.hint && /^(?:\d+|var\(.*)$/.test(custom.body));
  return { sets: [isWeight ? 'fontWeight' : 'fontFamily'] };
}

/** A colour key, or an arbitrary colour; Tailwind reads a bare `var()` as one too. */
function isColour(value: string): boolean {
  const [key = ''] = splitOutside(value, '/');
  if (COLOUR_KEY.test(key)) return true;
  const custom = arbitrary(key);
  if (!custom) return false;
  if (custom.hint) return custom.hint === 'color';
  return custom.body.startsWith('var(') || COLOUR_LIKE.test(custom.body);
}

function isShadow(value: string): boolean {
  if (SHADOWS.has(value)) return true;
  const custom = arbitrary(value);
  if (!custom) return false;
  if (custom.hint) return custom.hint === 'shadow';
  return !custom.body.startsWith('var(') && !COLOUR_LIKE.test(custom.body);
}

/** `[color:var(--x)]` as its type hint and value; null for a value that is not arbitrary. */
function arbitrary(value: string): { hint: string | null; body: string } | null {
  if (!value.startsWith('[') || !value.endsWith(']')) return null;
  const inner = value.slice(1, -1).replace(/_/g, ' ');
  const hinted = /^([a-z-]+):(.*)$/.exec(inner);
  if (hinted && !hinted[2].startsWith('/')) return { hint: hinted[1], body: hinted[2] };
  return { hint: null, body: inner };
}

function keywordClass(property: string, value: string): string | undefined {
  const classes = Object.hasOwn(KEYWORD_CLASSES, property) ? KEYWORD_CLASSES[property] : undefined;
  return classes && Object.hasOwn(classes, value) ? classes[value] : undefined;
}

function scaleKey(scale: Scale, value: string): string | null {
  const wanted = canonicalCss(value);
  return Object.keys(scale).find((key) => canonicalCss(scale[key] ?? '') === wanted) ?? null;
}

function stockClass(prefix: string, key: string): string {
  return key === '' ? prefix : `${prefix}-${key}`;
}

/** Splits at `separator` outside brackets, so `hover:[&>*]:p-4` keeps its arbitrary variant. */
function splitOutside(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '[') depth += 1;
    else if (character === ']') depth -= 1;
    else if (character === separator && depth === 0) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

function camelCase(property: string): string {
  return property.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
}
