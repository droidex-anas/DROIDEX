import type { CanvasEvent } from './canvas/protocol.js';
import type { ClientCommand } from './protocol.js';

export interface SidecarShutdownStages {
  closeCanvasAdmission: () => void;
  shutdownSessions: () => Promise<void>;
  shutdownAutomations: () => Promise<void>;
  shutdownCanvas: () => Promise<void>;
  disableMetrics: () => void;
  closeBridge: () => Promise<void>;
}

/** Attempts every owned cleanup stage and reports the first failure afterward. */
export async function shutdownSidecar(stages: SidecarShutdownStages): Promise<void> {
  let firstError: Error | undefined;
  const attempt = async (cleanup: () => void | Promise<void>): Promise<void> => {
    try {
      await cleanup();
    } catch (error) {
      firstError ??= error instanceof Error ? error : new Error(String(error));
    }
  };

  const admission = attempt(stages.closeCanvasAdmission);
  const sessions = attempt(stages.shutdownSessions);
  const canvas = attempt(stages.shutdownCanvas);
  await admission;
  await sessions;
  await attempt(stages.shutdownAutomations);
  await canvas;
  await attempt(stages.disableMetrics);
  await attempt(stages.closeBridge);

  if (firstError) throw firstError;
}

/** Canvas dispatch precedes the session manager's own shutdown admission guard. */
export function canvasShutdownReply(
  command: ClientCommand,
  admission: AbortSignal,
): CanvasEvent | null {
  if (
    !admission.aborted ||
    !command.type.startsWith('canvas.') ||
    !('requestId' in command) ||
    command.requestId === undefined
  )
    return null;
  return {
    type: 'canvas.result',
    requestId: command.requestId,
    ok: false,
    error: { code: 'scope_expired', message: 'DROIDEX is shutting down.' },
  };
}
