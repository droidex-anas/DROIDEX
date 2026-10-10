// Reads a pasted DESIGN.md's blocks, CSS variables or a Tailwind config into
// declared tokens, each with its light, dark or shared value and the line that
// set it. Nothing here runs the source: CSS is parsed by PostCSS, and a config
// is read for its literals only.

import postcss, { type AtRule, type Declaration, type Node, type Rule } from 'postcss';
import { readConfigTheme, type ConfigValue } from './configLiterals.js';
import {
  declareToken,
  rootSelectorScope,
  selectorScopes,
  type TokenScope,
} from './designSystemTokens.js';
import type { CanvasDiagnostic } from './protocol.js';

export type Mode = 'light' | 'dark';

/** Each scope's token values, and the line that first declared each name. */
export interface Declared {
  scopes: Record<TokenScope, Record<string, string>>;
  lines: Map<string, number>;
}

// Recursive readers see a pasted source only after its nesting is bounded.
const MAX_STYLESHEET_NESTING = 32;

// A stylesheet cannot start with a brace or a declaration keyword, or hold an
// object after `theme:`; a config can.
export function looksLikeConfig(text: string): boolean {
  return (
    /\b(?:module\.exports|export\s+default)\b|\btheme\s*:\s*\{/.test(text) ||
    /^\s*(?:\{|const\b|let\b|var\b|import\b|export\b)/.test(text)
  );
}

export function fencedBlocks(markdown: string): { language: string; text: string; line: number }[] {
  const blocks: { language: string; text: string; line: number }[] = [];
  const lines = markdown.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const fence = /^\s*(`{3,}|~{3,})\s*([\w-]*)/.exec(lines[index]);
    if (!fence) continue;
    const opening = index;
    while (index + 1 < lines.length && !lines[index + 1].trim().startsWith(fence[1])) index += 1;
    blocks.push({
      language: fence[2].toLowerCase(),
      text: lines.slice(opening + 1, index + 1).join('\n'),
      line: opening + 1,
    });
    index += 1;
  }
  return blocks;
}

/** Collects root and mode custom properties; answers the refusal when the stylesheet does not parse. */
export function readCss(
  text: string,
  lineOffset: number,
  declared: Declared,
  diagnostics: CanvasDiagnostic[],
): CanvasDiagnostic | null {
  if (nestingDepth(text, '{', '}') > MAX_STYLESHEET_NESTING)
    return {
      code: 'invalid_input',
      message: 'That stylesheet nests its rules too deeply to read.',
    };
  let root;
  try {
    root = postcss.parse(text, { from: undefined, map: false });
  } catch (error) {
    if (!(error instanceof postcss.CssSyntaxError)) throw error;
    const at = error.line === undefined ? '' : ` at line ${String(error.line + lineOffset)}`;
    return { code: 'css_error', message: `Fix this stylesheet${at}: ${error.reason}.` };
  }
  root.walkDecls((declaration) => {
    if (!declaration.prop.startsWith('--')) return;
    const line = lineOffset + (declaration.source?.start?.line ?? 1);
    const name = tokenName(declaration.prop);
    const scopes = declarationScopes(declaration);
    if (name === null || scopes.length === 0)
      diagnostics.push({
        code: 'manual_interpretation_required',
        message: `${declaration.prop} is set outside :root, html, @theme and the light and dark rules, so it was not imported.`,
        line,
      });
    else declare(declared, { name, value: declaration.value, targets: scopes, line }, diagnostics);
  });
  return null;
}

// Beyond the kit's own root and `data-mode` rules, pasted CSS commonly scopes
// modes with a class or `data-theme`, and web components use `:host`.
const CLASS_MODE_SELECTOR = /^(?::root|html)?\.(light|dark)$/;
const THEME_MODE_SELECTOR = /^(?::root|html)?\[data-theme\s*=\s*['"]?(light|dark)['"]?\]$/;

function pastedSelectorScope(selector: string): TokenScope | null {
  if (selector === ':host') return 'shared';
  const mode = (CLASS_MODE_SELECTOR.exec(selector) ?? THEME_MODE_SELECTOR.exec(selector))?.[1];
  if (mode !== undefined) return mode === 'light' ? 'light' : 'dark';
  return rootSelectorScope(selector);
}

function declarationScopes(declaration: Declaration): TokenScope[] {
  const parent = declaration.parent;
  if (isAtRule(parent))
    return parent.name === 'theme' && outside(parent)?.type === 'root' ? ['shared'] : [];
  if (!isRule(parent)) return [];
  const scopes = selectorScopes(parent.selector, pastedSelectorScope);
  const outer = outside(parent);
  if (outer?.type === 'root') return scopes;
  return isAtRule(outer) && outside(outer)?.type === 'root'
    ? colourSchemeScopes(outer, scopes)
    : [];
}

/** A root rule inside a colour-scheme query belongs to that mode. */
function colourSchemeScopes(media: AtRule, scopes: TokenScope[]): TokenScope[] {
  const scheme =
    media.name === 'media'
      ? /^\(\s*prefers-color-scheme\s*:\s*(light|dark)\s*\)$/i.exec(media.params.trim())
      : null;
  if (!scheme || scopes.length !== 1 || scopes[0] !== 'shared') return [];
  return [scheme[1].toLowerCase() === 'light' ? 'light' : 'dark'];
}

/** The container a node sits in, looking through `@layer` blocks, which do not scope tokens. */
function outside(node: Node): Node['parent'] {
  let container = node.parent;
  while (isAtRule(container) && container.name === 'layer') container = container.parent;
  return container;
}

function isAtRule(node: Node['parent']): node is AtRule {
  return node?.type === 'atrule';
}

function isRule(node: Node['parent']): node is Rule {
  return node?.type === 'rule';
}

/** The deepest nesting of the given brackets, counted without recursion. */
export function nestingDepth(text: string, open: string, close: string): number {
  let depth = 0;
  let deepest = 0;
  for (const character of text) {
    if (open.includes(character)) {
      depth += 1;
      deepest = Math.max(deepest, depth);
    } else if (close.includes(character) && depth > 0) depth -= 1;
  }
  return deepest;
}

// Tailwind 4's theme variable names, so a config and its CSS name tokens alike.
const TAILWIND_SECTIONS = new Map([
  ['colors', 'color'],
  ['fontFamily', 'font'],
  ['fontSize', 'text'],
  ['borderRadius', 'radius'],
  ['boxShadow', 'shadow'],
  ['spacing', 'spacing'],
]);

/** Reads literal theme values; the config is parsed, never run. Answers a refusal for a config too deep to read. */
export function readTailwind(
  text: string,
  lineOffset: number,
  declared: Declared,
  diagnostics: CanvasDiagnostic[],
): CanvasDiagnostic | null {
  const config = readConfigTheme(text);
  if (config.status === 'tooDeep')
    return { code: 'invalid_input', message: 'That config nests its values too deeply to read.' };
  const theme = config.theme;
  if (theme?.kind !== 'object') {
    diagnostics.push({ code: 'no_tokens', message: 'That config has no literal theme object.' });
    return null;
  }
  // `theme.extend` overrides `theme` for the same name, as Tailwind merges them,
  // so values are gathered first and each name is declared once.
  const values = new Map<string, { value: string; line: number }>();
  const collect = (value: ConfigValue, name: string, path: string, section: string): void => {
    if (value.kind === 'object') {
      for (const entry of value.entries) {
        if (entry.key === null) collect(entry.value, name, path, section);
        else
          collect(
            entry.value,
            entry.key === 'DEFAULT' ? name : `${name}-${entry.key}`,
            `${path}.${entry.key}`,
            section,
          );
      }
      return;
    }
    const literal = literalValue(value, section);
    const tokenLine = lineOffset + value.line;
    if (literal !== null) values.set(name, { value: literal, line: tokenLine });
    else
      diagnostics.push({
        code: 'manual_interpretation_required',
        message: `${path} is computed in the config. Paste its values as CSS variables instead.`,
        line: tokenLine,
      });
  };
  const extend = theme.entries.find((entry) => entry.key === 'extend')?.value;
  for (const [scope, path] of [
    [theme, 'theme'],
    [extend, 'theme.extend'],
  ] as const) {
    if (scope?.kind !== 'object') continue;
    for (const { key, value } of scope.entries) {
      const prefix = key === null ? undefined : TAILWIND_SECTIONS.get(key);
      if (key !== null && prefix !== undefined)
        collect(value, `--${prefix}`, `${path}.${key}`, key);
    }
  }
  for (const [rawName, { value, line }] of values) {
    const name = tokenName(rawName);
    if (name !== null) declare(declared, { name, value, targets: ['shared'], line }, diagnostics);
  }
  return null;
}

function literalValue(value: ConfigValue, section: string): string | null {
  if (value.kind === 'text') return value.value;
  // A list with a spread or reference cannot be read whole.
  if (value.kind !== 'list' || value.items.some((item) => item.kind === 'computed')) return null;
  const texts = value.items.flatMap((item) => (item.kind === 'text' ? [item.value] : []));
  // A family list joins; fontSize's `[size, { lineHeight }]` keeps its size.
  if (section === 'fontFamily' && texts.length === value.items.length)
    return texts
      .map((family) => (/\s/.test(family) && !/^["']/.test(family) ? `"${family}"` : family))
      .join(', ');
  const first = value.items.at(0);
  return first?.kind === 'text' ? first.value : null;
}

/** The kit's spelling of a custom property name: `--Brand_500` is `--brand-500`. */
export function tokenName(raw: string): string | null {
  const words = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return words === '' ? null : `--${words}`;
}

// Pasted values may wrap across lines; a token value is a single line.
function declare(
  declared: Declared,
  token: { name: string; value: string; targets: TokenScope[]; line: number },
  diagnostics: CanvasDiagnostic[],
): void {
  if (!declared.lines.has(token.name)) declared.lines.set(token.name, token.line);
  declareToken(
    declared.scopes,
    { ...token, value: token.value.replace(/\s+/g, ' ').trim() },
    diagnostics,
  );
}
