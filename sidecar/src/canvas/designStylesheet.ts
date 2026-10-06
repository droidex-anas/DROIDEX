// The one stylesheet a compiled design gets: Tailwind 3's preflight and the
// utilities its source actually mentions, the pinned kit's mode tokens and CSS,
// and the design's own CSS files. Tailwind scans the source as text, so nothing
// here executes generated source either (spec §6).

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
  const segments: Segment[] = [];
  let sheet = PREAMBLE;
  const append = (file: string, css: string): void => {
    segments.push({ file, firstLine: countLines(sheet) });
    sheet += css.endsWith('\n') ? css : `${css}\n`;
  };

  append(TOKENS_FILE, modeTokens(system));
  for (const [path, css] of cssFiles(system.files)) append(`${KIT_SPECIFIER}/${path}`, css);
  for (const [path, css] of cssFiles(files)) append(path, css);
  sheet += UTILITIES;

  try {
    const processed = await postcss([tailwindcss(tailwindConfig(files, system))]).process(sheet, {
      from: undefined,
    });
    return { ok: true, css: processed.css };
  } catch (error) {
    return { ok: false, diagnostics: [cssDiagnostic(error, segments)] };
  }
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
