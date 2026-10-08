// What a build reports, and whether that report outlives the session. The codes
// Canvas raises outside the compiler live here with the recovery each one names,
// and so does the one rule about which of them the derived cache keeps: only an
// outcome that is a function of the source, because only that one would be
// reached again by a rebuild. An attempt's own failure is this attempt's alone.

import type { BuildResult } from './canvasBuildCache.js';
import {
  COMPILER_UNAVAILABLE,
  CompileCancelledError,
  CompileFailedError,
  CompilerUnavailableError,
  RUNTIME_UNAVAILABLE,
} from './compiler.js';
import type { CanvasDiagnostic } from './protocol.js';
import { CANVAS_LIMITS } from './schema.js';

const SOURCE_UNREADABLE = 'The saved source for this design could not be read.';
const BUILD_NOT_SAVED = 'The build could not be saved. Free some disk space and try again.';
const OVERDUE = `This design took longer than ${String(CANVAS_LIMITS.buildDeadlineMs / 1000)} seconds to build. Simplify it and try again.`;

/** What one build concluded, and whether the cache keeps it for a restart. */
export interface BuildOutcome {
  result: BuildResult;
  persists: boolean;
}

/** A build whose artifact document could not be written. This attempt's own. */
export function unsavedBuild(): BuildOutcome {
  return attemptFailed({ code: 'storage_failed', message: BUILD_NOT_SAVED });
}

/**
 * What a rejected compile tells the frame, or null when it tells it nothing: a
 * cancellation that is not overdue was superseded or cancelled, and whatever
 * replaced it is the state the frame already reports.
 */
export function buildFailure(error: unknown, overdue: boolean): BuildOutcome | null {
  if (overdue) return attemptFailed({ code: 'build_timeout', message: OVERDUE });
  // Only the compiler's own diagnostics are about the source, so only they are
  // worth keeping: a rebuild of this revision would reach them again.
  if (error instanceof CompileFailedError)
    return {
      result: { status: 'failed', diagnostics: error.diagnostics },
      persists: true,
    };
  // The client forks a fresh process on its next build, so a crash costs this
  // job and nothing else, on this slot or any other. A runtime the app staged
  // wrongly is the one case a restart cannot repair, and the compiler says
  // which it is rather than leaving its text to be read.
  if (error instanceof CompilerUnavailableError)
    return attemptFailed({
      code: 'compiler_unavailable',
      message: error.reason === 'damaged-runtime' ? RUNTIME_UNAVAILABLE : COMPILER_UNAVAILABLE,
    });
  if (error instanceof CompileCancelledError) return null;
  // Canonical source that could not be read is the only failure left here.
  console.error('A Canvas build failed:', error);
  return attemptFailed({ code: 'storage_failed', message: SOURCE_UNREADABLE });
}

/**
 * A failure of this attempt rather than of the design. The live frame reports
 * it, the cache never keeps it, and the next open leaves the frame `pending` so
 * the rebuild sweep tries again: restarting DROIDEX is the advice some of these
 * give, and a restart that still showed the failure would make it a lie.
 */
function attemptFailed(diagnostic: CanvasDiagnostic): BuildOutcome {
  return { result: { status: 'failed', diagnostics: [diagnostic] }, persists: false };
}
