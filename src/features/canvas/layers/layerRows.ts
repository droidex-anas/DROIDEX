// The layers panel's rows, front to back: one per frame and, under a frame
// that is open, what its source renders in reading order, nested as the
// build's outline writes it, without what is inside a row that is closed. A
// row says whether its children show, or null when it has none to show.

import type { PreviewNode } from '../previewDocument';
import type { CanvasFrame, OutlineNode, SourceOutline } from '../protocol';

/** An open frame's layers: its outline, and where its live preview draws each element. */
export interface FrameLayers {
  outline: SourceOutline;
  /** Each drawn element's first instance, by elementId; an element missing here is not drawn. */
  drawn: ReadonlyMap<string, string>;
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
      /** The drawn instance a pick or hover of the row goes to; null when none is drawn. */
      target: PreviewNode | null;
      parentKey: string;
      position: number;
      count: number;
      open: boolean | null;
    })
  /** What a frame's outline cannot show: nothing, or what is past the cap. */
  | (RowBase & { kind: 'note'; parentKey: string });

/** An outline row's key; a node id is hex, so it never meets a note's. */
export function nodeKey(designId: string, nodeId: string): string {
  return `${designId}#${nodeId}`;
}

/** The first row of `elementId` in `outline`, as a row picks the element's first drawn instance. */
export function elementNode(outline: SourceOutline, elementId: string): OutlineNode | undefined {
  return outline.nodes.find((node) => node.elementId === elementId);
}

/** The ids of the rows that hold `node`, innermost first. */
export function ancestorIds(outline: SourceOutline, node: OutlineNode): string[] {
  const parents = new Map(outline.nodes.map((each) => [each.nodeId, each.parentId]));
  const ids: string[] = [];
  for (let id = node.parentId; id !== null; id = parents.get(id) ?? null) ids.push(id);
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
  const { nodes, truncated } = layers.outline;
  if (nodes.length === 0) return [note('empty', 'No layers')];

  const childrenOf = new Map<string | null, OutlineNode[]>();
  for (const node of nodes) {
    const siblings = childrenOf.get(node.parentId);
    if (siblings) siblings.push(node);
    else childrenOf.set(node.parentId, [node]);
  }
  const entries: LayerEntry[] = [];
  const add = (parentId: string | null, parentKey: string, level: number) => {
    const siblings = childrenOf.get(parentId) ?? [];
    siblings.forEach((node, index) => {
      const key = nodeKey(designId, node.nodeId);
      const open = childrenOf.has(node.nodeId) ? !closed.has(key) : null;
      entries.push({
        kind: 'element',
        key,
        frame,
        name: node.text ?? node.name,
        level,
        node,
        target: drawnTarget(node, layers.drawn),
        parentKey,
        position: index + 1,
        count: siblings.length,
        open,
      });
      if (open) add(node.nodeId, key, level + 1);
    });
  };
  add(null, designId, 2);
  if (truncated) entries.push(note('more', `Showing the first ${String(nodes.length)} layers`));
  return entries;
}

function drawnTarget(node: OutlineNode, drawn: FrameLayers['drawn']): PreviewNode | null {
  if (node.elementId === null) return null;
  const instancePath = drawn.get(node.elementId);
  return instancePath === undefined ? null : { elementId: node.elementId, instancePath };
}
