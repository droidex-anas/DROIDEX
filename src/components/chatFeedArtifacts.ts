// A Canvas create or write that produced frames is what the turn made, not a
// step along the way, so it becomes its own card in the transcript (spec §4).
// A design gets one card per turn: the create and the writes that fill it are
// one artifact, and a call that failed or made nothing gets no card.

import type { TranscriptEvent } from '../types/bridge';

/** A completed create or write's activity, which names the canvas it changed. */
export type CanvasArtifact = NonNullable<TranscriptEvent['canvasActivity']> & { canvasId: string };

export interface CanvasArtifactItem {
  type: 'canvas_artifact';
  key: string;
  /** The completed result the card stands for. */
  event: TranscriptEvent;
  activity: CanvasArtifact;
}

export interface CanvasArtifactRows {
  /** The transcript with each artifact reduced to its first event, the card's place. */
  events: TranscriptEvent[];
  /** The card each of those first events becomes. */
  cards: ReadonlyMap<TranscriptEvent, CanvasArtifactItem>;
}

export function canvasArtifactRows(events: TranscriptEvent[]): CanvasArtifactRows {
  const resultOf = new Map<TranscriptEvent, ArtifactResult>();
  // Tool-use IDs can repeat across turns, so a result pairs with the latest call before it.
  const calls = new Map<string, TranscriptEvent>();
  let shownDesignIds = new Set<string>();
  for (const event of events) {
    if (event.author === 'user') {
      shownDesignIds = new Set();
      continue;
    }
    if (!event.toolUseId) continue;
    if (event.kind === 'tool_call') {
      calls.set(event.toolUseId, event);
      continue;
    }
    if (!isArtifact(event) || event.canvasActivity.designIds.every((id) => shownDesignIds.has(id)))
      continue;
    for (const id of event.canvasActivity.designIds) shownDesignIds.add(id);
    resultOf.set(event, event);
    const call = calls.get(event.toolUseId);
    if (call) resultOf.set(call, event);
  }
  if (resultOf.size === 0) return { events, cards: new Map() };

  const cards = new Map<TranscriptEvent, CanvasArtifactItem>();
  const carded = new Set<TranscriptEvent>();
  const kept = events.filter((event) => {
    const result = resultOf.get(event);
    if (!result) return true;
    if (carded.has(result)) return false;
    carded.add(result);
    cards.set(event, {
      type: 'canvas_artifact',
      key: `canvas-artifact-${result.id}`,
      event: result,
      activity: result.canvasActivity,
    });
    return true;
  });
  return { events: kept, cards };
}

type ArtifactResult = TranscriptEvent & { canvasActivity: CanvasArtifact };

function isArtifact(event: TranscriptEvent): event is ArtifactResult {
  const activity = event.canvasActivity;
  return (
    event.kind === 'tool_result' &&
    activity?.state === 'completed' &&
    (activity.action === 'create' || activity.action === 'write') &&
    activity.canvasId !== undefined
  );
}
