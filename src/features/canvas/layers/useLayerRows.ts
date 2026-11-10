import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { PreviewTree } from '../previewDocumentTree';
import type { AttachedRun, PreviewRuns } from '../previewRuns';
import type { CanvasBuildState, CanvasFrame } from '../protocol';
import {
  ancestorIds,
  elementNode,
  layerEntries,
  nodeKey,
  type FrameLayers,
  type LayerEntry,
} from './layerRows';

type ReadyBuild = Extract<CanvasBuildState, { status: 'ready' }>;

const NONE_DRAWN: FrameLayers['drawn'] = new Map();

/**
 * The panel's rows for `frames`, back to front as the board stacks them, what
 * opens or closes a row's children, and where an element's row is. Frames
 * start closed and their layers open.
 */
export function useLayerRows(frames: readonly CanvasFrame[], runs: PreviewRuns) {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const [closed, setClosed] = useState<ReadonlySet<string>>(() => new Set());
  const readyOf = useReadyBuilds(frames);
  const drawnOf = useDrawnElements(runs, frames, open);
  const layersOf = (designId: string): FrameLayers | null => {
    const build = readyOf(designId);
    return build ? { outline: build.outline, drawn: drawnOf(designId, build.revisionId) } : null;
  };
  const nodeOf = (designId: string, elementId: string) => {
    const outline = readyOf(designId)?.outline;
    const node = outline && elementNode(outline, elementId);
    return outline && node ? { outline, node } : null;
  };
  return {
    rows: layerEntries([...frames].reverse(), layersOf, open, closed),
    fold: (row: LayerEntry, shown: boolean) => {
      if (row.kind === 'frame') setOpen(withMember(open, row.key, shown));
      else setClosed(withMember(closed, row.key, !shown));
    },
    /** The key of the row an element first appears on in its frame's layers; null where it has none. */
    rowOf: (designId: string, elementId: string): string | null => {
      const found = nodeOf(designId, elementId);
      return found && nodeKey(designId, found.node.nodeId);
    },
    /** Opens the element's frame and every row that holds its row, and says which row that is. */
    reveal: (designId: string, elementId: string): string | null => {
      const found = nodeOf(designId, elementId);
      if (!found) return null;
      if (!open.has(designId)) setOpen(withMember(open, designId, true));
      const holders = ancestorIds(found.outline, found.node).map((id) => nodeKey(designId, id));
      if (holders.some((key) => closed.has(key)))
        setClosed(new Set([...closed].filter((key) => !holders.includes(key))));
      return nodeKey(designId, found.node.nodeId);
    },
  };
}

/**
 * Each frame's latest ready build. A frame that is rebuilding or failed keeps
 * the one before, as the board keeps drawing it, so its rows stay through an edit.
 */
function useReadyBuilds(frames: readonly CanvasFrame[]) {
  const [kept, setKept] = useState<ReadonlyMap<string, ReadyBuild>>(() => new Map());
  const ready = new Map<string, ReadyBuild>();
  for (const { designId, build } of frames) {
    const latest = build.status === 'ready' ? build : kept.get(designId);
    if (latest) ready.set(designId, latest);
  }
  const changed =
    ready.size !== kept.size ||
    [...ready].some(([designId, build]) => kept.get(designId)?.generation !== build.generation);
  if (changed) setKept(ready);
  return (designId: string) => ready.get(designId);
}

interface Answer {
  held: AttachedRun;
  /** Each drawn element's first instance, or null when the tree could not be read. */
  drawn: FrameLayers['drawn'] | null;
}

/** One ask of a frame's run; a newer ask, or forgetting the frame, makes its answer late. */
interface Ask {
  held: AttachedRun;
}

/**
 * Where the `open` frames' live previews draw their elements, read from each
 * preview's element tree as its frame opens and again whenever that preview's
 * run changes, and never otherwise. A frame that closes, goes or changes runs
 * is forgotten with its answer, so it reads again as it next opens and a late
 * answer is dropped. Until a frame's run of `revisionId` has answered, none of
 * its elements is drawn.
 */
function useDrawnElements(
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
        const drawn = tree && firstInstances(tree);
        setAnswers((previous) => new Map(previous).set(designId, { held, drawn }));
      });
    }
  }, [frames, open, runs, version]);

  return (designId: string, revisionId: string): FrameLayers['drawn'] => {
    const held = runs.get(designId);
    if (held?.revisionId !== revisionId) return NONE_DRAWN;
    const answer = answers.get(designId);
    return answer?.held === held && answer.drawn ? answer.drawn : NONE_DRAWN;
  };
}

function firstInstances(tree: PreviewTree): FrameLayers['drawn'] {
  const drawn = new Map<string, string>();
  for (const node of tree.nodes)
    if (!drawn.has(node.elementId)) drawn.set(node.elementId, node.instancePath);
  return drawn;
}

function withMember(set: ReadonlySet<string>, key: string, member: boolean): ReadonlySet<string> {
  const next = new Set(set);
  if (member) next.add(key);
  else next.delete(key);
  return next;
}
