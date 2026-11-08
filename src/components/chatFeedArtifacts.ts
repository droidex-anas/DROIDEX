// A Canvas create or write that produced frames is what the turn made, not a
// step along the way, so it becomes its own card in the transcript (spec §4).
// A design gets one card per turn: the create and the writes that fill it are
// one artifact, pinned to the last revision the turn committed, and a call that
// failed or made nothing gets no card. A design system the agent saved,
// proposed or applied is one too, shown as its chip once per turn for each kit
// and outcome (design system documents spec §9).

import type { TranscriptEvent } from '../types/bridge';

type Activity = NonNullable<TranscriptEvent['canvasActivity']>;

/** A completed create or write's activity, which names the canvas it changed. */
export type CanvasArtifact = Activity & { action: 'create' | 'write'; canvasId: string };

/** A completed theme call's activity, which names the kit it saved, proposed or applied. */
export type KitArtifact = Activity & {
  action: 'theme';
  designSystem: NonNullable<Activity['designSystem']>;
};

export interface CanvasArtifactItem {
  type: 'canvas_artifact';
  key: string;
  /** The completed result the card stands for. */
  event: TranscriptEvent;
  activity: CanvasArtifact | KitArtifact;
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
  // This turn's card for each design or kit, and the revision each card shows.
  let turnCards = new Map<string, ArtifactResult>();
  const revisionOf = new Map<ArtifactResult, string>();
  for (const event of events) {
    if (event.author === 'user') {
      turnCards = new Map();
      continue;
    }
    if (!event.toolUseId) continue;
    if (event.kind === 'tool_call') {
      calls.set(event.toolUseId, event);
      continue;
    }
    if (!isArtifact(event)) continue;
    const keys = shownKeys(event.canvasActivity);
    if (!keys.every((key) => turnCards.has(key))) {
      for (const key of keys) if (!turnCards.has(key)) turnCards.set(key, event);
      resultOf.set(event, event);
      const call = calls.get(event.toolUseId);
      if (call) resultOf.set(call, event);
    }
    const { designIds, revisionId } = event.canvasActivity;
    const designId = designIds.at(0);
    const card = designId === undefined ? undefined : turnCards.get(designId);
    // A card stands for the first frame it names, so only that frame's writes move it.
    if (revisionId && card && card.canvasActivity.designIds[0] === designId)
      revisionOf.set(card, revisionId);
  }
  if (resultOf.size === 0) return { events, cards: new Map() };

  const cards = new Map<TranscriptEvent, CanvasArtifactItem>();
  const carded = new Set<TranscriptEvent>();
  const kept = events.filter((event) => {
    const result = resultOf.get(event);
    if (!result) return true;
    if (carded.has(result)) return false;
    carded.add(result);
    const revisionId = revisionOf.get(result);
    cards.set(event, {
      type: 'canvas_artifact',
      key: `canvas-artifact-${result.id}`,
      event: result,
      activity:
        revisionId === undefined || revisionId === result.canvasActivity.revisionId
          ? result.canvasActivity
          : { ...result.canvasActivity, revisionId },
    });
    return true;
  });
  return { events: kept, cards };
}

type ArtifactResult = TranscriptEvent & { canvasActivity: CanvasArtifact | KitArtifact };

function isArtifact(event: TranscriptEvent): event is ArtifactResult {
  const activity = event.canvasActivity;
  if (event.kind !== 'tool_result' || activity?.state !== 'completed') return false;
  if (activity.action === 'theme') return activity.designSystem !== undefined;
  return (
    (activity.action === 'create' || activity.action === 'write') && activity.canvasId !== undefined
  );
}

// Design ids never contain a colon, so a kit's key cannot name a design.
function shownKeys(activity: CanvasArtifact | KitArtifact): string[] {
  if (activity.action !== 'theme') return activity.designIds;
  const { id, status } = activity.designSystem;
  return [`kit:${id}:${status}`];
}
