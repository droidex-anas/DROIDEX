// The tour an agent's cursor takes once its write on a frame lands: to each
// region the write changed, a few at most, and a rest on the last before it
// leaves. The regions come from the source of the revision before and after
// the write, located in the frame's live preview, so a frame without one, or
// off screen when the write lands, has no tour. The agent's next write ends it.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { changedElements } from './changedElements';
import type { CanvasPresence, LandedWrites, PresenceAgent } from './canvasPresence';
import { isDrawn, MAX_PREVIEW_LOCATE_ELEMENTS } from './previewDocument';
import type { PreviewRuns } from './previewRuns';
import type { CanvasFrame, SourceFiles } from './protocol';

/** A point on a frame, as a share of its width and height. */
export interface TourStop {
  x: number;
  y: number;
}

/**
 * A landed write's tour of the revision it committed: `stops` is null while
 * its regions are still being found.
 */
interface ChangeTour {
  agent: PresenceAgent;
  revisionId: string;
  stops: readonly TourStop[] | null;
}

type ChangeTours = ReadonlyMap<string, ChangeTour>;

export type ReadSource = (designId: string, revisionId: string) => Promise<SourceFiles>;

/** The cursor's move to one region, and its pause there. */
export const TOUR_TRAVEL_MS = 320;
export const TOUR_REST_MS = 120;
/** How long the cursor stays on the last region before it leaves. */
const TOUR_SETTLE_MS = 600;
const MAX_TOUR_STOPS = 4;
const NO_TOURS: ChangeTours = new Map();

/**
 * The tour on each frame, by design id. A write has landed when the running
 * call that named a frame ends with the frame on the revision a completed
 * write of that same agent committed, other than the one the call began on.
 */
export function useChangeTours({
  frames,
  presence,
  writes,
  visible,
  runs,
  readSource,
  moves,
}: {
  frames: readonly CanvasFrame[];
  presence: CanvasPresence;
  writes: LandedWrites;
  visible: readonly string[];
  runs: PreviewRuns;
  readSource: ReadSource;
  /** Whether the cursor travels; when it does not, it shows on the last region at once. */
  moves: boolean;
}): ChangeTours {
  const [tours, setTours] = useState(NO_TOURS);
  const owned = useRef(new Map<string, ChangeTour>());
  // The frames a running call names, each with its agent and the revision it began on.
  const writing = useRef(new Map<string, { agent: PresenceAgent; revisionId: string | null }>());
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const latest = useRef({ frames, visible, runs, readSource, moves });
  latest.current = { frames, visible, runs, readSource, moves };

  // Before paint, so a cursor whose write just landed stays rather than starting to leave.
  useLayoutEffect(() => {
    const publish = () => {
      setTours(new Map(owned.current));
    };
    // Still the frame's tour, and the frame still on the revision it tours.
    const isCurrent = (designId: string, tour: ChangeTour) =>
      owned.current.get(designId) === tour &&
      latest.current.frames.some(
        (frame) => frame.designId === designId && frame.revisionId === tour.revisionId,
      );
    const finish = (designId: string, tour: ChangeTour) => {
      if (owned.current.get(designId) !== tour) return;
      owned.current.delete(designId);
      publish();
    };
    const begin = async (
      frame: CanvasFrame,
      revisionId: string,
      agent: PresenceAgent,
      before: string,
    ) => {
      const finding: ChangeTour = { agent, revisionId, stops: null };
      owned.current.set(frame.designId, finding);
      publish();
      const stops = await tourStops(frame, before, latest.current, () =>
        isCurrent(frame.designId, finding),
      ).catch((error: unknown) => {
        console.error('A Canvas change tour could not read the revisions it compares:', error);
        return null;
      });
      if (!isCurrent(frame.designId, finding)) return;
      if (!stops) {
        finish(frame.designId, finding);
        return;
      }
      const touring: ChangeTour = { agent, revisionId, stops };
      owned.current.set(frame.designId, touring);
      publish();
      const travelMs = latest.current.moves ? stops.length * (TOUR_TRAVEL_MS + TOUR_REST_MS) : 0;
      const timer = setTimeout(() => {
        timers.current.delete(timer);
        finish(frame.designId, touring);
      }, travelMs + TOUR_SETTLE_MS);
      timers.current.add(timer);
    };

    if (forgetStale(frames, writing.current, owned.current)) publish();
    for (const frame of frames) {
      const { designId, revisionId } = frame;
      const worker = presence.get(designId);
      const write = writing.current.get(designId);
      if (worker?.named) {
        if (write?.agent.key !== worker.agent.key)
          writing.current.set(designId, { agent: worker.agent, revisionId });
        if (owned.current.delete(designId)) publish();
        continue;
      }
      if (!write) continue;
      writing.current.delete(designId);
      const landed = landedRevision(frame, write, writes);
      if (landed && write.revisionId !== null && latest.current.visible.includes(designId))
        void begin(frame, landed, write.agent, write.revisionId);
    }
  }, [frames, presence, writes]);

  useEffect(() => {
    const pending = timers.current;
    const tours = owned.current;
    return () => {
      for (const timer of pending) clearTimeout(timer);
      // A tour still being found finds itself gone and stops there.
      tours.clear();
    };
  }, []);

  return tours;
}

/**
 * Forgets the calls and tours of frames no longer on the board, and the tours
 * of frames whose revision moved on; true when a tour went.
 */
function forgetStale(
  frames: readonly CanvasFrame[],
  writing: Map<string, unknown>,
  owned: Map<string, ChangeTour>,
): boolean {
  const revisions = new Map(frames.map((frame) => [frame.designId, frame.revisionId]));
  for (const designId of writing.keys()) if (!revisions.has(designId)) writing.delete(designId);
  let dropped = false;
  for (const [designId, tour] of owned) {
    if (revisions.get(designId) === tour.revisionId) continue;
    owned.delete(designId);
    dropped = true;
  }
  return dropped;
}

/**
 * The revision a call that named the frame ended on, when it is not the one
 * the call began on and a completed write of the same agent committed it.
 */
function landedRevision(
  { designId, revisionId }: CanvasFrame,
  write: { agent: PresenceAgent; revisionId: string | null },
  writes: LandedWrites,
): string | null {
  if (write.revisionId === null || revisionId === null || revisionId === write.revisionId)
    return null;
  const landed = writes.get(designId);
  return landed?.agentKey === write.agent.key && landed.revisionId === revisionId
    ? revisionId
    : null;
}

/**
 * Where on the frame the regions its latest write changed are drawn, in source
 * order, or null when none can be found: its live preview must be running the
 * revision the write made, and the tour must still be current once the
 * sources are read.
 */
async function tourStops(
  frame: CanvasFrame,
  before: string,
  { runs, readSource }: { runs: PreviewRuns; readSource: ReadSource },
  isCurrent: () => boolean,
): Promise<TourStop[] | null> {
  const { designId, build, rect } = frame;
  const held = runs.get(designId);
  if (build.status !== 'ready' || held?.revisionId !== build.revisionId) return null;
  const [earlier, written] = await Promise.all([
    readSource(designId, before),
    readSource(designId, build.revisionId),
  ]);
  if (!isCurrent()) return null;
  const changed = changedElements(build.elements, earlier, written);
  if (changed.length === 0) return null;
  const boxes = await held.run.locate(
    changed.slice(0, MAX_PREVIEW_LOCATE_ELEMENTS).map((element) => element.elementId),
  );
  const stops: TourStop[] = [];
  for (const box of boxes ?? []) {
    if (!box || !isDrawn(box)) continue;
    const x = (box.x + box.width / 2) / rect.width;
    const y = (box.y + box.height / 2) / rect.height;
    if (x >= 0 && x <= 1 && y >= 0 && y <= 1) stops.push({ x, y });
  }
  return stops.length > 0 ? stops.slice(0, MAX_TOUR_STOPS) : null;
}
