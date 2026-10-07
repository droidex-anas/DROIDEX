import type { CanvasError, CanvasErrorCode } from './protocol.js';
import type { FrameRect } from './schema.js';

/** What every expired turn lease answers, wherever it is checked (spec §8). */
export const EXPIRED_TURN = 'That request belongs to a turn that already ended.';

/**
 * The only failure Canvas storage and the workspace throw. The message reaches
 * the model and the user, so it names the recovery and never a filesystem path,
 * a stack trace or a payload (spec §8).
 */
export class CanvasCommandError extends Error implements CanvasError {
  constructor(
    readonly code: CanvasErrorCode,
    message: string,
    readonly currentRect?: FrameRect,
  ) {
    super(message);
    this.name = 'CanvasCommandError';
  }
}

export function canvasError(
  code: CanvasErrorCode,
  message: string,
  currentRect?: FrameRect,
): CanvasCommandError {
  return new CanvasCommandError(code, message, currentRect);
}

/** The cause goes to the sidecar log; the caller learns only what to retry. */
export function storageFailure(recovery: string, cause: unknown): CanvasCommandError {
  if (cause instanceof CanvasCommandError) return cause;
  console.error('Canvas storage failure:', cause);
  return new CanvasCommandError('storage_failed', recovery);
}
