import { z } from 'zod';
import type { CanvasDiagnostic } from './protocol.js';
import { CANVAS_LIMITS } from './schema.js';

export const MAX_BUILD_DIAGNOSTICS = 64;
const MAX_DIAGNOSTIC_MESSAGE_LENGTH = 2048;

/** A diagnostic read back from outside this process: a cached outcome or a compiler reply. */
export const canvasDiagnosticSchema = z
  .object({
    code: z.string().min(1).max(64),
    message: z.string().min(1).max(MAX_DIAGNOSTIC_MESSAGE_LENGTH),
    // A design path, or one under `@droidex/design-system/`.
    file: z
      .string()
      .max(CANVAS_LIMITS.maxSourcePathLength + 64)
      .optional(),
    line: z.number().int().nonnegative().optional(),
    column: z.number().int().nonnegative().optional(),
  })
  .strict();

/** Keeps compiler replies, live frames and cached outcomes within the wire limits. */
export function boundDiagnostics(diagnostics: readonly CanvasDiagnostic[]): CanvasDiagnostic[] {
  return diagnostics.slice(0, MAX_BUILD_DIAGNOSTICS).map((diagnostic) => ({
    ...diagnostic,
    message: truncateDiagnosticText(diagnostic.message),
  }));
}

export function truncateDiagnosticText(
  text: string,
  maxLength = MAX_DIAGNOSTIC_MESSAGE_LENGTH,
): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

/** What designSystemAdherence.ts reports; a build report keeps these apart from errors. */
export const ADHERENCE_CODES = {
  color: 'design_system_color',
  font: 'design_system_font',
  type: 'design_system_type',
  radius: 'design_system_radius',
  spacing: 'design_system_spacing',
  shadow: 'design_system_shadow',
  unused: 'design_system_unused',
  override: 'design_system_override',
} as const;

const ADHERENCE_CODE_SET: ReadonlySet<string> = new Set(Object.values(ADHERENCE_CODES));

export function isAdherenceDiagnostic(diagnostic: CanvasDiagnostic): boolean {
  return ADHERENCE_CODE_SET.has(diagnostic.code);
}

/** What designCodeQuality.ts reports: advice on a frame that built, never an error. */
export const CODE_QUALITY_CODES = {
  unused: 'code_quality_unused',
  staticStyle: 'code_quality_static_style',
  rawValue: 'code_quality_raw_value',
  repeatedMarkup: 'code_quality_repeated_markup',
  size: 'code_quality_size',
} as const;

const CODE_QUALITY_CODE_SET: ReadonlySet<string> = new Set(Object.values(CODE_QUALITY_CODES));

export function isCodeQualityDiagnostic(diagnostic: CanvasDiagnostic): boolean {
  return CODE_QUALITY_CODE_SET.has(diagnostic.code);
}
