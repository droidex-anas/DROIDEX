import { useState } from 'react';
import type { PreviewNode } from '../previewDocument';
import type { PreviewTree } from '../previewDocumentTree';
import type { PreviewRuns } from '../previewRuns';
import type { CanvasBuildState, CanvasFrame, SourceOutline } from '../protocol';
import { drawnLayers, type DrawnLayers } from './drawnLayers';
import {
  ancestorIds,
  layerEntries,
  layerNodes,
  nodeKey,
  type FrameLayers,
  type LayerEntry,
} from './layerRows';
import { usePreviewReads } from './usePreviewReads';

type ReadyBuild = Extract<CanvasBuildState, { status: 'ready' }>;

/** Where a drawn element's row is: found, not there, or not known until more is read. */
export type RowSearch = { state: 'found'; key: string } | { state: 'missing' | 'waiting' };

const MISSING: RowSearch = { state: 'missing' };
const WAITING: RowSearch = { state: 'waiting' };

/**
 * The panel's rows for `frames`, back to front as the board stacks them, what
 * opens or closes a row's children, and where a drawn element's row is.
 * Frames start closed and their layers open.
 */
export function useLayerRows(frames: readonly CanvasFrame[], runs: PreviewRuns) {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const [closed, setClosed] = useState<ReadonlySet<string>>(() => new Set());
  const readyOf = useReadyBuilds(frames);
  const reads = usePreviewReads(runs, frames, open);
  const layersOf = (designId: string): FrameLayers | null => {
    const build = readyOf(designId);
    if (!build) return null;
    const read = reads.of(designId, build.revisionId);
    return {
      outline: build.outline,
      drawn: read.state === 'read' ? drawnLayersOf(build.outline, read.tree) : null,
      reading: read.state === 'reading' || (read.state === 'read' && read.more),
    };
  };
  const nodeIdOf = (designId: string, node: PreviewNode) =>
    open.has(designId) ? layersOf(designId)?.drawn?.rowAt.get(node.instancePath) : undefined;
  return {
    rows: layerEntries([...frames].reverse(), layersOf, open, closed),
    fold: (row: LayerEntry, shown: boolean) => {
      if (row.kind === 'frame') setOpen(withMember(open, row.key, shown));
      else setClosed(withMember(closed, row.key, !shown));
    },
    /** The key of the row a drawn element is on in its open frame's layers; null where none is. */
    rowOf: (designId: string, node: PreviewNode): string | null => {
      const nodeId = nodeIdOf(designId, node);
      return nodeId === undefined ? null : nodeKey(designId, nodeId);
    },
    /** Opens the element's frame and every row that holds its row, and says which row that is. */
    reveal: (designId: string, node: PreviewNode): RowSearch => {
      if (!readyOf(designId)) return MISSING;
      if (!open.has(designId)) {
        setOpen(withMember(open, designId, true));
        return WAITING;
      }
      const layers = layersOf(designId);
      const nodeId = layers?.drawn?.rowAt.get(node.instancePath);
      if (!layers || nodeId === undefined) {
        // Past the pages read so far, it may still be drawn; the rest is read to find it.
        if (layers?.reading || reads.readRest(designId)) return WAITING;
        return MISSING;
      }
      const holders = ancestorIds(layerNodes(layers), nodeId).map((id) => nodeKey(designId, id));
      if (holders.some((key) => closed.has(key)))
        setClosed(new Set([...closed].filter((key) => !holders.includes(key))));
      return { state: 'found', key: nodeKey(designId, nodeId) };
    },
    /** Reads the rest of an open frame's preview, for rows past what is read. */
    readRest: reads.readRest,
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

const matched = new WeakMap<SourceOutline, WeakMap<PreviewTree, DrawnLayers>>();

/** `drawnLayers`, kept for as long as the outline and the tree it was read from are the same objects. */
function drawnLayersOf(outline: SourceOutline, tree: PreviewTree): DrawnLayers {
  const byTree = matched.get(outline) ?? new WeakMap<PreviewTree, DrawnLayers>();
  matched.set(outline, byTree);
  const known = byTree.get(tree);
  if (known) return known;
  const layers = drawnLayers(outline, tree);
  byTree.set(tree, layers);
  return layers;
}

function withMember(set: ReadonlySet<string>, key: string, member: boolean): ReadonlySet<string> {
  const next = new Set(set);
  if (member) next.add(key);
  else next.delete(key);
  return next;
}
