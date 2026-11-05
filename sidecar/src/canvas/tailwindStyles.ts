// The Tailwind classes a direct style edit reads and writes. Designs compile
// against stock Tailwind 3 plus the pinned kit's add-only theme
// (canvasTailwindOptions), whose stock classes keep their values, so a kit token
// is written in the arbitrary-value form kits use (`p-[var(--ds-space-4)]`), and
// a raw value as the stock class whose value equals it (`p-4` for 16px) or,
// without one, not as a class at all. tailwindStyles.test.ts compiles every
// class this module can write with Tailwind itself.

import { canonicalCss, type StyleResolution } from './styleEdits.js';

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

type Scale = Readonly<Record<string, string>>;

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

const SPACING_STEPS = [
  0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 20, 24, 28, 32, 36, 40, 44, 48,
  52, 56, 60, 64, 72, 80, 96,
];
const SPACING: Scale = {
  '0': '0px',
  px: '1px',
  ...Object.fromEntries(SPACING_STEPS.map((step) => [String(step), `${String(step / 4)}rem`])),
};
const SIZE: Scale = { ...SPACING, full: '100%', auto: 'auto', fit: 'fit-content' };
const MAX_SIZE: Scale = { ...SIZE, none: 'none' };
const RADIUS: Scale = {
  none: '0px',
  sm: '0.125rem',
  '': '0.25rem',
  md: '0.375rem',
  lg: '0.5rem',
  xl: '0.75rem',
  '2xl': '1rem',
  '3xl': '1.5rem',
  full: '9999px',
};
const FONT_WEIGHT: Scale = {
  thin: '100',
  extralight: '200',
  light: '300',
  normal: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
  extrabold: '800',
  black: '900',
};
const LINE_HEIGHT: Scale = {
  '3': '.75rem',
  '4': '1rem',
  '5': '1.25rem',
  '6': '1.5rem',
  '7': '1.75rem',
  '8': '2rem',
  '9': '2.25rem',
  '10': '2.5rem',
  none: '1',
  tight: '1.25',
  snug: '1.375',
  normal: '1.5',
  relaxed: '1.625',
  loose: '2',
};
const TRACKING: Scale = {
  tighter: '-0.05em',
  tight: '-0.025em',
  normal: '0em',
  wide: '0.025em',
  wider: '0.05em',
  widest: '0.1em',
};
const OPACITY: Scale = Object.fromEntries(
  Array.from({ length: 21 }, (_, index) => [String(index * 5), String(index / 20)]),
);
/** Each stock font size with the line height it sets alongside. */
const FONT_SIZE_LINE_HEIGHT: Scale = {
  xs: '1rem',
  sm: '1.25rem',
  base: '1.5rem',
  lg: '1.75rem',
  xl: '1.75rem',
  '2xl': '2rem',
  '3xl': '2.25rem',
  '4xl': '2.5rem',
  '5xl': '1',
  '6xl': '1',
  '7xl': '1',
  '8xl': '1',
  '9xl': '1',
};
const FONT_FAMILIES = new Set(['sans', 'serif', 'mono']);
const SHADOWS = new Set(['', 'sm', 'md', 'lg', 'xl', '2xl', 'inner', 'none']);
const BORDER_WIDTH: Scale = { '': '1px', '0': '0px', '2': '2px', '4': '4px', '8': '8px' };
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
  minWidth: { prefix: 'min-w', scale: SIZE },
  minHeight: { prefix: 'min-h', scale: SIZE },
  maxWidth: { prefix: 'max-w', scale: MAX_SIZE },
  maxHeight: { prefix: 'max-h', scale: MAX_SIZE },
  borderRadius: { prefix: 'rounded', scale: RADIUS },
  color: { prefix: 'text', hint: 'color' },
  backgroundColor: { prefix: 'bg', hint: 'color' },
  borderColor: { prefix: 'border', hint: 'color' },
  boxShadow: { prefix: 'shadow', hint: 'shadow' },
  fontFamily: { prefix: 'font', hint: 'family-name' },
  fontSize: { prefix: 'text', hint: 'length' },
  fontWeight: { prefix: 'font', hint: 'number', scale: FONT_WEIGHT },
  lineHeight: { prefix: 'leading', scale: LINE_HEIGHT },
  letterSpacing: { prefix: 'tracking', scale: TRACKING, signed: true },
  opacity: { prefix: 'opacity', scale: OPACITY },
  borderWidth: { prefix: 'border', hint: 'length', scale: BORDER_WIDTH },
};

/** Keyword properties, by the CSS value each stock class sets. */
const KEYWORD_CLASSES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  display: {
    block: 'block',
    'inline-block': 'inline-block',
    inline: 'inline',
    flex: 'flex',
    'inline-flex': 'inline-flex',
    grid: 'grid',
    none: 'hidden',
  },
  flexWrap: { nowrap: 'flex-nowrap', wrap: 'flex-wrap', 'wrap-reverse': 'flex-wrap-reverse' },
  flexGrow: { '1': 'grow', '0': 'grow-0' },
  alignSelf: {
    auto: 'self-auto',
    'flex-start': 'self-start',
    center: 'self-center',
    'flex-end': 'self-end',
    stretch: 'self-stretch',
    baseline: 'self-baseline',
  },
  borderStyle: {
    solid: 'border-solid',
    dashed: 'border-dashed',
    dotted: 'border-dotted',
    double: 'border-double',
    none: 'border-none',
  },
  textAlign: {
    left: 'text-left',
    center: 'text-center',
    right: 'text-right',
    justify: 'text-justify',
    start: 'text-start',
    end: 'text-end',
  },
  textTransform: {
    none: 'normal-case',
    uppercase: 'uppercase',
    lowercase: 'lowercase',
    capitalize: 'capitalize',
  },
  overflow: {
    visible: 'overflow-visible',
    hidden: 'overflow-hidden',
    clip: 'overflow-clip',
    scroll: 'overflow-scroll',
    auto: 'overflow-auto',
  },
  flexDirection: {
    row: 'flex-row',
    'row-reverse': 'flex-row-reverse',
    column: 'flex-col',
    'column-reverse': 'flex-col-reverse',
  },
  alignItems: {
    'flex-start': 'items-start',
    'flex-end': 'items-end',
    center: 'items-center',
    baseline: 'items-baseline',
    stretch: 'items-stretch',
  },
  justifyContent: {
    normal: 'justify-normal',
    'flex-start': 'justify-start',
    'flex-end': 'justify-end',
    center: 'justify-center',
    'space-between': 'justify-between',
    'space-around': 'justify-around',
    'space-evenly': 'justify-evenly',
    stretch: 'justify-stretch',
  },
};

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
 * says exactly that and the value has to stay inline.
 */
export function styleClass(property: string, resolution: StyleResolution): string | null {
  const utility = Object.hasOwn(UTILITIES, property) ? UTILITIES[property] : undefined;
  if (resolution.kind === 'token') {
    if (!utility) return null;
    const hint = utility.hint ? `${utility.hint}:` : '';
    return `${utility.prefix}-[${hint}var(${resolution.token})]`;
  }
  const keyword = keywordClass(property, resolution.value);
  if (keyword !== undefined) return keyword;
  if (!utility?.scale) return null;
  const direct = scaleKey(utility.scale, resolution.value);
  if (direct !== null) return stockClass(utility.prefix, direct);
  if (!utility.signed || !resolution.value.startsWith('-')) return null;
  const negated = scaleKey(utility.scale, resolution.value.slice(1));
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

/** What one class token sets, or null for a class no style edit concerns. */
export function classStyle(token: string): ClassStyle | null {
  const variants = splitOutside(token, ':');
  const utility = (variants.pop() ?? '').replace(/^!/, '');
  const read = utilityStyle(utility);
  if (!read) return null;
  let scope: ClassStyle['scope'] = 'always';
  if (variants.some((variant) => FRAME_VARIANT.test(variant))) scope = 'frame';
  else if (variants.length > 0) scope = 'state';
  return { ...read, scope };
}

function utilityStyle(utility: string): Omit<ClassStyle, 'scope'> | null {
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
      return textStyle(value);
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
      return null;
  }
}

/** A font-size modifier's line height, arbitrary or from the stock scale. */
function modifierLineHeight(modifier: string | undefined): string | undefined {
  if (modifier === undefined) return undefined;
  return arbitrary(modifier)?.body ?? LINE_HEIGHT[modifier];
}

function textStyle(value: string): Omit<ClassStyle, 'scope'> | null {
  const [key = '', ...modifiers] = splitOutside(value, '/');
  const lineHeight = modifierLineHeight(modifiers.at(0));
  if (Object.hasOwn(FONT_SIZE_LINE_HEIGHT, key))
    return { sets: ['fontSize'], lineHeight: lineHeight ?? FONT_SIZE_LINE_HEIGHT[key] };
  const custom = arbitrary(key);
  const isSize =
    custom?.hint === 'length' || (!custom?.hint && LENGTH_LIKE.test(custom?.body ?? ''));
  if (isSize) return lineHeight ? { sets: ['fontSize'], lineHeight } : { sets: ['fontSize'] };
  return isColour(value) ? { sets: ['color'] } : null;
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
