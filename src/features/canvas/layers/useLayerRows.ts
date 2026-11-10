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
  const treeOf = useElementTrees(runs, frames, open);
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

/** One ask of a frame's run; a newer ask, or forgetting the frame, makes its answer late. */
interface Ask {
  held: AttachedRun;
}

/**
 * The element trees of the `open` frames. Each is asked of its frame's live
 * preview as the frame opens and again whenever that preview's run changes,
 * and never otherwise. A frame that closes, goes or changes runs is forgotten
 * with its answer, so it reads again as it next opens and a late answer is
 * dropped. A frame without a run has no tree, so the answer is null.
 */
function useElementTrees(
  runs: PreviewRuns,
  frames: readonly CanvasFrame[],
  open: ReadonlySet<string>,
) {
  const readVersion = () => runs.version;
  const version = useSyncExternalStore(runs.subscribe, readVersion, readVersion);
  const [answers, setAnswers] = useState<ReadonlyMap<string, Answer>>(() => new Map());
  /** Each open frame's latest ask, so it is asked once per run. */
  const asked = useRef(new Map<string, Ask>());

  useEffect(() => {
    const askedOf = asked.current;
    const wanted = new Map<string, AttachedRun>();
    for (const { designId } of frames) {
      const held = runs.get(designId);
      if (held && open.has(designId)) wanted.set(designId, held);
    }
    for (const [designId, ask] of askedOf)
      if (wanted.get(designId) !== ask.held) askedOf.delete(designId);
    setAnswers((previous) => {
      const kept = [...previous].filter(
        ([designId, answer]) => askedOf.get(designId)?.held === answer.held,
      );
      return kept.length === previous.size ? previous : new Map(kept);
    });
    for (const [designId, held] of wanted) {
      if (askedOf.get(designId)?.held === held) continue;
      const ask = { held };
      askedOf.set(designId, ask);
      void held.run.tree().then((tree) => {
        if (askedOf.get(designId) !== ask) return;
        setAnswers((previous) => new Map(previous).set(designId, { held, tree }));
      });
    }
  }, [frames, open, runs, version]);

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
