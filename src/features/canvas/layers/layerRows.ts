// The layers panel's rows, front to back: one per frame and, under a frame
// that is open, its elements in document order as its live preview walked
// them, without those inside an element that is closed. A row says whether its
// children show, or null when it has none to show.

import { elementSite } from '../pickedElement';
import type { PreviewTree, PreviewTreeNode } from '../previewDocumentTree';
import type { CanvasFrame } from '../protocol';

/** An open frame's elements: being read from its preview, read, or not readable from it. */
export type ElementTree =
  | { state: 'reading' }
  | { state: 'read'; tree: PreviewTree; revisionId: string }
  | { state: 'unread' };

interface RowBase {
  key: string;
  /** The frame the row is, or is inside. */
  frame: CanvasFrame;
  /** What type-ahead matches. */
  name: string;
  /** The tree's own level, from 1 for a frame. */
  level: number;
}

export type LayerEntry =
  | (RowBase & { kind: 'frame'; position: number; count: number; open: boolean | null })
  | (RowBase & {
      kind: 'element';
      node: PreviewTreeNode;
      component: string | null;
      parentKey: string;
      position: number;
      count: number;
      open: boolean | null;
    })
  /** What a frame's elements cannot show: still being read, none, or past the cap. */
  | (RowBase & { kind: 'note'; parentKey: string });

/** An element row's key; a path is digits and slashes, so it never meets a note's. */
export function elementKey(designId: string, instancePath: string): string {
  return `${designId}#${instancePath}`;
}

/**
 * `frames` front to back; `treeOf` is null for a frame without a live preview,
 * which has no elements to open.
 */
export function layerEntries(
  frames: readonly CanvasFrame[],
  treeOf: (designId: string) => ElementTree | null,
  open: ReadonlySet<string>,
  closed: ReadonlySet<string>,
): LayerEntry[] {
  const entries: LayerEntry[] = [];
  frames.forEach((frame, index) => {
    const tree = treeOf(frame.designId);
    const shown = tree !== null && open.has(frame.designId);
    entries.push({
      kind: 'frame',
      key: frame.designId,
      frame,
      name: frame.name,
      level: 1,
      position: index + 1,
      count: frames.length,
      open: tree && shown,
    });
    if (tree && shown) entries.push(...elementEntries(frame, tree, closed));
  });
  return entries;
}

function elementEntries(frame: CanvasFrame, tree: ElementTree, closed: ReadonlySet<string>) {
  const note = (suffix: string, name: string): LayerEntry => ({
    kind: 'note',
    key: `${frame.designId}#${suffix}`,
    frame,
    name,
    level: 2,
    parentKey: frame.designId,
  });
  if (tree.state === 'reading') return [note('reading', 'Reading elements…')];
  if (tree.state === 'unread') return [note('unread', 'Couldn’t read this design’s elements')];
  const { nodes, truncated } = tree.tree;
  if (nodes.length === 0) return [note('empty', 'No elements')];

  const places = siblingPlaces(nodes);
  const entries: LayerEntry[] = [];
  const parents: string[] = [];
  // The depth of the closed element whose descendants are being skipped.
  let closedAt: number | null = null;
  nodes.forEach((node, index) => {
    if (closedAt !== null && node.depth > closedAt) return;
    closedAt = null;
    const key = elementKey(frame.designId, node.instancePath);
    const hasChildren = (nodes.at(index + 1)?.depth ?? -1) > node.depth;
    const isOpen = hasChildren ? !closed.has(key) : null;
    const component = elementSite(frame, tree.revisionId, node.elementId)?.component ?? null;
    parents.length = node.depth;
    entries.push({
      kind: 'element',
      key,
      frame,
      name: component ?? node.tagName,
      level: node.depth + 2,
      node,
      component,
      parentKey: node.depth === 0 ? frame.designId : parents[node.depth - 1],
      ...places[index],
      open: isOpen,
    });
    parents.push(key);
    if (isOpen === false) closedAt = node.depth;
  });
  // The walk can stop at its byte budget before the node cap, so the note counts what came.
  if (truncated) entries.push(note('more', `Showing the first ${String(nodes.length)} elements`));
  return entries;
}

/** Each node's place among the nodes that share its parent, as aria-posinset and -setsize. */
function siblingPlaces(nodes: readonly PreviewTreeNode[]) {
  const places = nodes.map(() => ({ position: 0, count: 0 }));
  const groups: number[][] = [];
  const open: number[][] = [];
  nodes.forEach((node, index) => {
    open.length = node.depth + 1;
    if (!open[node.depth]) {
      open[node.depth] = [];
      groups.push(open[node.depth]);
    }
    open[node.depth].push(index);
  });
  for (const group of groups)
    group.forEach((index, at) => {
      places[index] = { position: at + 1, count: group.length };
    });
  return places;
}
