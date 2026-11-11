import { useEffect, useEffectEvent, useState } from 'react';
import type { ElementEdited, LayerChange, LayerRef } from '../elementEditProtocol';
import type { PreviewNode } from '../previewDocument';
import type { Drawn } from './drawnLayers';
import type { ElementEntry } from './ElementRow';
import type { LayerEntry } from './layerRows';
import type { RowSearch } from './useLayerRows';

/** What an edit of a layer answers: the edit, or null where it was refused and said so. */
export type EditLayer = (layer: LayerRef, change: LayerChange) => Promise<ElementEdited | null>;

/** The row an edit landed on, followed until its frame has built the revision it landed in. */
interface Landing {
  designId: string;
  revisionId: string;
  nodeId: string;
  /** Its element is to be picked: a moved or copied layer whose element was picked. */
  picked: boolean;
  /** The row once found, while its element waits to be drawn. */
  key: string | null;
}

/**
 * Edits the layer of an element row of `rows`. Once the edit has built, the
 * keyboard goes to the row it landed on (the moved layer, its copy, or the
 * row a removed layer leaves it to), and a moved or copied layer whose
 * element was picked is picked again there.
 */
export function useLayerEdit({
  rows,
  pickedKey,
  reveal,
  moveTo,
  pick,
  onEditLayer,
}: {
  rows: readonly LayerEntry[];
  pickedKey: string | null;
  reveal: (designId: string, row: { nodeId: string }) => RowSearch;
  moveTo: (key: string) => void;
  pick: (designId: string, node: PreviewNode) => void;
  /** Undefined where this chat cannot change the canvas. */
  onEditLayer: EditLayer | undefined;
}) {
  const follow = useLanding(rows, reveal, moveTo, pick);
  return (row: ElementEntry, change: LayerChange) => {
    const { designId, build } = row.frame;
    if (!onEditLayer || build.status !== 'ready') return;
    const picked = change.kind !== 'remove' && row.key === pickedKey;
    const layer = { designId, revisionId: build.revisionId, nodeId: row.node.nodeId };
    void onEditLayer(layer, change).then((edited) => {
      if (edited?.landed)
        follow({ designId, revisionId: edited.receipt.revisionId, nodeId: edited.landed, picked });
    });
  };
}
/**
 * Follows an edited layer to the row it landed on, once its frame has built
 * that revision, and picks its element there when it is to be picked.
 */
function useLanding(
  rows: readonly LayerEntry[],
  reveal: (designId: string, row: { nodeId: string }) => RowSearch,
  moveTo: (key: string) => void,
  pick: (designId: string, node: PreviewNode) => void,
) {
  const [landing, setLanding] = useState<Landing | null>(null);
  if (landing?.key === null) {
    const search = landedRow(rows, landing, reveal);
    if (search.state === 'found') {
      moveTo(search.key);
      setLanding(landing.picked ? { ...landing, key: search.key } : null);
    } else if (search.state === 'missing') setLanding(null);
  }
  const drawn = landing?.key ? drawnAt(rows, landing.key) : null;
  const landedNode = drawn?.state === 'drawn' ? drawn.node : null;
  if (landing?.key && !landedNode && !mayBeDrawn(rows, landing, drawn)) setLanding(null);
  // The board's pick is the board's state, so it changes after this render, not during it.
  const pickLanded = useEffectEvent((node: PreviewNode) => {
    if (landing) pick(landing.designId, node);
    setLanding(null);
  });
  useEffect(() => {
    if (landedNode) pickLanded(landedNode);
  }, [landedNode]);
  return (moved: Omit<Landing, 'key'>) => {
    setLanding({ ...moved, key: null });
  };
}

/** The row an edit landed on, once its frame has built the revision it landed in. */
function landedRow(
  rows: readonly LayerEntry[],
  landing: Landing,
  reveal: (designId: string, row: { nodeId: string }) => RowSearch,
): RowSearch {
  const frame = rows.find((row) => row.key === landing.designId)?.frame;
  // Another write to the frame, or a build that failed, leaves the row where it is.
  if (frame?.revisionId !== landing.revisionId || frame.build.status === 'failed')
    return { state: 'missing' };
  const { build } = frame;
  if (build.status !== 'ready' || build.revisionId !== landing.revisionId)
    return { state: 'waiting' };
  return reveal(landing.designId, { nodeId: landing.nodeId });
}

/**
 * Whether a landed row's element may yet be drawn: its frame still shows the
 * revision it landed in, and the preview is reading it or, for a moment
 * between the old run and the new one, holds no run at all.
 */
function mayBeDrawn(rows: readonly LayerEntry[], landing: Landing, drawn: Drawn | null): boolean {
  if (drawn?.state !== 'reading' && drawn?.state !== 'unread') return false;
  return rows.find((row) => row.key === landing.designId)?.frame.revisionId === landing.revisionId;
}

function drawnAt(rows: readonly LayerEntry[], key: string): Drawn | null {
  const row = rows.find((each) => each.key === key);
  return row?.kind === 'element' ? row.drawn : null;
}
