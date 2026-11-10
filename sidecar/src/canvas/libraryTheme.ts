// What a shadcn/ui library's styling becomes in its kit: the Tailwind config's
// theme as the kit's project theme (KIT_THEME_FILE), each value reading the kit
// token its project token became, and the stylesheet's own rules without the
// directives and tokens the canvas already supplies. The config is read for
// its literals, never run.

import postcss from 'postcss';
import { readConfigTheme, type ConfigValue } from './configLiterals.js';
import { tokenValueSchema } from './designSystemDocument.js';
import { literalValue, placeIn, tokenName } from './designSystemSources.js';
import {
  THEME_NAMESPACES,
  themeKeySchema,
  type KitTheme,
  type ThemeNamespace,
} from './kitTailwindTheme.js';
import type { CanvasDiagnostic } from './protocol.js';

/** A project text and the project file it was read from. */
export interface LibraryFile {
  text: string;
  file: string;
}

const NAMESPACES: ReadonlySet<string> = new Set(THEME_NAMESPACES);
// A colour function around one token, as shadcn's `hsl(var(--primary) / 0.5)` (groups 1
// and 2), or any other reference to a token (group 3). A Tailwind arbitrary value spells
// its spaces `_`.
const TOKEN_CONSUMER =
  /\b(?:hsla?|rgba?|oklch|oklab|lab|lch)\([\s_]*var\([\s_]*(--[\w-]+)[\s_]*\)[\s_]*(?:\/[\s_]*(var\([^()]*\)|[^()\s_]+)[\s_]*)?\)|var\([\s_]*(--[\w-]+)/gi;
const TOKEN_REFERENCE = /var\(\s*(--[\w-]+)/g;
// Text before an offset that is still inside a Tailwind arbitrary value's brackets.
const IN_ARBITRARY_VALUE = /\[[^\s"'`\]]*$/;
// The canvas stylesheet already opens with Tailwind's layers, and a kit loads no other file.
const DROPPED_AT_RULES = new Set(['tailwind', 'import', 'config', 'plugin']);
const MAX_LISTED = 6;

/** The config's theme, as theme.extend reads it, over the kit's tokens; or why it cannot be read. */
export function libraryTheme(
  config: LibraryFile,
  kitNames: Readonly<Record<string, string>>,
  diagnostics: CanvasDiagnostic[],
): { theme: KitTheme } | { problem: string } {
  const read = readConfigTheme(config.text);
  if (read.status === 'tooDeep')
    return {
      problem: `${config.file} nests its theme deeper than the canvas reads. Flatten its theme to import the library.`,
    };
  const { theme } = read;
  if (theme?.kind !== 'object') {
    diagnostics.push({
      code: 'no_tokens',
      message: 'That config has no literal theme object, so the kit keeps the canvas theme.',
      file: config.file,
    });
    return { theme: {} };
  }
  const kitTheme: KitTheme = {};
  const skipped: string[] = [];
  const place = (line: number) => placeIn({ file: config.file, lineOffset: 0 }, line);
  const extend = theme.entries.find((entry) => entry.key === 'extend')?.value;
  if (extend?.kind === 'computed')
    diagnostics.push({
      code: 'manual_interpretation_required',
      message: "theme.extend is computed in the config, so the kit's theme leaves it out.",
      ...place(extend.line),
    });
  // `theme.extend` follows `theme`, so its value wins for the same key, as Tailwind merges them.
  for (const [scope, scopePath] of [
    [theme, 'theme'],
    [extend, 'theme.extend'],
  ] as const) {
    if (scope?.kind !== 'object') continue;
    for (const { key, value } of scope.entries) {
      if (key === null || key === 'extend') continue;
      if (!NAMESPACES.has(key)) {
        skipped.push(`${scopePath}.${key}`);
        continue;
      }
      const namespace = key as ThemeNamespace;
      flatten(value, '', `${scopePath}.${key}`, (themeKey, leaf, leafPath) => {
        const problem = setThemeValue(kitTheme, namespace, themeKey, leaf, kitNames);
        if (problem !== null)
          diagnostics.push({
            code: 'manual_interpretation_required',
            message: `${leafPath} ${problem}, so the kit's theme leaves it out.`,
            ...place(leaf.line),
          });
        // fontSize's `[size, { lineHeight }]` keeps its size; a family list was joined whole.
        else if (leaf.kind === 'list' && leaf.items.length > 1 && namespace !== 'fontFamily')
          diagnostics.push({
            code: 'manual_interpretation_required',
            message: `${leafPath} keeps only its first value: a kit's theme holds one value per key.`,
            ...place(leaf.line),
          });
      });
    }
  }
  if (skipped.length > 0)
    diagnostics.push({
      code: 'manual_interpretation_required',
      message: `The kit's theme does not read ${listed(skipped)}, so classes that use them do nothing.`,
      file: config.file,
    });
  return { theme: kitTheme };
}

/** Visits each value of a theme namespace by its Tailwind key: `primary.DEFAULT` is `primary`. */
function flatten(
  value: ConfigValue,
  key: string,
  valuePath: string,
  visit: (key: string, value: ConfigValue, path: string) => void,
): void {
  if (value.kind !== 'object') {
    visit(key, value, valuePath);
    return;
  }
  for (const entry of value.entries) {
    if (entry.key === null) {
      visit(key, entry.value, valuePath);
      continue;
    }
    let child = `${key}-${entry.key}`;
    if (key === '') child = entry.key;
    else if (entry.key === 'DEFAULT') child = key;
    flatten(entry.value, child, `${valuePath}.${entry.key}`, visit);
  }
}

/** Sets one theme value; answers why it cannot be set. */
function setThemeValue(
  kitTheme: KitTheme,
  namespace: ThemeNamespace,
  key: string,
  value: ConfigValue,
  kitNames: Readonly<Record<string, string>>,
): string | null {
  const literal = key === '' ? null : literalValue(value, namespace);
  if (literal === null) return 'is computed in the config';
  const kitValue = readsKitTokens(literal, kitNames);
  if (kitValue === null) return 'reads a token the stylesheet does not set';
  if (!themeKeySchema.safeParse(key).success || !tokenValueSchema.safeParse(kitValue).success)
    return 'is not a value a kit theme can hold';
  (kitTheme[namespace] ??= {})[key] = kitValue;
  return null;
}

/** The value with each project token read as the kit token it became; null when one is not in the kit. */
function readsKitTokens(value: string, kitNames: Readonly<Record<string, string>>): string | null {
  if ([...value.matchAll(TOKEN_REFERENCE)].some(([, name]) => kitName(name, kitNames) === null))
    return null;
  return withKitTokens(value, kitNames);
}

/**
 * The CSS or source text with each reference to a project token read as the
 * kit token it became. The kit token holds the whole colour, so a colour
 * function around one is dropped, and its alpha becomes a color-mix().
 */
export function withKitTokens(text: string, kitNames: Readonly<Record<string, string>>): string {
  return text.replace(
    TOKEN_CONSUMER,
    (
      consumer: string,
      wrapped: string | undefined,
      alpha: string | undefined,
      referenced: string | undefined,
      offset: number,
    ) => {
      const kitToken = kitName(wrapped ?? referenced ?? '', kitNames);
      if (kitToken === null) return consumer;
      if (referenced !== undefined) return `var(${kitToken}`;
      // Tailwind fills <alpha-value> in, and the kit's theme adds a colour's alpha itself.
      if (alpha === undefined || alpha === '<alpha-value>') return `var(${kitToken})`;
      const before = text.slice(Math.max(0, offset - 200), offset);
      const space = consumer.includes('_') || IN_ARBITRARY_VALUE.test(before) ? '_' : ' ';
      return `color-mix(in${space}srgb,${space}var(${kitToken})${space}${alphaPercentage(alpha, space)},${space}transparent)`;
    },
  );
}

function kitName(name: string, kitNames: Readonly<Record<string, string>>): string | null {
  const projectName = tokenName(name) ?? '';
  return Object.hasOwn(kitNames, projectName) ? kitNames[projectName] : null;
}

function alphaPercentage(alpha: string, space: string): string {
  if (alpha.endsWith('%')) return alpha;
  const fraction = Number(alpha);
  if (Number.isFinite(fraction)) return `${String(Math.round(fraction * 10_000) / 100)}%`;
  return `calc(${alpha}${space}*${space}100%)`;
}

/**
 * The stylesheet as the kit's own CSS: without Tailwind's directives, which
 * the canvas sheet opens with, without the custom properties that became kit
 * tokens, and without any rule they leave empty; the rest read the kit tokens.
 * A loading at-rule is left out and reported, as a kit loads no other file.
 */
export function libraryStylesheet(
  css: LibraryFile,
  kitNames: Readonly<Record<string, string>>,
  diagnostics: CanvasDiagnostic[],
): string {
  const root = postcss.parse(css.text, { from: undefined, map: false });
  root.walkAtRules((rule) => {
    if (!DROPPED_AT_RULES.has(rule.name)) return;
    if (rule.name !== 'tailwind')
      diagnostics.push({
        code: 'manual_interpretation_required',
        message: `@${rule.name} ${rule.params} was left out of the kit's CSS: a kit loads no other file.`,
        ...placeIn({ file: css.file, lineOffset: 0 }, rule.source?.start?.line ?? 1),
      });
    rule.remove();
  });
  root.walkDecls((declaration) => {
    if (Object.hasOwn(kitNames, tokenName(declaration.prop) ?? '') && declaration.variable)
      declaration.remove();
    else declaration.value = withKitTokens(declaration.value, kitNames);
  });
  root.walkAtRules('apply', (rule) => {
    rule.params = withKitTokens(rule.params, kitNames);
  });
  for (let removed = true; removed; ) {
    removed = false;
    root.walk((node) => {
      if ((node.type === 'rule' || node.type === 'atrule') && node.nodes?.length === 0) {
        node.remove();
        removed = true;
      }
    });
  }
  const text = root.toString().trim();
  return text === '' ? '' : `${text}\n`;
}

function listed(names: readonly string[]): string {
  const shown = names.slice(0, MAX_LISTED).join(', ');
  return names.length > MAX_LISTED
    ? `${shown} and ${String(names.length - MAX_LISTED)} more`
    : shown;
}
