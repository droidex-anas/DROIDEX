// Explicit pane creation and attachment for existing chats retain their mutation
// ID and target across retries. New chats commit through session.create instead.

import { canvasMessage, type CanvasClient } from './client';
import type { CanvasSummary } from './protocol';

/** Shown while a create's reply is missing: the canvas may well exist. */
const UNCONFIRMED_CREATE = 'Canvas creation may still be in progress.';
/** The same for an attach, which can only have moved this chat. */
const UNCONFIRMED_ATTACH = 'Opening that canvas may still be in progress.';

/** The attachment one chat still owes, until its result is acknowledged. */
interface OwedAttachment {
  /** Null mints a canvas; otherwise the chat joins that one. */
  canvasId: string | null;
  /** The provisional name a minted canvas takes from the prompt (spec §4). */
  name: string | null;
  /** Retained across every replay, so the sidecar commits it at most once. */
  mutationId: string;
  /** The one request in flight; concurrent callers join it. */
  running: Promise<string | null> | null;
  /** The canvas it produced, held until a caller acknowledges the result. */
  settled: { canvasId: string | null } | null;
  /** Why the last attempt did not finish, for the pane's recovery. */
  message: string;
}

const owed = new Map<string, OwedAttachment>();

/**
 * Gives `appSessionId` the canvas it is owed and resolves with that canvas.
 * The first call for a chat records the operation; every later one replays
 * exactly that operation, so a timeout, a lost reply, a remount or an explicit
 * retry can neither retarget it nor mint a second canvas. `chooseCanvasForChat`
 * is how the user replaces it.
 */
export function attachCanvasToChat(
  client: CanvasClient,
  appSessionId: string,
  intent: { canvasId: string | null; name?: string | null },
): Promise<string | null> {
  const existing = owed.get(appSessionId);
  if (existing) {
    if (existing.settled !== null) return Promise.resolve(existing.settled.canvasId);
    if (existing.running) return existing.running;
  }
  const operation: OwedAttachment = existing ?? {
    canvasId: intent.canvasId,
    name: intent.name ?? null,
    mutationId: crypto.randomUUID(),
    running: null,
    settled: null,
    message: intent.canvasId === null ? UNCONFIRMED_CREATE : UNCONFIRMED_ATTACH,
  };
  owed.set(appSessionId, operation);
  const running = commit(client, appSessionId, operation).then(
    (canvasId) => {
      operation.running = null;
      operation.settled = { canvasId };
      return canvasId;
    },
    (error: unknown) => {
      operation.running = null;
      operation.message = canvasMessage(error);
      throw error;
    },
  );
  operation.running = running;
  return running;
}

async function commit(
  client: CanvasClient,
  appSessionId: string,
  operation: OwedAttachment,
): Promise<string | null> {
  const { canvasId } = operation;
  if (canvasId !== null) {
    await client.attachCanvas(appSessionId, canvasId);
    return canvasId;
  }
  const receipt = await client.createCanvas(appSessionId, operation.mutationId, operation.name);
  // A retried Create may outlive a move or detach; only the current attachment reaches the UI.
  return receipt.attachedCanvasId;
}

/**
 * The attachment this chat still owes, for the pane that offers the recovery:
 * the canvas it was aiming at, and why it has not landed. Null once the result
 * has been acknowledged.
 */
export function owedAttachment(
  appSessionId: string,
): { canvasId: string | null; message: string } | null {
  const operation = owed.get(appSessionId);
  // A settled operation is only waiting to be acknowledged, and an absent one
  // owes nothing: `undefined !== null` covers both.
  if (operation?.settled !== null) return null;
  return { canvasId: operation.canvasId, message: operation.message };
}

/**
 * Forgets the operation once its result has reached the store. Until then it is
 * retained, so a pane or bootstrap that mounts in between replays the same
 * request instead of starting another one.
 */
export function acknowledgeAttachment(appSessionId: string): void {
  owed.delete(appSessionId);
}

/**
 * The user picking a different canvas for this chat replaces whatever it owed.
 * An unconfirmed create may have left a canvas behind; that one stays in the
 * canvases list rather than being attached to this chat anyway.
 */
export function chooseCanvasForChat(
  client: CanvasClient,
  appSessionId: string,
  canvasId: string,
): Promise<string | null> {
  owed.delete(appSessionId);
  return attachCanvasToChat(client, appSessionId, { canvasId });
}

/**
 * The chat a canvas card opens into: the most recently active chat attached to
 * it that this window knows of. Null when none of them is loaded here, and the
 * card has to start a fresh chat on the canvas instead.
 */
export function recentAttachedChat(
  summary: CanvasSummary,
  updatedAt: (appSessionId: string) => number | undefined,
): string | null {
  let best: { appSessionId: string; updatedAt: number } | null = null;
  for (const appSessionId of summary.attachedAppSessionIds) {
    const at = updatedAt(appSessionId);
    if (at === undefined) continue;
    if (!best || at > best.updatedAt) best = { appSessionId, updatedAt: at };
  }
  return best?.appSessionId ?? null;
}

/** Canvases whose name matches the user's search, newest edit first. */
export function searchCanvases(summaries: CanvasSummary[], query: string): CanvasSummary[] {
  const needle = query.trim().toLowerCase();
  return summaries
    .filter((summary) => !needle || summary.name.toLowerCase().includes(needle))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}
