// A user kit from a pasted DESIGN.md, CSS variables or a Tailwind config (spec
// §10). Names the shared primitives know are mapped onto their `--ds-*` tokens;
// every other token is kept under its own name and read back as unmapped, and a
// declaration that cannot become a token is reported, never dropped quietly.

import valueParser from 'postcss-value-parser';
import {
  designSystemSchema,
  DESIGN_SYSTEM_LIMITS,
  tokenValueSchema,
  type DesignSystem,
} from './designSystems.js';
import { DROIDEX_DESIGN_SYSTEM } from './presets/droidex.js';
import { UNIVERSAL_GUIDANCE } from './presets/starter.js';
import {
  fencedBlocks,
  looksLikeConfig,
  nestingDepth,
  readCss,
  readTailwind,
  tokenName,
  type Declared,
  type Mode,
} from './designSystemSources.js';
import type { CanvasDiagnostic, DesignSystemSource } from './protocol.js';

export type ImportDesignSystemResult =
  | { status: 'imported'; system: DesignSystem; diagnostics: CanvasDiagnostic[] }
  | { status: 'refused'; diagnostics: CanvasDiagnostic[] };

/** The tokens Button, Input, Card, Badge, Tabs and Dialog read, with DROIDEX's values. */
const CONTRACT = DROIDEX_DESIGN_SYSTEM.modes;
const MODES: readonly Mode[] = ['light', 'dark'];
const MAX_DIAGNOSTICS = 64;
// Messages can quote pasted names; the renderer drops a reply with an overlong one.
const MAX_MESSAGE_LENGTH = 300;
const UNDEFINED_REFERENCE = 'It refers to a token this source does not define.';
const UNUSABLE_REFERENCE = 'It refers to a token that was not imported.';
// Fallbacks nest inside `var()`, and resolving recurses once per level.
const MAX_VALUE_NESTING = 16;

const color = (...names: string[]) => names.flatMap((name) => [name, `color-${name}`]);
// Common names for each contract token, in priority order. A source name maps
// at most once, so shadcn's subtle `accent` stays unmapped beside `primary`.
const ALIASES: Record<string, string[]> = {
  '--ds-canvas': color('background', 'bg', 'canvas'),
  '--ds-surface': color('surface', 'card'),
  '--ds-raised': color('raised', 'popover'),
  '--ds-elevated': color('elevated', 'muted', 'secondary'),
  '--ds-active': color('active'),
  '--ds-fg': color('foreground', 'fg', 'text'),
  '--ds-fg-muted': color('muted-foreground', 'fg-muted', 'text-muted'),
  '--ds-border': color('border'),
  '--ds-accent': color('primary', 'brand', 'accent'),
  '--ds-accent-fg': color('primary-foreground', 'on-primary', 'accent-foreground'),
  '--ds-accent-soft': color('accent-soft', 'primary-soft'),
  '--ds-focus': color('ring', 'focus'),
  '--ds-positive': color('success', 'positive'),
  '--ds-danger': color('destructive', 'danger', 'error'),
  '--ds-backdrop': color('backdrop', 'overlay'),
  '--ds-font-sans': ['font-sans', 'font-body'],
  '--ds-font-heading': ['font-heading', 'font-display', 'font-serif'],
  '--ds-font-mono': ['font-mono'],
  '--ds-radius-sm': ['radius-sm'],
  '--ds-radius-md': ['radius', 'radius-md'],
  '--ds-radius-lg': ['radius-lg'],
  '--ds-radius-pill': ['radius-full', 'radius-pill'],
  '--ds-shadow-sm': ['shadow-sm'],
  '--ds-shadow-md': ['shadow', 'shadow-md'],
  ...Object.fromEntries(
    ['xs', 'sm', 'base', 'lg', 'xl'].map((size) => [`--ds-text-${size}`, [`text-${size}`]]),
  ),
  ...Object.fromEntries(
    ['1', '2', '3', '4', '6'].map((step) => [
      `--ds-space-${step}`,
      [`spacing-${step}`, `space-${step}`],
    ]),
  ),
};

/** Kit tokens outside the shared primitive contract; presets have none. */
export function unmappedKitTokens(system: Pick<DesignSystem, 'modes'>): string[] {
  return Object.keys(system.modes.light)
    .filter((name) => !Object.hasOwn(CONTRACT.light, name))
    .sort();
}

/** A complete version-1 kit, or why none can be made. The same input always yields the same kit. */
export function importDesignSystem(
  source: DesignSystemSource,
  kit: { id: string; name: string },
): ImportDesignSystemResult {
  const diagnostics: CanvasDiagnostic[] = [];
  const declared: Declared = { scopes: { shared: {}, light: {}, dark: {} }, lines: new Map() };
  const read =
    source.kind === 'designMd'
      ? readDesignMd(source.text, declared, diagnostics)
      : readTokenSource(source.text, declared, diagnostics);
  if (read.status === 'refused') return read;
  const unreadable = tokenRefusal(declared, diagnostics);
  if (unreadable) return unreadable;

  const parsed = designSystemSchema.safeParse({
    id: kit.id,
    version: 1,
    name: kit.name,
    modes: mapOntoContract(declared, diagnostics),
    files: DROIDEX_DESIGN_SYSTEM.files,
    guidance: read.guidance,
    examples: DROIDEX_DESIGN_SYSTEM.examples,
  });
  if (!parsed.success)
    return refused(parsed.error.issues[0]?.message ?? 'That design system is not valid.');
  return { status: 'imported', system: parsed.data, diagnostics: bounded(diagnostics) };
}

type SourceRead = { status: 'read'; guidance: string } | Refused;

// Competing values are refused, as extraction refuses them: neither is the
// kit's. Bounding the token count also bounds how deep a reference chain runs.
function tokenRefusal(declared: Declared, diagnostics: CanvasDiagnostic[]): Refused | null {
  const competing = diagnostics.find((entry) => entry.code === 'ambiguous_token');
  if (competing) return failed([competing, ...diagnostics.filter((entry) => entry !== competing)]);
  const { maxTokensPerMode } = DESIGN_SYSTEM_LIMITS;
  if (declared.lines.size <= maxTokensPerMode) return null;
  return refused(
    `That source declares ${String(declared.lines.size)} tokens; a kit holds at most ${String(maxTokensPerMode)} in each mode.`,
  );
}

/** The whole text becomes guidance beside the primitive notes; its css and config blocks set tokens. */
function readDesignMd(
  text: string,
  declared: Declared,
  diagnostics: CanvasDiagnostic[],
): SourceRead {
  if (text.trim() === '') return refused('Write or paste a DESIGN.md first.');
  const guidance = `${UNIVERSAL_GUIDANCE}\n${text.trim()}\n`;
  if (Buffer.byteLength(guidance) > DESIGN_SYSTEM_LIMITS.maxGuidanceBytes) {
    const allowance = DESIGN_SYSTEM_LIMITS.maxGuidanceBytes - Buffer.byteLength(UNIVERSAL_GUIDANCE);
    return refused(
      `A DESIGN.md holds at most ${String(Math.floor(allowance / 1024))} KiB beside the primitive notes. Shorten it; it is never truncated.`,
    );
  }
  for (const block of fencedBlocks(text)) {
    let failure: CanvasDiagnostic | null = null;
    if (block.language === 'css') failure = readCss(block.text, block.line, declared, diagnostics);
    else if (/\btheme\s*:/.test(block.text))
      failure = readTailwind(block.text, block.line, declared, diagnostics);
    if (failure) return failed([failure, ...diagnostics]);
  }
  if (declared.lines.size === 0)
    diagnostics.push({
      code: 'no_tokens',
      message:
        'This DESIGN.md has no css or Tailwind config block, so the kit keeps DROIDEX tokens.',
    });
  return { status: 'read', guidance };
}

/** Pasted CSS variables or a Tailwind config: tokens only, so the kit keeps the primitive notes alone. */
function readTokenSource(
  text: string,
  declared: Declared,
  diagnostics: CanvasDiagnostic[],
): SourceRead {
  if (text.trim() === '') return refused('Paste CSS variables or a Tailwind config first.');
  const failure = looksLikeConfig(text)
    ? readTailwind(text, 0, declared, diagnostics)
    : readCss(text, 0, declared, diagnostics);
  if (failure) return failed([failure, ...diagnostics]);
  if (declared.lines.size === 0)
    return refused(
      diagnostics.length > 0
        ? `No tokens could be imported. ${diagnostics[0].message}`
        : 'No CSS custom properties or Tailwind theme values were found.',
      diagnostics,
    );
  return { status: 'read', guidance: UNIVERSAL_GUIDANCE };
}

type Refused = Extract<ImportDesignSystemResult, { status: 'refused' }>;

function refused(message: string, earlier: CanvasDiagnostic[] = []): Refused {
  return failed([{ code: 'invalid_input', message }, ...earlier]);
}

function failed(diagnostics: CanvasDiagnostic[]): Refused {
  return { status: 'refused', diagnostics: bounded(diagnostics) };
}

function bounded(diagnostics: CanvasDiagnostic[]): CanvasDiagnostic[] {
  return diagnostics
    .slice(0, MAX_DIAGNOSTICS)
    .map((diagnostic) =>
      diagnostic.message.length <= MAX_MESSAGE_LENGTH
        ? diagnostic
        : { ...diagnostic, message: `${diagnostic.message.slice(0, MAX_MESSAGE_LENGTH)}…` },
    );
}

function mapOntoContract(
  declared: Declared,
  diagnostics: CanvasDiagnostic[],
): Record<Mode, Record<string, string>> {
  const resolved = resolveValues(declared, diagnostics);
  const modes = { light: { ...CONTRACT.light }, dark: { ...CONTRACT.dark } };
  const claimed = new Set<string>();
  const assign = (contractName: string, sourceName: string): void => {
    claimed.add(sourceName);
    for (const mode of MODES) {
      const value = resolved[mode].get(sourceName);
      if (value !== undefined) modes[mode][contractName] = value;
    }
  };
  // A token whose value could not be used was already reported and maps nowhere.
  const usable = (name: string) => resolved.light.has(name) || resolved.dark.has(name);
  for (const name of Object.keys(CONTRACT.light)) if (usable(name)) assign(name, name);
  for (const [contractName, aliases] of Object.entries(ALIASES)) {
    if (claimed.has(contractName)) continue;
    const alias = aliases.find(
      (candidate) => usable(`--${candidate}`) && !claimed.has(`--${candidate}`),
    );
    if (alias) assign(contractName, `--${alias}`);
  }

  for (const [name, line] of declared.lines) {
    if (claimed.has(name)) continue;
    const light = resolved.light.get(name);
    const dark = resolved.dark.get(name);
    const either = light ?? dark;
    if (either === undefined) continue;
    if (light === undefined || dark === undefined)
      diagnostics.push({
        code: 'single_mode_token',
        message: `${name} has only a ${light === undefined ? 'dark' : 'light'} value; both modes use it.`,
        line,
      });
    modes.light[name] = light ?? either;
    modes.dark[name] = dark ?? either;
  }
  return modes;
}

type Resolution = { value: string } | { problem: string };

/** Each token's final light and dark values; a token whose value cannot be used is reported once. */
function resolveValues(
  declared: Declared,
  diagnostics: CanvasDiagnostic[],
): Record<Mode, Map<string, string>> {
  const resolved = { light: new Map<string, string>(), dark: new Map<string, string>() };
  const problems = new Map<string, string>();
  for (const mode of MODES) {
    // One resolution per token keeps fanned-out references linear, and a token
    // still being resolved when it is reached again is a cycle.
    const resolutions = new Map<string, Resolution>();
    const resolve = (name: string): Resolution | undefined => {
      const known = resolutions.get(name);
      if (known) return known;
      const raw = scopedValue(declared, name, mode);
      if (raw === undefined) return undefined;
      resolutions.set(name, { problem: UNUSABLE_REFERENCE });
      const resolution = usableValue(raw, resolve);
      resolutions.set(name, resolution);
      return resolution;
    };
    for (const name of declared.lines.keys()) {
      const resolution = resolve(name);
      if (resolution === undefined) continue;
      if ('value' in resolution) resolved[mode].set(name, resolution.value);
      else if (!problems.has(name)) problems.set(name, resolution.problem);
    }
  }
  for (const [name, line] of declared.lines) {
    const problem = problems.get(name);
    if (problem !== undefined)
      diagnostics.push({
        code: 'unusable_value',
        message: `${name} was not imported. ${problem}`,
        line,
      });
  }
  return resolved;
}

function scopedValue(declared: Declared, name: string, mode: Mode): string | undefined {
  const { scopes } = declared;
  if (Object.hasOwn(scopes[mode], name)) return scopes[mode][name];
  return Object.hasOwn(scopes.shared, name) ? scopes.shared[name] : undefined;
}

function usableValue(raw: string, resolve: (name: string) => Resolution | undefined): Resolution {
  if (nestingDepth(raw, '(', ')') > MAX_VALUE_NESTING)
    return { problem: 'It nests functions too deeply.' };
  const inlined = inlineReferences(raw, resolve);
  if ('problem' in inlined) return inlined;
  const value = bareHsl(inlined.value);
  const checked = tokenValueSchema.safeParse(value);
  if (!checked.success)
    return { problem: checked.error.issues[0]?.message ?? 'That is not a token value.' };
  if (/\burl\(|image-set\(/i.test(value)) return { problem: 'A kit token cannot load a resource.' };
  return { value };
}

/** Inlines `var()` references, so a value still holds after its tokens are renamed. */
function inlineReferences(
  value: string,
  resolve: (name: string) => Resolution | undefined,
): Resolution {
  if (!value.includes('var(')) return { value };
  const replacements: { start: number; end: number; text: string }[] = [];
  const problems: string[] = [];
  valueParser(value).walk((node) => {
    if (node.type !== 'function' || node.value.toLowerCase() !== 'var') return;
    const first = node.nodes.at(0);
    const name = first?.type === 'word' ? first.value : '';
    const comma = node.nodes.findIndex((part) => part.type === 'div' && part.value === ',');
    const fallback =
      comma < 0 ? undefined : valueParser.stringify(node.nodes.slice(comma + 1)).trim();
    let resolution = resolve(tokenName(name) ?? '');
    if (resolution === undefined && fallback !== undefined)
      resolution = inlineReferences(fallback, resolve);
    // A contract token the source never set is still in the kit.
    if (resolution === undefined && Object.hasOwn(CONTRACT.light, name))
      resolution = { value: `var(${name})` };
    if (resolution === undefined) problems.push(UNDEFINED_REFERENCE);
    else if ('problem' in resolution) problems.push(UNUSABLE_REFERENCE);
    else
      replacements.push({
        start: node.sourceIndex,
        end: node.sourceEndIndex,
        text: resolution.value,
      });
    return false;
  });
  if (problems.length > 0) return { problem: problems[0] };
  let result = value;
  for (const { start, end, text } of replacements.reverse())
    result = result.slice(0, start) + text + result.slice(end);
  return { value: result };
}

// shadcn's `--primary: 222 47% 11%` is a colour only inside `hsl()`.
function bareHsl(value: string): string {
  return /^-?[\d.]+(?:deg)?\s+[\d.]+%\s+[\d.]+%(?:\s*\/\s*[\d.]+%?)?$/.test(value)
    ? `hsl(${value})`
    : value;
}
