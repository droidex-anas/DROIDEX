// Every layout write the board makes, and the rects it draws before one is
// acknowledged. A released drag and a finished nudge, align or distribute are
// the same compare-and-set: one `arrangeFrames` carrying the layout version each
// frame was read at, so a frame a remote chat moved in the meantime is refused
// rather than overwritten. A write on a frame whose last write is unanswered
// waits for that one. An arrange never touches source or revisions.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ArrangeFramesInput, CanvasFrame, FrameRect } from './protocol';

/** One frame's new rect and the layout version it was read at. */
type FramePlacement = ArrangeFramesInput['frames'][number];

export function useLayoutWrites(
  frames: CanvasFrame[],
  onArrangeFrames: (input: ArrangeFramesInput) => Promise<unknown>,
) {
  const [pending, setPending] = useState<Map<string, PendingLayout>>(() => new Map());
  const [refusal, setRefusal] = useState<LayoutRefusal | null>(null);
  const work = useRef(0);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    // Prune retired holds; applicability is derived below before this runs.
    setPending((held) => {
      const remaining = new Map(held);
      for (const [designId, hold] of held) {
        const frame = frames.find((candidate) => candidate.designId === designId);
        if (!frame || frame.layoutVersion > hold.afterLayoutVersion) remaining.delete(designId);
      }
      return remaining.size === held.size ? held : remaining;
    });
  }, [frames]);

  /** Where a frame is drawn when no hand holds it: its unanswered write, else its layout. */
  const rectFor = (frame: CanvasFrame): FrameRect => {
    const hold = pending.get(frame.designId);
    if (hold && frame.layoutVersion <= hold.afterLayoutVersion) return hold.rect;
    return frame.rect;
  };

  /** Newer work makes an older write's refusal moot: its message goes, and a late one never shows. */
  const supersede = useCallback(() => {
    work.current += 1;
    setRefusal(null);
  }, []);

  /** A cancelled re-drag restores acknowledged geometry, not its old hold. */
  const dropHolds = useCallback((designIds: string[]) => {
    setPending((held) => withoutHolds(held, designIds));
  }, []);

  /**
   * The one layout write, shared by a released gesture and by a nudge, an align
   * or a distribute that is already finished when it arrives.
   */
  const commit = (placements: FramePlacement[]) => {
    if (placements.length === 0) return;
    const mutationId = crypto.randomUUID();
    work.current += 1;
    const operation = work.current;
    // A frame still held for an unanswered write was placed from where that write
    // puts it, as a held arrow key does. This write goes once that one settles: at
    // the version it leaves when it lands, else at the version read. Meanwhile it
    // is drawn as if that one lands.
    const waitsOn = placements.map((placement) => {
      const hold = pending.get(placement.designId);
      return hold && placement.expectedLayoutVersion <= hold.afterLayoutVersion ? hold : null;
    });
    let frames = placements.map((placement, index) => {
      const hold = waitsOn[index];
      return hold
        ? { ...placement, expectedLayoutVersion: hold.afterLayoutVersion + 1 }
        : placement;
    });
    const landing = Promise.all(waitsOn.map(lands)).then((landed) => {
      if (!landed.every(Boolean)) {
        frames = frames.map((frame, index) => (landed[index] ? frame : placements[index]));
        setPending((held) => withSentVersions(held, mutationId, frames));
      }
      return onArrangeFrames({ mutationId, frames });
    });
    setPending((held) => {
      const next = new Map(held);
      for (const { designId, rect, expectedLayoutVersion } of frames)
        next.set(designId, {
          mutationId,
          rect,
          afterLayoutVersion: expectedLayoutVersion,
          landing,
        });
      return next;
    });
    setRefusal(null);
    landing.catch((error: unknown) => {
      if (!mounted.current) return;
      // Dropping a hold is safe even when newer layout already answered it,
      // since `rectFor` ignores a hold once its frame moves past that version.
      setPending((held) =>
        withoutHolds(
          held,
          frames
            .filter(({ designId }) => held.get(designId)?.mutationId === mutationId)
            .map(({ designId }) => designId),
        ),
      );
      if (work.current === operation)
        setRefusal({ message: layoutFailure(error), placements: frames });
    });
  };

  return {
    rectFor,
    commit,
    supersede,
    dropHolds,
    error: refusal && isUnanswered(refusal, frames) ? refusal.message : '',
  };
}

/** A refused layout write and the placements it refused. */
interface LayoutRefusal {
  message: string;
  placements: FramePlacement[];
}

// Judged against the frames being drawn: one bridge batch can carry newer
// layout and the refusal it answers before React renders either.
function isUnanswered(refusal: LayoutRefusal, frames: CanvasFrame[]): boolean {
  return refusal.placements.some(({ designId, expectedLayoutVersion }) => {
    const frame = frames.find((candidate) => candidate.designId === designId);
    return frame !== undefined && frame.layoutVersion <= expectedLayoutVersion;
  });
}

interface PendingLayout {
  mutationId: string;
  rect: FrameRect;
  afterLayoutVersion: number;
  /** The write, settling once it lands and rejecting with its refusal. */
  landing: Promise<unknown>;
}

/** Whether the write a hold stands for lands; true for no hold. */
function lands(hold: PendingLayout | null): Promise<boolean> {
  if (!hold) return Promise.resolve(true);
  return hold.landing.then(
    () => true,
    () => false,
  );
}

/** Holds for `mutationId` at the versions its write was sent at. */
function withSentVersions(
  held: Map<string, PendingLayout>,
  mutationId: string,
  frames: FramePlacement[],
): Map<string, PendingLayout> {
  const next = new Map(held);
  for (const { designId, expectedLayoutVersion } of frames) {
    const hold = held.get(designId);
    if (hold?.mutationId === mutationId)
      next.set(designId, { ...hold, afterLayoutVersion: expectedLayoutVersion });
  }
  return next;
}

function withoutHolds(
  held: Map<string, PendingLayout>,
  designIds: string[],
): Map<string, PendingLayout> {
  const dropped = designIds.filter((designId) => held.has(designId));
  if (dropped.length === 0) return held;
  const remaining = new Map(held);
  for (const designId of dropped) remaining.delete(designId);
  return remaining;
}

function layoutFailure(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'That frame could not be moved.';
}
