// Reads a DESIGN.md's blocks, CSS variables, a Tailwind config or a token
// module, pasted or read from a project, into declared tokens, each with its
// light, dark or shared value and the place that set it. Nothing here runs
// the source: CSS is parsed by PostCSS, and a config or module is read for
// its literals only.

import postcss, {
  type AtRule,
  type ChildNode,
  type Declaration,
  type Node,
  type Root,
  type Rule,
} from 'postcss';
import { readConfigBindings, readConfigTheme, type ConfigValue } from './configLiterals.js';
import {
  declareToken,
  rootSelectorScope,
  selectorScopes,
  type TokenScope,
} from './designSystemTokens.js';
import type { CanvasDiagnostic } from './protocol.js';

export type Mode = 'light' | 'dark';

/** Where a source's text sits: the project file it came from, if any, and the lines above it. */
export interface TextOrigin {
  file?: string;
  lineOffset: number;
}

/** A line of a source, in its project file when it has one. */
interface SourcePlace {
  file?: string;
  line: number;
}

/** Each scope's token values and where each was set, and the config's placeholders. */
export interface Declared {
  scopes: Record<TokenScope, Record<string, string>>;
  /** In the order names were first declared. */
  places: Map<string, Partial<Record<TokenScope, SourcePlace>>>;
  /** Config values that are `var()` of their own name, as `sm: 'var(--shadow-sm)'`. */
  placeholders: Map<string, SourcePlace>;
}

export function emptyDeclared(): Declared {
  return {
    scopes: { shared: {}, light: {}, dark: {} },
    places: new Map(),
    placeholders: new Map(),
  };
}

/** Where the value a mode reads for a token was set: its own rule, else the shared one. */
export function placeOf(declared: Declared, name: string, mode: Mode): SourcePlace | undefined {
  const places = declared.places.get(name);
  return places?.[mode] ?? places?.shared;
}

/**
 * A placeholder names the stylesheet's token of the same name, so it gives way
 * to any source that sets it; one no source sets is declared as written.
 */
export function declarePlaceholders(declared: Declared, diagnostics: CanvasDiagnostic[]): void {
  for (const [name, place] of declared.placeholders)
    if (!declared.places.has(name))
      declare(declared, { name, value: `var(${name})`, targets: ['shared'], place }, diagnostics);
}

function placeIn(origin: TextOrigin, line: number): SourcePlace {
  const at = origin.lineOffset + line;
  return origin.file === undefined ? { line: at } : { file: origin.file, line: at };
}

function fileOf(origin: TextOrigin): { file?: string } {
  return origin.file === undefined ? {} : { file: origin.file };
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
  origin: TextOrigin,
  declared: Declared,
  diagnostics: CanvasDiagnostic[],
): CanvasDiagnostic | null {
  let root;
  try {
    root = postcss.parse(text, { from: undefined, map: false });
  } catch (error) {
    if (!(error instanceof postcss.CssSyntaxError)) throw error;
    const at = error.line === undefined ? '' : ` at line ${String(error.line + origin.lineOffset)}`;
    return {
      code: 'css_error',
      message: `Fix this stylesheet${at}: ${error.reason}.`,
      ...fileOf(origin),
    };
  }
  if (ruleDepth(root) > MAX_STYLESHEET_NESTING)
    return {
      code: 'invalid_input',
      message: 'That stylesheet nests its rules too deeply to read.',
      ...fileOf(origin),
    };
  root.walkDecls((declaration) => {
    if (!declaration.prop.startsWith('--')) return;
    const place = placeIn(origin, declaration.source?.start?.line ?? 1);
    const name = tokenName(declaration.prop);
    const scopes = declarationScopes(declaration);
    if (name === null || scopes.length === 0)
      diagnostics.push({
        code: 'manual_interpretation_required',
        message: `${declaration.prop} is set outside :root, html, @theme and the light and dark rules, so it was not imported.`,
        ...place,
      });
    else declare(declared, { name, value: declaration.value, targets: scopes, place }, diagnostics);
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

/**
 * How deeply a parsed stylesheet nests its rules, measured without recursion.
 * PostCSS parses iteratively but walks recursively, so this runs between them;
 * counting braces in the text would miss a brace inside a string.
 */
function ruleDepth(root: Root): number {
  let deepest = 0;
  const pending: [Root | ChildNode, number][] = [[root, 0]];
  for (let next = pending.pop(); next; next = pending.pop()) {
    const [node, depth] = next;
    deepest = Math.max(deepest, depth);
    if ('nodes' in node) for (const child of node.nodes ?? []) pending.push([child, depth + 1]);
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
  origin: TextOrigin,
  declared: Declared,
  diagnostics: CanvasDiagnostic[],
): CanvasDiagnostic | null {
  const config = readConfigTheme(text);
  if (config.status === 'tooDeep')
    return {
      code: 'invalid_input',
      message: 'That config nests its values too deeply to read.',
      ...fileOf(origin),
    };
  const theme = config.theme;
  if (theme?.kind !== 'object') {
    diagnostics.push({
      code: 'no_tokens',
      message: 'That config has no literal theme object.',
      ...fileOf(origin),
    });
    return null;
  }
  // `theme.extend` overrides `theme` for the same name, as Tailwind merges them,
  // so values are gathered first and each name is declared once.
  const values = new Map<string, { value: string; place: SourcePlace }>();
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
    const place = placeIn(origin, value.line);
    if (literal !== null) values.set(name, { value: literal, place });
    else
      diagnostics.push({
        code: 'manual_interpretation_required',
        message: `${path} is computed in the config. Paste its values as CSS variables instead.`,
        ...place,
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
  for (const [rawName, { value, place }] of values) {
    const name = tokenName(rawName);
    if (name === null) continue;
    if (value.trim() === `var(${name})`) declared.placeholders.set(name, place);
    else declare(declared, { name, value, targets: ['shared'], place }, diagnostics);
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

// Keys a token module carries beside its values; they never name a token.
const MODULE_METADATA = new Set([
  'name',
  'id',
  'version',
  'usage',
  'description',
  '$description',
  'comment',
  'type',
  '$type',
  'meta',
  'note',
]);

/** A binding or entry named for a mode holds that mode's values. */
function bindingMode(name: string | null): Mode | null {
  if (name === null) return null;
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/);
  if (words.includes('light')) return 'light';
  if (words.includes('dark')) return 'dark';
  return null;
}

/**
 * Reads a JS, TS or JSON token module's literal bindings, never running them:
 * nested objects flatten into hyphenated names, `light` and `dark` entries
 * set that mode's value, a `value` entry unwraps, and a list of named records
 * (a token file's `{ name, value }` entries) names each token by its record.
 * A flattened name another value already holds widens by its family, reported
 * as renamed; what cannot be read is reported, never dropped quietly.
 */
export function readTokenModule(
  text: string,
  origin: TextOrigin,
  declared: Declared,
  diagnostics: CanvasDiagnostic[],
): CanvasDiagnostic | null {
  const read = readConfigBindings(text);
  if (read.status === 'tooDeep')
    return {
      code: 'invalid_input',
      message: 'That token module nests its values too deeply to read.',
      ...fileOf(origin),
    };
  const diagnosed = diagnostics.length;
  let found = 0;
  /** Each token this module declared, by the collect-path and value that set it. */
  const claims = new Map<string, { path: string; value: string }>();
  const leaf = (
    value: ConfigValue,
    name: string,
    path: string,
    mode: Mode | null,
    family: string,
  ): void => {
    const place = placeIn(origin, value.line);
    if (value.kind !== 'text') {
      diagnostics.push({
        code: 'manual_interpretation_required',
        message: `${path} is computed in the module. Set it with a token change instead.`,
        ...place,
      });
      return;
    }
    let token = tokenName(name);
    if (token === null) return;
    // A shared name another value already holds (a size next to a colour)
    // widens by its family; with no honest name it stays, and the competing
    // values are refused as they are for every source. A mode's value never
    // widens: the other mode is its own, and the cascade settles the rest.
    const normalized = value.value.replace(/\s+/g, ' ').trim();
    const taken = (candidate: string): boolean => {
      if (mode !== null) return false;
      const shared = declared.scopes.shared[candidate] as string | undefined;
      if (shared !== undefined && shared !== normalized) return true;
      const claim = claims.get(candidate);
      return claim !== undefined && claim.path !== path && claim.value !== normalized;
    };
    if (taken(token)) {
      const widened =
        family !== '' && name !== family && !name.startsWith(`${family}-`)
          ? tokenName(`${family}-${name}`)
          : null;
      if (widened !== null && widened !== token && !taken(widened)) {
        diagnostics.push({
          code: 'renamed_token',
          message: `${path} is ${widened} in the kit: ${token} already names another value.`,
          ...place,
        });
        token = widened;
      }
    }
    if (!claims.has(token)) claims.set(token, { path, value: normalized });
    declare(
      declared,
      { name: token, value: value.value, targets: mode === null ? ['shared'] : [mode], place },
      diagnostics,
    );
    found += 1;
  };
  const collect = (
    value: ConfigValue,
    name: string,
    path: string,
    mode: Mode | null,
    family: string,
  ): void => {
    if (value.kind === 'object') {
      for (const entry of value.entries) {
        if (entry.key === null) {
          leaf(entry.value, name, path, mode, family);
          continue;
        }
        const key = entry.key;
        if (key === 'light' || key === 'dark') {
          if (entry.value.kind === 'object')
            collect(entry.value, name, `${path}.${key}`, key, family);
          else leaf(entry.value, name || key, `${path}.${key}`, key, family);
          continue;
        }
        if (key === 'value' || key === '$value' || key === 'DEFAULT') {
          if (entry.value.kind === 'object')
            collect(entry.value, name, `${path}.${key}`, mode, family);
          else leaf(entry.value, name || key, `${path}.${key}`, mode, family);
          continue;
        }
        if (MODULE_METADATA.has(key)) continue;
        collect(
          entry.value,
          name === '' ? key : `${name}-${key}`,
          `${path}.${key}`,
          mode,
          family === '' ? key : family,
        );
      }
      return;
    }
    if (value.kind === 'list') {
      if (value.items.length === 0) return;
      const records = value.items.flatMap((item) => {
        const recordName = tokenRecordName(item);
        return recordName === null ? [] : [{ item, name: recordName }];
      });
      // A record names its token itself; the path it sits under is no prefix,
      // only its family's fallback when the name is taken.
      if (records.length === value.items.length) {
        const section = name.replace(/(?:^|-)tokens$/, '') || family;
        for (const record of records)
          collect(record.item, record.name, `${path}.${record.name}`, mode, section);
        return;
      }
      const texts = value.items.flatMap((item) => (item.kind === 'text' ? [item.value] : []));
      // A family list and a layered shadow both join.
      if (texts.length === value.items.length) {
        leaf({ kind: 'text', value: texts.join(', '), line: value.line }, name, path, mode, family);
        return;
      }
      diagnostics.push({
        code: 'manual_interpretation_required',
        message: `${path} is a list of values the import cannot read. Set them with token changes instead.`,
        ...placeIn(origin, value.line),
      });
      return;
    }
    leaf(value, name, path, mode, family);
  };
  for (const binding of read.bindings) {
    const fragment = binding.name === null ? '' : (tokenName(binding.name)?.slice(2) ?? '');
    collect(
      binding.value,
      fragment,
      binding.name ?? 'the module',
      bindingMode(binding.name),
      fragment,
    );
  }
  if (found === 0 && diagnostics.length === diagnosed)
    diagnostics.push({
      code: 'no_tokens',
      message: 'That token module declares no literal token values.',
      ...fileOf(origin),
    });
  return null;
}

/** The token name of a `{ name, value }` record, or null for a list item that is none. */
function tokenRecordName(item: ConfigValue): string | null {
  if (item.kind !== 'object') return null;
  const name = item.entries.find((entry) => entry.key === 'name');
  const valued = item.entries.some(
    (entry) =>
      entry.key === 'value' ||
      entry.key === '$value' ||
      entry.key === 'light' ||
      entry.key === 'dark',
  );
  return valued && name?.value.kind === 'text' ? name.value.value : null;
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
  token: { name: string; value: string; targets: TokenScope[]; place: SourcePlace },
  diagnostics: CanvasDiagnostic[],
): void {
  const { name, targets, place } = token;
  // The last value a scope sees is the one it keeps, so its place is too.
  const places = declared.places.get(name) ?? {};
  for (const scope of targets) places[scope] = place;
  declared.places.set(name, places);
  declareToken(
    declared.scopes,
    { name, targets, ...place, value: token.value.replace(/\s+/g, ' ').trim() },
    diagnostics,
  );
}
