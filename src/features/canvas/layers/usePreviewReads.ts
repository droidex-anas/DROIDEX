import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { PreviewTree } from '../previewDocumentTree';
import type { AttachedRun, PreviewRuns } from '../previewRuns';
import type { CanvasFrame } from '../protocol';

/** The most marked elements read from one preview, a page at a time, once something past the first page is wanted. */
const MAX_READ_ELEMENTS = 8192;

/** What an open frame's live preview has said about where it draws its elements. */
export type PreviewRead =
  | { state: 'reading' | 'unread' }
  /** `more`: further pages are on their way. */
  | { state: 'read'; tree: PreviewTree; more: boolean };

interface FrameRead {
  held: AttachedRun;
  /** What is read so far; null until the first page answers. */
  tree: PreviewTree | null;
  /** A page is on its way. */
  asking: boolean;
  /** A page came back with nothing, so this run is asked nothing more. */
  stopped: boolean;
}

/**
 * Where the `open` frames' live previews draw their elements. A frame's first
 * page is read as it opens and again whenever its preview's run changes, and
 * the rest only once `readRest` asks for it. A frame that closes, goes or
 * changes runs is forgotten with what was read, so a late answer is dropped.
 */
export function usePreviewReads(
  runs: PreviewRuns,
  frames: readonly CanvasFrame[],
  open: ReadonlySet<string>,
) {
  const readVersion = () => runs.version;
  const version = useSyncExternalStore(runs.subscribe, readVersion, readVersion);
  /** Each open frame's read, which only the effect and the answers it waits for change. */
  const reads = useRef(new Map<string, FrameRead>());
  /** `reads` as of its latest change, which is what renders. */
  const [shown, setShown] = useState<ReadonlyMap<string, FrameRead>>(() => new Map());
  /** The runs something past the first page has been wanted from. */
  const [wanted, setWanted] = useState<ReadonlySet<AttachedRun>>(() => new Set());

  useEffect(() => {
    const current = reads.current;
    const live = new Map<string, AttachedRun>();
    for (const { designId } of frames) {
      const held = runs.get(designId);
      if (held && open.has(designId)) live.set(designId, held);
    }
    let changed = false;
    for (const [designId, read] of current) {
      if (live.get(designId) === read.held) continue;
      current.delete(designId);
      changed = true;
    }
    for (const [designId, held] of live) {
      const read = current.get(designId) ?? { held, tree: null, asking: false, stopped: false };
      if (!current.has(designId)) changed = true;
      current.set(designId, read);
      if (!asks(read, wanted.has(held))) continue;
      const asking = { ...read, asking: true };
      current.set(designId, asking);
      void held.run.tree(read.tree).then((tree) => {
        if (current.get(designId) !== asking) return;
        current.set(designId, { held, tree: tree ?? read.tree, asking: false, stopped: !tree });
        setShown(new Map(current));
      });
    }
    if (changed || [...current].some(([designId, read]) => shown.get(designId) !== read))
      setShown(new Map(current));
    const runsLive = new Set(live.values());
    if ([...wanted].some((held) => !runsLive.has(held)))
      setWanted(new Set([...wanted].filter((held) => runsLive.has(held))));
  }, [frames, open, runs, version, shown, wanted]);

  return {
    /** What `designId`'s preview has said, for the outline of `revisionId`. */
    of: (designId: string, revisionId: string): PreviewRead => {
      const held = runs.get(designId);
      if (!held) return { state: 'unread' };
      const read = shown.get(designId);
      // The board swaps in the run of a new build just after the build lands.
      if (held.revisionId !== revisionId || read?.held !== held) return { state: 'reading' };
      if (!read.tree) return { state: read.stopped ? 'unread' : 'reading' };
      return { state: 'read', tree: read.tree, more: read.asking || asks(read, wanted.has(held)) };
    },
    /** Reads the rest of an open frame's preview; says whether more will come. */
    readRest: (designId: string): boolean => {
      const held = runs.get(designId);
      const read = shown.get(designId);
      if (!held || read?.held !== held || !read.tree?.truncated) return false;
      if (!wanted.has(held)) setWanted(new Set(wanted).add(held));
      return asks(read, true) || read.asking;
    },
  };
}

/** Whether a read asks its preview for another page. */
function asks(read: FrameRead, wanted: boolean): boolean {
  if (read.asking || read.stopped) return false;
  if (!read.tree) return true;
  return wanted && read.tree.truncated && read.tree.nodes.length < MAX_READ_ELEMENTS;
}
