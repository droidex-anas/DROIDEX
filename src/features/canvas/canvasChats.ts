// What a design draft owes its new chat: the canvas it was started for.
//
// A Design home prompt mints a canvas (spec §4); "New chat with this canvas"
// attaches the one the user came from. Both commit in the sidecar, which owns
// the attachment, and both are keyed by a retained mutation ID so a lost reply
// cannot leave a second canvas behind.

import type { CanvasClient } from './client';
import type { CanvasSummary } from './protocol';

const createMutationIds = new Map<string, string>();

/**
 * Attaches `appSessionId` to `canvasId`, or to a canvas minted for it when
 * `canvasId` is null. Resolves with the canvas the chat now works on.
 */
export async function attachCanvasToChat(
  client: CanvasClient,
  appSessionId: string,
  canvasId: string | null,
): Promise<string> {
  if (canvasId !== null) {
    await client.attachCanvas(appSessionId, canvasId);
    return canvasId;
  }
  const mutationId = createMutationIds.get(appSessionId) ?? crypto.randomUUID();
  createMutationIds.set(appSessionId, mutationId);
  const created = await client.createCanvas(appSessionId, mutationId);
  createMutationIds.delete(appSessionId);
  return created;
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
