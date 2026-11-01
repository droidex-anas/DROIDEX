// A Canvas create or write that produced frames is what the turn made, not a
// step along the way, so it becomes its own card in the transcript (spec §4).
// A design gets one card per turn: the create and the writes that fill it are
// one artifact, and a call that failed or made nothing gets no card. A design
// system the agent saved, proposed or applied is one too, shown as its chip
// once per turn for each kit and outcome (design system documents spec §9).

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
  let shown = new Set<string>();
  for (const event of events) {
    if (event.author === 'user') {
      shown = new Set();
      continue;
    }
    if (!event.toolUseId) continue;
    if (event.kind === 'tool_call') {
      calls.set(event.toolUseId, event);
      continue;
    }
    if (!isArtifact(event)) continue;
    const keys = shownKeys(event.canvasActivity);
    if (keys.every((key) => shown.has(key))) continue;
    for (const key of keys) shown.add(key);
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
