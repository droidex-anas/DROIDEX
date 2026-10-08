import type { CanvasDiagnostic } from './protocol.js';

export const MAX_BUILD_DIAGNOSTICS = 64;
export const MAX_DIAGNOSTIC_MESSAGE_LENGTH = 2048;

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
