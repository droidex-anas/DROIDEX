// Reads a pasted DESIGN.md's blocks, CSS variables or a Tailwind config into
// declared tokens, each with its light, dark or shared value and the line that
// set it. Nothing here runs the source: CSS is parsed by PostCSS, and a config
// is read for its literals only.

import postcss, { type AtRule, type Declaration, type Node, type Rule } from 'postcss';
import { readConfigTheme, type ConfigValue } from './configLiterals.js';
import type { CanvasDiagnostic } from './protocol.js';

export type Mode = 'light' | 'dark';
type Scope = 'shared' | Mode;
export type Declared = Map<string, { values: Partial<Record<Scope, string>>; line: number }>;

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
    const scope = declarationScope(declaration);
    if (scope === null)
      diagnostics.push({
        code: 'manual_interpretation_required',
        message: `${declaration.prop} is set outside :root, html, @theme and the light and dark rules, so it was not imported.`,
        line,
      });
    else declare(declared, declaration.prop, scope, declaration.value, line);
  });
  return null;
}

const ROOT_SELECTOR = /^(?::root|html|:host)$/;
const CLASS_MODE_SELECTOR = /^(?::root|html)?\.(light|dark)$/;
const ATTRIBUTE_MODE_SELECTOR = /^(?::root|html)?\[data-(?:mode|theme)=["']?(light|dark)["']?\]$/;

function declarationScope(declaration: Declaration): Scope | null {
  const parent = declaration.parent;
  if (isAtRule(parent))
    return parent.name === 'theme' && outside(parent)?.type === 'root' ? 'shared' : null;
  if (!isRule(parent)) return null;
  const scope = selectorScope(parent.selector);
  const outer = outside(parent);
  if (scope === null || outer?.type === 'root') return scope;
  if (!isAtRule(outer) || outer.name !== 'media' || outside(outer)?.type !== 'root') return null;
  const scheme = /^\(\s*prefers-color-scheme\s*:\s*(light|dark)\s*\)$/i.exec(outer.params.trim());
  return scheme && scope === 'shared' ? (scheme[1].toLowerCase() as Mode) : null;
}

/** The one scope every selector in a list names, or null when they disagree or name another rule. */
function selectorScope(selectors: string): Scope | null {
  const scopes = new Set<Scope | null>();
  for (const selector of selectors.split(',')) {
    const compact = selector.replace(/\s+/g, '');
    const mode = (CLASS_MODE_SELECTOR.exec(compact) ?? ATTRIBUTE_MODE_SELECTOR.exec(compact))?.[1];
    if (ROOT_SELECTOR.test(compact)) scopes.add('shared');
    else scopes.add(mode === undefined ? null : (mode as Mode));
  }
  // `:root, .light` is the usual way to say the root doubles as light mode.
  if (scopes.size === 2 && scopes.has('shared') && scopes.has('light')) scopes.delete('light');
  return scopes.size === 1 ? [...scopes][0] : null;
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

// Tailwind 4's theme variable names, so a config and its CSS name tokens alike.
const TAILWIND_SECTIONS = new Map([
  ['colors', 'color'],
  ['fontFamily', 'font'],
  ['fontSize', 'text'],
  ['borderRadius', 'radius'],
  ['boxShadow', 'shadow'],
  ['spacing', 'spacing'],
]);

/** Reads literal theme values; the config is parsed, never run. */
export function readTailwind(
  text: string,
  lineOffset: number,
  declared: Declared,
  diagnostics: CanvasDiagnostic[],
): void {
  const theme = readConfigTheme(text);
  if (theme?.kind !== 'object') {
    diagnostics.push({ code: 'no_tokens', message: 'That config has no literal theme object.' });
    return;
  }
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
    if (literal !== null) declare(declared, name, 'shared', literal, lineOffset + value.line);
    else
      diagnostics.push({
        code: 'manual_interpretation_required',
        message: `${path} is computed in the config. Paste its values as CSS variables instead.`,
        line: lineOffset + value.line,
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

// A later declaration of a name wins, as it would in a stylesheet.
function declare(
  declared: Declared,
  rawName: string,
  scope: Scope,
  value: string,
  line: number,
): void {
  const name = tokenName(rawName);
  if (name === null) return;
  const entry = declared.get(name) ?? { values: {}, line };
  entry.values[scope] = value.replace(/\s+/g, ' ').trim();
  declared.set(name, entry);
}
