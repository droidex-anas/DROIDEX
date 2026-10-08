// What a design draft owes its new chat: the canvas it was started for.
//
// A Design home prompt mints a canvas (spec §4); "New chat with this canvas"
// attaches the one the user came from. Both commit in the sidecar, which owns
// the attachment. This module is the one owner of that unfinished operation:
// the bootstrap starts it and the pane's recovery replays it, both through the
// same retained create mutation ID and attach target, so a lost reply or a
// remount cannot leave a second canvas behind.

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
  running: Promise<string> | null;
  /** The canvas it produced, held until a caller acknowledges the result. */
  settled: string | null;
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
): Promise<string> {
  const existing = owed.get(appSessionId);
  if (existing) {
    if (existing.settled !== null) return Promise.resolve(existing.settled);
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
      operation.settled = canvasId;
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
): Promise<string> {
  const { canvasId } = operation;
  if (canvasId !== null) {
    await client.attachCanvas(appSessionId, canvasId);
    return canvasId;
  }
  return client.createCanvas(appSessionId, operation.mutationId, operation.name);
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
): Promise<string> {
  owed.delete(appSessionId);
  return attachCanvasToChat(client, appSessionId, { canvasId });
}

/** How long a provisional name may be, matching the sidecar's name rule. */
const MAX_CANVAS_NAME_LENGTH = 120;

/**
 * The name a new canvas takes from the prompt that asked for it, until the
 * agent's first design names it (spec §4). Null when the prompt says nothing
 * nameable, which leaves the sidecar's own name in place.
 */
export function provisionalCanvasName(prompt: string): string | null {
  const firstLine = prompt
    .split('\n', 1)[0]
    // eslint-disable-next-line no-control-regex -- Match canvasNameSchema's rejected control ranges.
    .replace(/[\s\u0000-\u001f\u007f-\u009f]+/g, ' ')
    .trim();
  if (!firstLine) return null;
  const whole =
    firstLine.length <= MAX_CANVAS_NAME_LENGTH
      ? firstLine
      : firstLine.slice(0, MAX_CANVAS_NAME_LENGTH).replace(/\s\S*$/, '');
  return whole.replace(/[\s.,;:!?-]+$/, '') || null;
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
