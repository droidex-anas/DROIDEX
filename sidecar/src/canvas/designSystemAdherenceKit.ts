// The pinned kit as designSystemAdherence.ts reads it: the rules each of its
// token sections sets, the font families it provides and the classes its CSS
// defines. A kit without a section has no rule for it.

import postcss, { CssSyntaxError, type Root } from 'postcss';
import valueParser from 'postcss-value-parser';
import { KIT_SPECIFIER } from './designBundle.js';
import { kitPrimitives } from './designSystemBrief.js';
import { kitModes, type DocumentSection, type TokenSectionKind } from './designSystemDocument.js';
import type { DesignSystem } from './designSystems.js';
import type { CanvasDiagnostic } from './protocol.js';

// Families that name no font file: CSS keywords and the platform's generic stacks.
const GENERIC_FAMILIES = new Set([
  'inherit',
  'initial',
  'unset',
  'revert',
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
  'math',
  'emoji',
  'fangsong',
]);

// Font sizes, radii and spacing are checked in absolute units; `em` and `%`
// are proportions of their context, not values a scale holds.
const ABSOLUTE_LENGTH = /^-?(?:\d+(?:\.\d+)?|\.\d+)(px|rem|pt)$/i;
const PX_PER_UNIT = { px: 1, rem: 16, pt: 4 / 3 };
const SHADOW_KEYWORDS = new Set(['none', 'inherit', 'initial', 'unset', 'revert', 'revert-layer']);

export type ScaleKind = 'type' | 'radius' | 'spacing' | 'shadow';

/** The token values, normalized, a value of one kind should hold, and the tokens to name. */
export interface Scale {
  values: Set<string>;
  tokens: string[];
}

/** The pinned kit as the check reads it; a missing rule is a section the kit lacks. */
export interface Kit {
  tokens: Set<string>;
  checksColors: boolean;
  fonts: { families: Set<string>; tokens: string[] } | null;
  scales: Partial<Record<ScaleKind, Scale>>;
  classes: Set<string>;
  primitives: string[];
}

/**
 * A saved kit's CSS is first parsed here, before the stylesheet build reviews it,
 * so a syntax error is reported as that build would: the kit file and its line.
 */
export function readKit(
  system: DesignSystem,
): { ok: true; kit: Kit } | { ok: false; diagnostic: CanvasDiagnostic } {
  const typography = sectionTokens(system.sections, 'typography');
  const families = new Set(GENERIC_FAMILIES);
  const fontTokens: string[] = [];
  const typeSizes: SectionToken[] = [];
  for (const token of typography) {
    // A size, weight or line height is a number, never a family.
    const named = token.values.flatMap(fontFamilies).filter((family) => !/^[\d.]/.test(family));
    if (named.length > 0) fontTokens.push(token.name);
    for (const family of named) families.add(family.toLowerCase());
    if (token.values.every((value) => ABSOLUTE_LENGTH.test(value))) typeSizes.push(token);
  }
  const scales: Kit['scales'] = {};
  for (const [kind, tokens] of [
    ['type', typeSizes],
    ['radius', sectionTokens(system.sections, 'radius')],
    ['spacing', sectionTokens(system.sections, 'spacing')],
    ['shadow', sectionTokens(system.sections, 'shadows')],
  ] as const) {
    if (tokens.length === 0) continue;
    const values = new Set(tokens.flatMap((token) => token.values.map(normalized)));
    scales[kind] = { values, tokens: tokens.map((token) => token.name) };
  }
  const classes = new Set<string>();
  for (const [path, css] of Object.entries(system.files)) {
    if (!path.endsWith('.css')) continue;
    let root: Root;
    try {
      root = postcss.parse(css);
    } catch (error) {
      if (!(error instanceof CssSyntaxError)) throw error;
      const file = `${KIT_SPECIFIER}/${path}`;
      const at = error.line === undefined ? { file } : { file, line: error.line };
      return { ok: false, diagnostic: { code: 'css_error', message: error.reason, ...at } };
    }
    root.walkAtRules('font-face', (rule) => {
      rule.walkDecls('font-family', (declaration) => {
        for (const family of fontFamilies(declaration.value)) families.add(family.toLowerCase());
      });
    });
    root.walkRules((rule) => {
      for (const match of rule.selector.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) classes.add(match[1]);
    });
  }
  return {
    ok: true,
    kit: {
      tokens: new Set(Object.keys(kitModes(system.sections).light)),
      checksColors: sectionTokens(system.sections, 'colors').length > 0,
      fonts: typography.length > 0 ? { families, tokens: fontTokens } : null,
      scales,
      classes,
      primitives: kitPrimitives(system),
    },
  };
}

interface SectionToken {
  name: string;
  /** One value, or the light and dark values. */
  values: string[];
}

function sectionTokens(sections: DocumentSection[], kind: TokenSectionKind): SectionToken[] {
  const tokens: SectionToken[] = [];
  for (const section of sections) {
    if (section.kind !== kind) continue;
    for (const item of section.items) {
      if (item.kind !== 'group') continue;
      for (const token of item.tokens)
        tokens.push({
          name: token.name,
          values: 'value' in token ? [token.value] : [token.light, token.dark],
        });
    }
  }
  return tokens;
}

/**
 * The absolute lengths outside any function that no token of the scale holds;
 * none when the whole value is a token's, as a compound `4px 8px` radius.
 */
export function offScale(scale: Scale | undefined, value: string): string[] {
  if (!scale || scale.values.has(normalized(value))) return [];
  return lengthWords(value).filter((word) => !scale.values.has(normalized(word.replace(/^-/, ''))));
}

export function lengthWords(value: string): string[] {
  return valueParser(value)
    .nodes.filter((node) => node.type === 'word' && ABSOLUTE_LENGTH.test(node.value))
    .map((node) => node.value);
}

/** A shadow written out rather than taken from a token; one that reads a token is not. */
export function isShadowLiteral(scale: Scale | undefined, value: string): boolean {
  const shadow = normalized(value);
  if (!scale || SHADOW_KEYWORDS.has(shadow) || /\bvar\(/.test(shadow)) return false;
  return !scale.values.has(shadow);
}

/** A value as the scales compare it: each absolute length in px, at the browser's 16px root. */
function normalized(value: string): string {
  return value.trim().toLowerCase().split(/\s+/).map(inPx).join(' ');
}

function inPx(word: string): string {
  const length = ABSOLUTE_LENGTH.exec(word);
  if (!length) return word;
  const px = Number.parseFloat(word) * PX_PER_UNIT[length[1] as keyof typeof PX_PER_UNIT];
  return `${String(Math.round(px * 1000) / 1000)}px`;
}

/** Each family a `font-family` value names, unquoted, ignoring `var()`. */
export function fontFamilies(value: string): string[] {
  const named = valueParser(value)
    .nodes.filter((node) => !(node.type === 'function' && node.value.toLowerCase() === 'var'))
    .map((node) => valueParser.stringify(node))
    .join('');
  return named
    .split(',')
    .map((family) => family.trim().replace(/^(['"])(.*)\1$/, '$2'))
    .filter((family) => family.length > 0);
}
