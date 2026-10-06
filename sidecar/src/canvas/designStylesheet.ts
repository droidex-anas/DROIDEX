// The one stylesheet a compiled design gets: Tailwind 3's preflight and the
// utilities its source actually mentions, the pinned kit's mode tokens and CSS,
// and the design's own CSS files.
//
// CSS is untrusted input that reaches a code loader. Tailwind resolves
// `@config` against the stylesheet's own file location and then requires that
// file, and PostCSS adopts a file location from an inline source map, so a
// design could name a module on disk and have the sidecar execute it. Every
// loading at-rule is refused here before PostCSS parses for real, source maps
// are off so no file location can be adopted, and the Tailwind configuration is
// passed inline so nothing is ever looked up from disk (spec §6).

import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import type { Config } from 'tailwindcss';
import type { DesignSystem } from './designSystems.js';
import type { CanvasDiagnostic } from './protocol.js';
import type { SourceFiles } from './schema.js';
import { KIT_SPECIFIER } from './designBundle.js';

export type DesignStylesheetResult =
  | { ok: true; css: string }
  | { ok: false; diagnostics: CanvasDiagnostic[] };

/** Where one line of the concatenated sheet came from, for CSS diagnostics. */
interface Segment {
  file: string;
  firstLine: number;
}

const PREAMBLE = '@tailwind base;\n@tailwind components;\n';
// Utilities come last so a utility class wins over the kit's own rules.
const UTILITIES = '@tailwind utilities;\n';

export async function buildDesignStylesheet(
  files: SourceFiles,
  system: DesignSystem,
): Promise<DesignStylesheetResult> {
  const sources: [string, string][] = [
    [TOKENS_FILE, modeTokens(system)],
    ...cssFiles(system.files).map(([path, css]): [string, string] => [
      `${KIT_SPECIFIER}/${path}`,
      css,
    ]),
    ...cssFiles(files),
  ];

  const refusals = sources.flatMap(([file, css]) => reviewCss(file, css));
  if (refusals.length > 0) return { ok: false, diagnostics: refusals };

  const segments: Segment[] = [];
  let sheet = PREAMBLE;
  for (const [file, css] of sources) {
    segments.push({ file, firstLine: countLines(sheet) });
    sheet += css.endsWith('\n') ? css : `${css}\n`;
  }
  sheet += UTILITIES;

  try {
    const processed = await postcss([tailwindcss(tailwindConfig(files, system))]).process(sheet, {
      from: undefined,
      map: false,
    });
    return { ok: true, css: processed.css };
  } catch (error) {
    return { ok: false, diagnostics: [cssDiagnostic(error, segments)] };
  }
}

// Every at-rule that can make PostCSS or Tailwind read a second file. A design's
// stylesheets are already concatenated into one sheet, so none of them has
// anything legitimate to reach for.
const LOADING_AT_RULES = new Set(['config', 'plugin', 'import', 'use', 'forward']);

// A preview loads with no network, so a remote asset would silently fail and a
// remote font would report the preview's existence. Inline data is all a design
// can carry until Task 7 adds owned image references.
const EXTERNAL_RESOURCE = /\b(?:url|image-set|-webkit-image-set)\(\s*(['"]?)(?!data:)([^'")]*)\1/i;

/** What one stylesheet may not contain, checked before it joins the sheet. */
function reviewCss(file: string, css: string): CanvasDiagnostic[] {
  let root;
  try {
    // Parsed with source maps off, so this file cannot name a location that a
    // later at-rule or plugin would resolve against.
    root = postcss.parse(css, { from: undefined, map: false });
  } catch (error) {
    return [cssDiagnostic(error, [{ file, firstLine: 1 }])];
  }

  const refusals: CanvasDiagnostic[] = [];
  const refuse = (message: string, line: number | undefined): void => {
    refusals.push({ code: 'css_error', message, ...(line === undefined ? {} : { file, line }) });
  };
  root.walkAtRules((rule) => {
    if (!LOADING_AT_RULES.has(rule.name.toLowerCase())) return;
    refuse(
      `@${rule.name} is not available in a design. Put the CSS in a stylesheet of its own; every .css file in the design is already included.`,
      rule.source?.start?.line,
    );
  });
  root.walkDecls((declaration) => {
    if (!EXTERNAL_RESOURCE.test(declaration.value)) return;
    refuse(
      `"${declaration.prop}" refers to a resource outside the design. A preview loads with no network, so only inline data: values render.`,
      declaration.source?.start?.line,
    );
  });
  return refusals;
}

// A synthetic name for the token block, so a diagnostic in it is attributable
// without naming a file the author could edit.
const TOKENS_FILE = `${KIT_SPECIFIER}/tokens`;

const CSS_RECOVERY = 'The design stylesheet could not be compiled.';

/**
 * Both modes are emitted, and `data-mode` on the document picks one. Switching
 * mode is then an attribute change rather than a rebuild.
 */
function modeTokens(system: DesignSystem): string {
  return (['light', 'dark'] as const)
    .map((mode) => {
      const declarations = Object.entries(system.modes[mode])
        .map(([name, value]) => `  ${name}: ${value};`)
        .join('\n');
      return `[data-mode='${mode}'] {\n${declarations}\n}`;
    })
    .join('\n');
}

function tailwindConfig(files: SourceFiles, system: DesignSystem): Config {
  return {
    // Every design and kit file is scanned, so a class only appears when some
    // source literally spells it out; no partial class names are guessed.
    content: [...rawSources(system.files), ...rawSources(files)],
    // The kit's dark values live under the same attribute the document carries.
    darkMode: ['selector', "[data-mode='dark']"],
    theme: {},
    plugins: [],
  };
}

function rawSources(files: SourceFiles): { raw: string; extension: string }[] {
  return Object.entries(files).map(([path, content]) => ({
    raw: content,
    extension: path.slice(path.lastIndexOf('.') + 1),
  }));
}

function cssFiles(files: SourceFiles): [string, string][] {
  return Object.entries(files)
    .filter(([path]) => path.endsWith('.css'))
    .sort(([left], [right]) => left.localeCompare(right));
}

function countLines(text: string): number {
  let lines = 1;
  for (const character of text) if (character === '\n') lines += 1;
  return lines;
}

/**
 * PostCSS reports a line in the concatenated sheet; the owning segment turns it
 * back into a file and a line inside that file.
 */
function cssDiagnostic(error: unknown, segments: readonly Segment[]): CanvasDiagnostic {
  if (!isCssSyntaxError(error)) {
    console.error('Canvas stylesheet failure:', error);
    return { code: 'css_error', message: CSS_RECOVERY };
  }
  const diagnostic: CanvasDiagnostic = { code: 'css_error', message: error.reason };
  const line = error.line;
  if (line === undefined) return diagnostic;
  const segment = [...segments].reverse().find((candidate) => candidate.firstLine <= line);
  if (!segment) return diagnostic;
  return {
    ...diagnostic,
    file: segment.file,
    line: line - segment.firstLine + 1,
    ...(error.column === undefined ? {} : { column: error.column }),
  };
}

interface CssSyntaxError {
  reason: string;
  line?: number;
  column?: number;
}

function isCssSyntaxError(error: unknown): error is CssSyntaxError {
  return (
    error instanceof Error &&
    error.name === 'CssSyntaxError' &&
    'reason' in error &&
    typeof error.reason === 'string'
  );
}
