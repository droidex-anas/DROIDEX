// A design's element tree, as its preview guest walks it: every marked element
// in document order with how many marked elements hold it, read a page at a
// time up to the cap the reporter stops each page at. Display data, read like
// the other direct answers.

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

/** The marked elements in document order as far as read, and whether the last page stopped before the last. */
export interface PreviewTree {
  nodes: PreviewTreeNode[];
  cap: number;
  truncated: boolean;
}

/** Asks for the page of the design's element tree that starts `from` marked elements in; the call itself answers. */
export function previewTreeScript(from: number): string {
  return `globalThis.__droidexCanvasPreview.tree(${JSON.stringify({ from })})`;
}

/**
 * `before` with the page that follows it added, or null when the answer is not
 * that page. Document order means a node is at most one level below the node
 * before it, across pages too, so a deeper jump refuses the answer.
 */
export function readPreviewTree(value: unknown, before: PreviewTree | null): PreviewTree | null {
  const parsed = readAnswer(value, MAX_PREVIEW_TREE_BYTES);
  if (!record(parsed) || parsed.cap !== MAX_PREVIEW_TREE_NODES) return null;
  if (parsed.from !== (before?.nodes.length ?? 0)) return null;
  if (typeof parsed.truncated !== 'boolean' || !Array.isArray(parsed.nodes)) return null;
  if (parsed.nodes.length > MAX_PREVIEW_TREE_NODES) return null;
  const nodes: PreviewTreeNode[] = before ? [...before.nodes] : [];
  for (const value of parsed.nodes) {
    const node = readTreeNode(value, nodes.at(-1)?.depth ?? -1);
    if (!node) return null;
    nodes.push(node);
  }
  return { nodes, cap: MAX_PREVIEW_TREE_NODES, truncated: parsed.truncated };
}

function readTreeNode(node: unknown, depthBefore: number): PreviewTreeNode | null {
  if (!record(node) || !present(node.elementId) || !present(node.tagName)) return null;
  if (!isInstancePath(node.instancePath) || !count(node.depth)) return null;
  if (node.depth > depthBefore + 1) return null;
  return {
    elementId: clampPreviewText(node.elementId),
    instancePath: node.instancePath,
    tagName: clampPreviewText(node.tagName),
    depth: node.depth,
  };
}
