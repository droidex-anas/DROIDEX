// How a canvas holds its designs to their kit (the summary's
// `designSystemAdherence`): the rules the board and the chat column offer, and
// what a frame's build says under them. The sidecar applies the rule; a frame
// only ever shows what its own build carried.

import type { CanvasBuildState, CanvasDiagnostic, DesignSystemAdherence } from './protocol';

export const DESIGN_SYSTEM_RULES: readonly {
  rule: DesignSystemAdherence;
  label: string;
  note: string;
}[] = [
  { rule: 'off', label: 'Off', note: 'No checks' },
  { rule: 'guide', label: 'Guide', note: 'Notes on the frame when a design strays from the kit' },
  { rule: 'strict', label: 'Strict', note: 'A design that strays from the kit does not build' },
];

/** Every code sidecar/src/canvas/canvasDiagnostics.ts lists in ADHERENCE_CODES starts with it. */
const ADHERENCE_CODE_PREFIX = 'design_system_';

/** How many findings the frame's tooltip names before counting the rest. */
const NAMED_NOTES = 3;

export function isAdherenceDiagnostic(diagnostic: CanvasDiagnostic): boolean {
  return diagnostic.code.startsWith(ADHERENCE_CODE_PREFIX);
}

/**
 * The kit findings a frame shows as notes: only a ready build's. An Off build
 * carries none, a failed one shows its failure instead, and one still queued or
 * building has no findings yet.
 */
export function kitNotes(build: CanvasBuildState): readonly CanvasDiagnostic[] {
  return build.status === 'ready' ? build.diagnostics.filter(isAdherenceDiagnostic) : [];
}

/** Only the strict rule fails a build on kit findings. */
export function blockedByStrictRule(diagnostics: readonly CanvasDiagnostic[]): boolean {
  return diagnostics.some(isAdherenceDiagnostic);
}

export function kitNotesLabel(notes: readonly CanvasDiagnostic[]): string {
  return notes.length === 1 ? '1 kit note' : `${String(notes.length)} kit notes`;
}

/** The first few findings, one per line, and how many more there are. */
export function kitNotesSummary(notes: readonly CanvasDiagnostic[]): string {
  const named = notes.slice(0, NAMED_NOTES).map((note) => note.message);
  const more = notes.length - named.length;
  return [...named, ...(more > 0 ? [`+${String(more)} more`] : [])].join('\n');
}
