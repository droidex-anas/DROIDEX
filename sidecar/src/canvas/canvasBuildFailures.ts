// What a build that produced no usable artifact tells the frame. These are the
// only diagnostics Canvas raises outside the compiler, so their codes and the
// recovery each one names live together here.

import { MAX_BUILD_DIAGNOSTICS } from './canvasBuildCache.js';
import { CompileCancelledError, CompileFailedError, CompilerUnavailableError } from './compiler.js';
import type { CanvasDiagnostic } from './protocol.js';
import { CANVAS_LIMITS } from './schema.js';

const COMPILER_UNAVAILABLE = 'The Canvas compiler is unavailable; restart DROIDEX.';
const SOURCE_UNREADABLE = 'The saved source for this design could not be read.';
const BUILD_NOT_SAVED = 'The build could not be saved. Free some disk space and try again.';
const OVERDUE = `This design took longer than ${String(CANVAS_LIMITS.buildDeadlineMs / 1000)} seconds to build. Simplify it and try again.`;

/** What a build whose artifact document could not be written reports. */
export function unsavedBuild(): CanvasDiagnostic[] {
  return [{ code: 'storage_failed', message: BUILD_NOT_SAVED }];
}

/**
 * What a rejected compile tells the frame, or null when it tells it nothing: a
 * cancellation that is not overdue was superseded or cancelled, and whatever
 * replaced it is the state the frame already reports.
 */
export function buildFailure(error: unknown, overdue: boolean): CanvasDiagnostic[] | null {
  if (overdue) return [{ code: 'build_timeout', message: OVERDUE }];
  if (error instanceof CompileFailedError) return error.diagnostics.slice(0, MAX_BUILD_DIAGNOSTICS);
  // The client forks a fresh process on its next build, so a crash costs this
  // job and nothing else, on this slot or any other.
  if (error instanceof CompilerUnavailableError)
    return [{ code: 'compiler_unavailable', message: COMPILER_UNAVAILABLE }];
  if (error instanceof CompileCancelledError) return null;
  // Canonical source that could not be read is the only failure left here.
  console.error('A Canvas build failed:', error);
  return [{ code: 'storage_failed', message: SOURCE_UNREADABLE }];
}
