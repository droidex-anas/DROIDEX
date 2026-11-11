// The layers panel's rows, front to back: one per frame and, under a frame
// that is open, what its source renders in reading order, nested as the
// build's outline writes it, then a row for each drawn element the outline
// does not write, without what is inside a row that is closed. A row says
// whether its children show, or null when it has none to show.

import type { CanvasFrame, OutlineNode, SourceOutline } from '../protocol';
import type { Drawn, DrawnLayers } from './drawnLayers';

/** An open frame's layers: its outline, and where its live preview draws them as far as read. */
export interface FrameLayers {
  outline: SourceOutline;
  /** Null until its preview has answered, or where it cannot. */
  drawn: DrawnLayers | null;
  /** Its preview is being read, so what is not read yet is on its way. */
  reading: boolean;
}

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
      node: OutlineNode;
      /** Where an element's row picks and outlines, or why it cannot; null for the other kinds. */
      drawn: Drawn | null;
      parentKey: string;
      position: number;
      count: number;
      open: boolean | null;
    })
  /** What a frame's outline cannot show: nothing, or what is past its limits. */
  | (RowBase & { kind: 'note'; parentKey: string });

/** Where a frame row's icon sits, as Row's padding puts it, and each level's step in. */
const LEVEL_ONE_INSET_PX = 12;
export const LEVEL_STEP_PX = 12;

/** How far in a row of tree level `level` starts its icon, in list pixels. */
export function rowInset(level: number): number {
  return LEVEL_ONE_INSET_PX + (level - 1) * LEVEL_STEP_PX;
}

/** A row's key; a node id is hex or a path, so it never meets a note's. */
export function nodeKey(designId: string, nodeId: string): string {
  return `${designId}#${nodeId}`;
}

/** Every row of an open frame's layers: its outline's, then those of the drawn elements it does not write. */
export function layerNodes(layers: FrameLayers): OutlineNode[] {
  const { outline, drawn } = layers;
  return drawn && drawn.unwritten.length > 0
    ? [...outline.nodes, ...drawn.unwritten]
    : outline.nodes;
}

/** The ids of the rows that hold `nodeId`, innermost first. */
export function ancestorIds(nodes: readonly OutlineNode[], nodeId: string): string[] {
  const parents = new Map(nodes.map((each) => [each.nodeId, each.parentId]));
  const ids: string[] = [];
  for (let id = parents.get(nodeId) ?? null; id !== null; id = parents.get(id) ?? null)
    ids.push(id);
  return ids;
}

/**
 * `frames` front to back; `layersOf` is null for a frame that has never built,
 * which has nothing to open.
 */
export function layerEntries(
  frames: readonly CanvasFrame[],
  layersOf: (designId: string) => FrameLayers | null,
  open: ReadonlySet<string>,
  closed: ReadonlySet<string>,
): LayerEntry[] {
  const entries: LayerEntry[] = [];
  frames.forEach((frame, index) => {
    const layers = layersOf(frame.designId);
    const shown = layers !== null && open.has(frame.designId);
    entries.push({
      kind: 'frame',
      key: frame.designId,
      frame,
      name: frame.name,
      level: 1,
      position: index + 1,
      count: frames.length,
      open: layers && shown,
    });
    if (layers && shown) entries.push(...elementEntries(frame, layers, closed));
  });
  return entries;
}

function elementEntries(frame: CanvasFrame, layers: FrameLayers, closed: ReadonlySet<string>) {
  const { designId } = frame;
  const note = (suffix: string, name: string): LayerEntry => ({
    kind: 'note',
    key: `${designId}#${suffix}`,
    frame,
    name,
    level: 2,
    parentKey: designId,
  });
  const nodes = layerNodes(layers);
  const more = note('more', 'Not every layer could be listed');
  if (nodes.length === 0) return [layers.outline.truncated ? more : note('empty', 'No layers')];

  const childrenOf = new Map<string | null, OutlineNode[]>();
  for (const node of nodes) {
    const siblings = childrenOf.get(node.parentId);
    if (siblings) siblings.push(node);
    else childrenOf.set(node.parentId, [node]);
  }
  const entries: LayerEntry[] = [];
  // Depth first, without recursion, as an outline can nest as deep as its source does.
  const pending = siblingsOf(childrenOf, null, designId, 2);
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    const { node, parentKey, level, position, count } = next;
    const key = nodeKey(designId, node.nodeId);
    const open = childrenOf.has(node.nodeId) ? !closed.has(key) : null;
    entries.push({
      kind: 'element',
      key,
      frame,
      name: node.text ?? node.name,
      level,
      node,
      drawn: drawnState(node, layers),
      parentKey,
      position,
      count,
      open,
    });
    if (open) pending.push(...siblingsOf(childrenOf, node.nodeId, key, level + 1));
  }
  if (layers.outline.truncated) entries.push(more);
  return entries;
}

/** The rows `parentId` holds, last first, as the walk takes them off the end. */
function siblingsOf(
  childrenOf: ReadonlyMap<string | null, OutlineNode[]>,
  parentId: string | null,
  parentKey: string,
  level: number,
) {
  const siblings = childrenOf.get(parentId) ?? [];
  return siblings
    .map((node, index) => ({ node, parentKey, level, position: index + 1, count: siblings.length }))
    .reverse();
}

function drawnState(node: OutlineNode, layers: FrameLayers): Drawn | null {
  if (node.elementId === null) return null;
  const drawn = layers.drawn?.drawn.get(node.nodeId) ?? { state: 'unread' };
  return drawn.state === 'unread' && layers.reading ? { state: 'reading' } : drawn;
}
