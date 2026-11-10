import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { PreviewTree } from '../previewDocumentTree';
import type { AttachedRun, PreviewRuns } from '../previewRuns';
import type { CanvasFrame } from '../protocol';
import { layerEntries, type ElementTree, type LayerEntry } from './layerRows';

/**
 * The panel's rows for `frames`, back to front as the board stacks them, and
 * what opens or closes a row's children. Frames start closed and elements open.
 */
export function useLayerRows(frames: readonly CanvasFrame[], runs: PreviewRuns) {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const [closed, setClosed] = useState<ReadonlySet<string>>(() => new Set());
  const treeOf = useElementTrees(runs, open);
  return {
    rows: layerEntries([...frames].reverse(), treeOf, open, closed),
    fold: (row: LayerEntry, shown: boolean) => {
      if (row.kind === 'frame') setOpen(withMember(open, row.key, shown));
      else setClosed(withMember(closed, row.key, !shown));
    },
  };
}

interface Answer {
  held: AttachedRun;
  tree: PreviewTree | null;
}

/**
 * The element trees of the `open` frames. Each is asked of its frame's live
 * preview as the frame opens and again whenever that preview's run changes,
 * and never otherwise; an answer from a run the frame no longer has is not
 * shown. A frame without a run has no tree, so the answer is null.
 */
function useElementTrees(runs: PreviewRuns, open: ReadonlySet<string>) {
  const readVersion = () => runs.version;
  const version = useSyncExternalStore(runs.subscribe, readVersion, readVersion);
  const [answers, setAnswers] = useState<ReadonlyMap<string, Answer>>(() => new Map());
  /** The run each open frame was last asked through, so it is asked once per run. */
  const asked = useRef(new Map<string, AttachedRun>());

  useEffect(() => {
    const askedOf = asked.current;
    // A frame that closed is asked again when it opens.
    for (const designId of askedOf.keys()) if (!open.has(designId)) askedOf.delete(designId);
    for (const designId of open) {
      const held = runs.get(designId);
      if (!held || askedOf.get(designId) === held) continue;
      askedOf.set(designId, held);
      void held.run.tree().then((tree) => {
        if (askedOf.get(designId) !== held) return;
        setAnswers((previous) => new Map(previous).set(designId, { held, tree }));
      });
    }
  }, [open, runs, version]);

  return (designId: string): ElementTree | null => {
    const held = runs.get(designId);
    if (!held) return null;
    const answer = answers.get(designId);
    if (answer?.held !== held) return { state: 'reading' };
    return answer.tree
      ? { state: 'read', tree: answer.tree, revisionId: held.revisionId }
      : { state: 'unread' };
  };
}

function withMember(set: ReadonlySet<string>, key: string, member: boolean): ReadonlySet<string> {
  const next = new Set(set);
  if (member) next.add(key);
  else next.delete(key);
  return next;
}
