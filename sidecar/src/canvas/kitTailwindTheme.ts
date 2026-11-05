// The pinned kit's tokens as Tailwind theme extensions, so a design writes
// bg-surface, rounded-pill or text-display instead of a [color:var(--ds-*)]
// spelling, and the class follows the selected mode the way the token does.
// A name the default theme already owns (rounded-md, text-lg, font-sans) is
// never overridden: the class keeps the stock value a model expects, and the
// kit token of that name is reached as rounded-[var(--ds-radius-md)]. Colour
// values wrap the token in a color-mix with Tailwind's <alpha-value>
// placeholder so an opacity modifier (bg-surface/50) keeps working.

import defaultTheme from 'tailwindcss/defaultTheme';
import {
  TOKEN_KINDS,
  type DocumentSection,
  type TokenSectionKind,
} from './designSystemDocument.js';

/** A theme.extend namespace a kit's tokens can land in. */
export type ThemeNamespace =
  | 'colors'
  | 'fontSize'
  | 'lineHeight'
  | 'letterSpacing'
  | 'fontWeight'
  | 'fontFamily'
  | 'spacing'
  | 'borderRadius'
  | 'boxShadow'
  | 'zIndex'
  | 'transitionDuration'
  | 'transitionTimingFunction';

/** One token's place in the theme. A 'DEFAULT' key is the bare utility. */
export interface ThemeEntry {
  namespace: ThemeNamespace;
  key: string;
  token: string;
}

// A token name's leading word selects the namespace, per section kind. The
// 'tokens' section is unclassified, so it accepts every prefix.
const PREFIXED: Partial<Record<TokenSectionKind, readonly [string, ThemeNamespace][]>> = {
  typography: [
    ['text', 'fontSize'],
    ['leading', 'lineHeight'],
    ['tracking', 'letterSpacing'],
    ['weight', 'fontWeight'],
    ['font', 'fontFamily'],
  ],
  motion: [
    ['duration', 'transitionDuration'],
    ['ease', 'transitionTimingFunction'],
  ],
  tokens: [
    ['text', 'fontSize'],
    ['leading', 'lineHeight'],
    ['tracking', 'letterSpacing'],
    ['weight', 'fontWeight'],
    ['font', 'fontFamily'],
    ['space', 'spacing'],
    ['size', 'spacing'],
    ['radius', 'borderRadius'],
    ['shadow', 'boxShadow'],
    ['z', 'zIndex'],
    ['duration', 'transitionDuration'],
    ['ease', 'transitionTimingFunction'],
  ],
};

// Sections whose names all carry one prefix into one namespace; a name without
// the prefix maps whole.
const FIXED: Partial<Record<TokenSectionKind, [string, ThemeNamespace]>> = {
  spacing: ['space', 'spacing'],
  size: ['size', 'spacing'],
  radius: ['radius', 'borderRadius'],
  shadows: ['shadow', 'boxShadow'],
  'z-index': ['z', 'zIndex'],
};

const TOKEN_SECTION_KINDS: ReadonlySet<string> = new Set(TOKEN_KINDS);

/** The keys Tailwind's default theme already owns, which a kit never overrides. */
const STOCK_KEYS: Readonly<Record<ThemeNamespace, ReadonlySet<string>>> = {
  colors: keysOf(defaultTheme.colors),
  fontSize: keysOf(defaultTheme.fontSize),
  lineHeight: keysOf(defaultTheme.lineHeight),
  letterSpacing: keysOf(defaultTheme.letterSpacing),
  fontWeight: keysOf(defaultTheme.fontWeight),
  fontFamily: keysOf(defaultTheme.fontFamily),
  spacing: keysOf(defaultTheme.spacing),
  borderRadius: keysOf(defaultTheme.borderRadius),
  boxShadow: keysOf(defaultTheme.boxShadow),
  zIndex: keysOf(defaultTheme.zIndex),
  transitionDuration: keysOf(defaultTheme.transitionDuration),
  transitionTimingFunction: keysOf(defaultTheme.transitionTimingFunction),
};

function keysOf(value: unknown): ReadonlySet<string> {
  return new Set(value !== null && typeof value === 'object' ? Object.keys(value) : []);
}

function keyOf(rest: string, prefix: string): string {
  if (rest === prefix) return 'DEFAULT';
  if (rest.startsWith(`${prefix}-`)) return rest.slice(prefix.length + 1);
  return rest;
}

function entryFor(kind: TokenSectionKind, token: string): ThemeEntry | null {
  const rest = token.startsWith('--ds-') ? token.slice('--ds-'.length) : token;
  if (kind === 'colors') return { namespace: 'colors', key: rest, token };
  const fixed = FIXED[kind];
  if (fixed) return { namespace: fixed[1], key: keyOf(rest, fixed[0]), token };
  for (const [prefix, namespace] of PREFIXED[kind] ?? []) {
    if (rest === prefix || rest.startsWith(`${prefix}-`))
      return { namespace, key: keyOf(rest, prefix), token };
  }
  return null;
}

/**
 * Every kit token's theme entry, skipping names the default theme owns and
 * tokens whose name maps to no namespace. The first section to claim a
 * namespace key wins.
 */
export function themeEntries(sections: DocumentSection[]): ThemeEntry[] {
  const entries: ThemeEntry[] = [];
  const seen = new Set<string>();
  for (const section of sections) {
    if (!TOKEN_SECTION_KINDS.has(section.kind)) continue;
    for (const item of section.items) {
      if (item.kind !== 'group') continue;
      for (const { name } of item.tokens) {
        const entry = entryFor(section.kind as TokenSectionKind, name);
        if (entry === null || STOCK_KEYS[entry.namespace].has(entry.key)) continue;
        const id = `${entry.namespace}.${entry.key}`;
        if (seen.has(id)) continue;
        seen.add(id);
        entries.push(entry);
      }
    }
  }
  return entries;
}

/** The kit's theme.extend: every mapped token as a var() the mode switch owns. */
export function kitTailwindTheme(
  sections: DocumentSection[],
): Partial<Record<ThemeNamespace, Record<string, string>>> {
  const theme: Partial<Record<ThemeNamespace, Record<string, string>>> = {};
  for (const entry of themeEntries(sections)) {
    const values = (theme[entry.namespace] ??= {});
    values[entry.key] =
      entry.namespace === 'colors'
        ? `color-mix(in srgb, var(${entry.token}) calc(<alpha-value> * 100%), transparent)`
        : `var(${entry.token})`;
  }
  return theme;
}
