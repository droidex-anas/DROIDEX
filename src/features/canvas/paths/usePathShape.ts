// The selected `<path>`'s geometry, read from its live preview when it is
// picked and again in each revision and run the selection moves to, parsed once
// there. It says how the points move, or why they cannot, so no move starts
// that the preview or the edit would refuse.

import { useEffect, useState, useSyncExternalStore } from 'react';
import type { ElementEditDraft } from '../elementEditDraft';
import {
  MAX_PREVIEW_PATH_DATA_BYTES,
  type PreviewMatrix,
  type PreviewShape,
} from '../previewDocumentShape';
import type { PreviewRuns } from '../previewRuns';
import type { PreviewRun } from '../previewRuntime';
import type { ElementRef } from '../protocol';
import { readPathData, type PathSegment } from './pathData';
import { writePath } from './pathModel';

/**
 * What one move may add to the data as it writes moved numbers out again, so
 * a path within this of the preview's cap is not offered a move.
 */
const MOVE_ROOM_BYTES = 512;

export interface PathShape {
  segments: PathSegment[];
  /** From the path's units to its design's pixels. */
  matrix: PreviewMatrix;
  /** The element the shape was read for, which a move writes to. */
  element: ElementRef;
  /**
   * A grip may start a move: the shape is this revision's, read from the run
   * now drawing it, the path is the board's to write, and nothing is saving.
   */
  movable: boolean;
}

export interface SelectedPath {
  /** Null when there are no grips to draw. */
  shape: PathShape | null;
  /** How the points move, or why they cannot; null when there is nothing to say. */
  note: string | null;
}

type ReadShape = { segments: PathSegment[]; matrix: PreviewMatrix } | { note: string | null };

interface Read {
  element: ElementRef;
  run: PreviewRun;
  shape: ReadShape;
}

const NO_PATH: SelectedPath = { shape: null, note: null };

export function usePathShape(draft: ElementEditDraft | null, runs: PreviewRuns): SelectedPath {
  const element = draft?.site.tagName === 'path' ? draft.element : null;
  // Only the selected path's own run re-renders the board, not every preview that comes and goes.
  const readRun = () => {
    const held = element ? runs.get(element.designId) : undefined;
    return element && held?.revisionId === element.revisionId ? held.run : null;
  };
  const run = useSyncExternalStore(runs.subscribe, readRun, readRun);
  const [read, setRead] = useState<Read | null>(null);

  useEffect(() => {
    if (!element || !run) return;
    let live = true;
    const { elementId, instancePath } = element;
    void run.shape({ elementId, instancePath }).then((answer) => {
      // Another selection, or this one in another revision, has asked again.
      if (live) setRead({ element, run, shape: readShape(answer) });
    });
    return () => {
      live = false;
    };
  }, [element, run]);

  // The draft keeps its element object until it moves to another revision. A
  // read for the same drawn path from an older revision or run still shows, so
  // a focused point keeps focus through a commit, but nothing moves by it.
  if (!draft || !element || !read || !sameNode(read.element, element)) return NO_PATH;
  if ('note' in read.shape) return { shape: null, note: read.shape.note };
  const { segments, matrix } = read.shape;
  const flat = isFlat(matrix);
  const movable =
    !flat &&
    read.element === element &&
    read.run === run &&
    draft.site.editability === 'literal' &&
    draft.pending === null;
  return {
    shape: { segments, matrix, element: read.element, movable },
    note: flat ? FLAT : howPointsMove(segments),
  };
}

/** The keys a point takes, and the lines that hold a point to their axis where the path has one. */
function howPointsMove(segments: readonly PathSegment[]): string {
  const keys =
    'Drag a point, or press the arrows on one, with Shift for 10. Tab goes to the next point, and Escape takes a move back.';
  const held = segments.some(({ command }) => /^[HVhv]$/.test(command));
  return held ? `${keys} A point on a horizontal or vertical line moves only along it.` : keys;
}

function readShape(answer: PreviewShape | null): ReadShape {
  if (!answer) return { note: null };
  if ('refused' in answer) {
    if (answer.refused === 'too_large') return { note: TOO_LONG };
    if (answer.refused === 'unreadable') return { note: UNREADABLE };
    return { note: null };
  }
  const segments = readPathData(answer.d, 'source');
  if (!segments) return { note: UNREADABLE };
  if (writePath(segments).length > MAX_PREVIEW_PATH_DATA_BYTES - MOVE_ROOM_BYTES)
    return { note: TOO_LONG };
  return { segments, matrix: answer.matrix };
}

const FLAT = 'This path is drawn flat, so its points can’t be moved here.';
const TOO_LONG = 'This path’s data is too long to move its points here.';
const UNREADABLE =
  'This path’s data has parts the board can’t read, so its points can’t be moved here.';

function sameNode(a: ElementRef, b: ElementRef): boolean {
  return a.designId === b.designId && a.instancePath === b.instancePath;
}

/** A matrix that draws the path onto a line or a point, which no move could be read back through. */
function isFlat([a, b, c, d]: PreviewMatrix): boolean {
  return Math.abs(a * d - b * c) < 1e-9;
}
