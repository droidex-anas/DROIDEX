// What the board says to a screen reader, through one polite live region:
// a frame that starts building, becomes ready or fails, frames deleted, a
// selection the focus does not already speak, and the zoom once it settles.
// Spec §11 asks for concise status, never animation ticks, so each change is
// one short line.

import { useEffect, useRef, useState } from 'react';
import type { ShownRevisions } from './previewLabels';
import type { CanvasFrame } from './protocol';

/** How long the zoom must stay put before its level is spoken. */
const ZOOM_SETTLE_MS = 500;
/** Beyond this many frames changing at once, the line counts instead of naming. */
const NAMED_CHANGES = 2;

type Spoken = 'building' | 'ready' | 'failed';
const SAID: Record<Spoken, { one: string; many: string }> = {
  building: { one: 'is building', many: 'building' },
  ready: { one: 'is ready', many: 'ready' },
  failed: { one: 'didn’t build', many: 'didn’t build' },
};

function spoken(frame: CanvasFrame): Spoken | null {
  const { status } = frame.build;
  return status === 'building' || status === 'ready' || status === 'failed' ? status : null;
}

/**
 * The build news between two snapshots: frames whose status moved to building,
 * ready or failed. Frames that only moved or were renamed say nothing, and a
 * frame still showing an earlier design builds quietly: an agent's streaming
 * checkpoints would otherwise say "building" on every write.
 */
export function buildAnnouncement(
  previous: readonly CanvasFrame[],
  next: readonly CanvasFrame[],
  shown: ShownRevisions,
): string | null {
  const before = new Map(previous.map((frame) => [frame.designId, frame.build.status]));
  const changes = next.flatMap((frame) => {
    const now = spoken(frame);
    if (!now || before.get(frame.designId) === frame.build.status) return [];
    return now === 'building' && shown.has(frame.designId) ? [] : [{ frame, now }];
  });
  if (changes.length === 0) return null;
  if (changes.length <= NAMED_CHANGES)
    return changes.map(({ frame, now }) => `${frame.name} ${SAID[now].one}`).join('; ');
  const counts = (['building', 'ready', 'failed'] as const).flatMap((kind) => {
    const count = changes.filter(({ now }) => now === kind).length;
    return count > 0 ? [`${String(count)} ${SAID[kind].many}`] : [];
  });
  return `${String(changes.length)} frames changed: ${counts.join(', ')}`;
}

/** Frames that left the board, by name for one or two and counted beyond. */
export function removalAnnouncement(
  previous: readonly CanvasFrame[],
  next: readonly CanvasFrame[],
): string | null {
  const kept = new Set(next.map((frame) => frame.designId));
  const removed = previous.filter((frame) => !kept.has(frame.designId));
  if (removed.length === 0) return null;
  if (removed.length <= NAMED_CHANGES)
    return removed.map((frame) => `${frame.name} deleted`).join('; ');
  return `${String(removed.length)} frames deleted`;
}

/**
 * The selection news. A single frame chosen from its focused label is already
 * spoken by that label, so only other changes are said.
 */
export function selectionAnnouncement(
  previous: readonly string[],
  next: readonly string[],
  nameOf: (designId: string) => string,
  focusedId: string | null,
): string | null {
  if (previous.length === next.length && previous.every((id, index) => id === next[index]))
    return null;
  if (next.length === 0) return previous.length > 0 ? 'Selection cleared' : null;
  if (next.length > 1) return `${String(next.length)} frames selected`;
  return next[0] === focusedId ? null : `${nameOf(next[0])} selected`;
}

export function zoomAnnouncement(scale: number): string {
  return `Zoom ${String(Math.round(scale * 100))}%`;
}

/** The line the board's live region carries, updated as the board changes. */
export function useBoardAnnouncer({
  frames,
  shown,
  selectedFrameIds,
  focusedId,
  scale,
}: {
  frames: readonly CanvasFrame[];
  shown: ShownRevisions;
  selectedFrameIds: readonly string[];
  focusedId: string | null;
  scale: number;
}): string {
  const [line, setLine] = useState('');
  // The board opens at the identity scale and its opening Fit moves it once.
  // That first settled scale is where the board starts, not news.
  const heard = useRef({ frames, selectedFrameIds, scale, settled: false });
  // Read by the effects below, so a rename, a focus move or a newly shown design alone says nothing.
  const now = useRef({ frames, shown, focusedId });
  now.current = { frames, shown, focusedId };

  useEffect(() => {
    const said = [
      removalAnnouncement(heard.current.frames, frames),
      buildAnnouncement(heard.current.frames, frames, now.current.shown),
    ].filter((line) => line !== null);
    heard.current.frames = frames;
    if (said.length > 0) setLine(said.join('; '));
  }, [frames]);

  useEffect(() => {
    const names = new Map(now.current.frames.map((frame) => [frame.designId, frame.name]));
    // A selection that only lost deleted frames is told by the deletion.
    const previous = heard.current.selectedFrameIds;
    const pruned =
      selectedFrameIds.every((designId) => previous.includes(designId)) &&
      previous.every((designId) => selectedFrameIds.includes(designId) || !names.has(designId));
    heard.current.selectedFrameIds = selectedFrameIds;
    if (pruned) return;
    const said = selectionAnnouncement(
      previous,
      selectedFrameIds,
      (designId) => names.get(designId) ?? 'Frame',
      now.current.focusedId,
    );
    if (said) setLine(said);
  }, [selectedFrameIds]);

  // A wheel, a pinch or an eased zoom passes through many scales; only the one
  // it comes to rest on is said.
  useEffect(() => {
    if (scale === heard.current.scale) return undefined;
    const timer = setTimeout(() => {
      heard.current.scale = scale;
      if (heard.current.settled) setLine(zoomAnnouncement(scale));
      heard.current.settled = true;
    }, ZOOM_SETTLE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [scale]);

  return line;
}
