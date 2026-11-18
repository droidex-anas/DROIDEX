// Add to board: a kit catalog entry, with the props picked for it, as a new
// frame holding only that entry. It goes beside the selected frame, else the
// frame nearest the view's centre, where the canvas finds room clear of every
// other frame, and is one step of the board's history that Undo deletes. The
// entry sits in a box that hugs it, so once the frame's preview draws it the
// frame is sized to that box and a margin; a frame moved or resized meanwhile
// keeps its own rect.

import { useEffect, useRef, useState } from 'react';
import { boardHistory, canvasClient as canvas, frameRemovals } from '../canvasClient';
import { canvasMessage } from '../client';
import type { PropPick } from '../elementEditProtocol';
import type { PreviewRuns } from '../previewRuns';
import type { PreviewRun } from '../previewRuntime';
import type { CanvasFrame, CatalogListing, DesignSystemRef } from '../protocol';

/** The size a new frame starts at, before its preview says how much its entry needs. */
const FIRST_SIZE = { width: 720, height: 560 };
/** The room around the entry, on each side, once the frame is sized to it. */
const MARGIN_PX = 32;
// The sidecar's CANVAS_LIMITS.maxFrameNameLength.
const MAX_NAME_LENGTH = 120;
/** A frame builds its first revision before drawing it, which takes seconds. */
const DRAWN_DEADLINE_MS = 20_000;

/** What Add to board can do now, as the Components tab shows it. */
export interface BoardAdd {
  /** Null where it cannot add, with why. */
  refusal: string | null;
  /** The entry being added, while it is. */
  adding: string | null;
  /** Why the last add of an entry failed, until the next add. */
  failure: { entry: string; message: string } | null;
}

/** The line under the search or beside the button: what an add of `entry` will do, or why it cannot. */
export function addHint(add: BoardAdd, entry: string | undefined): string {
  if (add.refusal !== null) return add.refusal;
  if (add.adding !== null) return `Adding ${add.adding} to the board…`;
  return `Adds ${entry ?? 'a component'} to the board as a new frame`;
}

/** "Button", or "Button (outline, lg)" with its picks. */
export function addedFrameName(entry: string, picks: readonly PropPick[]): string {
  const name =
    picks.length === 0 ? entry : `${entry} (${picks.map((pick) => pick.value).join(', ')})`;
  return name.slice(0, MAX_NAME_LENGTH);
}

export function useAddToBoard({
  appSessionId,
  canvasId,
  kit,
  canEdit,
  runs,
  besideOf,
  onAdded,
}: {
  appSessionId: string;
  canvasId: string;
  /** The kit whose catalog the tab lists, which the new frame pins. */
  kit: DesignSystemRef | undefined;
  /** False where this chat cannot change the canvas. */
  canEdit: boolean;
  runs: PreviewRuns;
  /** The frame a new one goes beside, read when the add starts. */
  besideOf: () => string | undefined;
  /** Selects the new frame and brings it into view. */
  onAdded: (designId: string) => void;
}) {
  const [adding, setAdding] = useState<string | null>(null);
  const [failure, setFailure] = useState<BoardAdd['failure']>(null);
  // An answer for a canvas the board has left changes nothing on this one.
  const shownCanvas = useRef(canvasId);
  useEffect(() => {
    shownCanvas.current = canvasId;
    setAdding(null);
    setFailure(null);
  }, [canvasId]);

  const refusal = refusalOf(canEdit, kit);
  const state: BoardAdd = { refusal, adding, failure };

  const add = async (entry: CatalogListing, picks: PropPick[]) => {
    if (kit === undefined || refusal !== null || adding !== null) return;
    const isCurrent = () => shownCanvas.current === canvasId;
    const beside = besideOf();
    setAdding(entry.name);
    setFailure(null);
    try {
      const frame = await boardHistory.recording(canvasId, async () => {
        const created = await canvas.createFrames(appSessionId, canvasId, {
          mutationId: crypto.randomUUID(),
          ...(beside ? { placeBeside: { designId: beside } } : {}),
          frames: [
            {
              name: addedFrameName(entry.name, picks),
              ...FIRST_SIZE,
              designSystem: kit,
              seed: { kind: 'component', entry: entry.name, props: picks },
            },
          ],
        });
        const made = created.frames.at(0);
        if (made)
          boardHistory.record(canvasId, frameRemovals.creation(appSessionId, canvasId, made));
        return made;
      });
      if (!frame || !isCurrent()) return;
      onAdded(frame.designId);
      void fitToEntry(runs, frame, (rect) =>
        canvas.arrangeFrames(appSessionId, canvasId, {
          mutationId: crypto.randomUUID(),
          frames: [{ designId: frame.designId, rect, expectedLayoutVersion: frame.layoutVersion }],
        }),
      );
    } catch (error) {
      if (isCurrent()) setFailure({ entry: entry.name, message: canvasMessage(error) });
    } finally {
      if (isCurrent()) setAdding(null);
    }
  };
  return { state, add };
}

function refusalOf(canEdit: boolean, kit: DesignSystemRef | undefined): string | null {
  if (!canEdit) return 'This chat can’t change this canvas.';
  if (kit === undefined) return 'Pick a design system for this canvas to add its components.';
  return null;
}

/**
 * Sizes the new frame to the box its entry hugs once its preview draws it,
 * never past the size it was placed at, so it stays clear of the frames around it.
 * One the user moved or resized meanwhile refuses the write, and keeps the rect it was given.
 */
async function fitToEntry(
  runs: PreviewRuns,
  frame: CanvasFrame,
  resize: (rect: CanvasFrame['rect']) => Promise<unknown>,
): Promise<void> {
  if (frame.revisionId === null) return;
  const run = await drawnRun(runs, frame.designId, frame.revisionId);
  const box = run && (await entryBox(run));
  if (!box) return;
  const width = Math.min(FIRST_SIZE.width, Math.ceil(box.width + 2 * MARGIN_PX));
  const height = Math.min(FIRST_SIZE.height, Math.ceil(box.height + 2 * MARGIN_PX));
  if (width === frame.rect.width && height === frame.rect.height) return;
  await resize({ ...frame.rect, width, height }).catch(() => undefined);
}

/** Where the box holding the entry, just inside the page, is drawn; null when the preview cannot say. */
async function entryBox(run: PreviewRun) {
  const tree = await run.tree(null).catch(() => null);
  const box = tree?.nodes.find((node) => node.depth === 1);
  if (!box) return null;
  const [rect] = (await run.locate([box.elementId]).catch(() => null)) ?? [];
  return rect && rect.width > 0 && rect.height > 0 ? rect : null;
}

/** The design's preview once it draws `revisionId`, or null when it has not by the deadline. */
function drawnRun(
  runs: PreviewRuns,
  designId: string,
  revisionId: string,
): Promise<PreviewRun | null> {
  return new Promise((resolve) => {
    const settle = (run: PreviewRun | null) => {
      clearTimeout(deadline);
      stopListening();
      resolve(run);
    };
    const check = () => {
      const held = runs.get(designId);
      if (held?.revisionId === revisionId) settle(held.run);
    };
    const deadline = setTimeout(() => {
      settle(null);
    }, DRAWN_DEADLINE_MS);
    const stopListening = runs.subscribe(check);
    check();
  });
}
