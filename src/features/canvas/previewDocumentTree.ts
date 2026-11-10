// A design's element tree, as its preview guest walks it: every marked element
// in document order with how many marked elements hold it, up to the cap the
// reporter stops at. Display data, read like the other direct answers.

import {
  clampPreviewText,
  count,
  isInstancePath,
  present,
  readAnswer,
  record,
  type PreviewNode,
} from './previewDocument';

/** Elements one tree answer may name, as the reporter caps them. */
export const MAX_PREVIEW_TREE_NODES = 400;
/** Bytes one tree answer may measure, as the intermediate accepts it. */
const MAX_PREVIEW_TREE_BYTES = 128 * 1024;

export interface PreviewTreeNode extends PreviewNode {
  tagName: string;
  /** How many marked elements hold it; 0 for one no marked element holds. */
  depth: number;
}

/** The marked elements in document order, and whether the walk stopped at `cap` before the last. */
export interface PreviewTree {
  nodes: PreviewTreeNode[];
  cap: number;
  truncated: boolean;
}

/** Asks for the design's element tree; the call itself answers. */
export const PREVIEW_TREE_SCRIPT = 'globalThis.__droidexCanvasPreview.tree()';

/**
 * A tree answer, or null when it is not one. Document order means a node is at
 * most one level below the node before it, so a deeper jump refuses the answer.
 */
export function readPreviewTree(value: unknown): PreviewTree | null {
  const parsed = readAnswer(value, MAX_PREVIEW_TREE_BYTES);
  if (!record(parsed) || parsed.cap !== MAX_PREVIEW_TREE_NODES) return null;
  if (typeof parsed.truncated !== 'boolean' || !Array.isArray(parsed.nodes)) return null;
  if (parsed.nodes.length > MAX_PREVIEW_TREE_NODES) return null;
  const nodes: PreviewTreeNode[] = [];
  for (const node of parsed.nodes) {
    if (!record(node) || !present(node.elementId) || !present(node.tagName)) return null;
    if (!isInstancePath(node.instancePath) || !count(node.depth)) return null;
    if (node.depth > (nodes.at(-1)?.depth ?? -1) + 1) return null;
    nodes.push({
      elementId: clampPreviewText(node.elementId),
      instancePath: node.instancePath,
      tagName: clampPreviewText(node.tagName),
      depth: node.depth,
    });
  }
  return { nodes, cap: MAX_PREVIEW_TREE_NODES, truncated: parsed.truncated };
}
