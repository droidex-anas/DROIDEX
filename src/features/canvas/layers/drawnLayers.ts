// Which drawn element each element row of a frame's outline is, read from the
// tree of marked elements its live preview draws. A row's element is looked for
// only among what the element of its nearest element row draws, so a row under
// one component instance never takes another instance's element. A drawn
// element no row is written for gets a row of its own, under the row of the
// nearest element holding it, so nothing drawn is missing from the panel.

import type { PreviewNode } from '../previewDocument';
import type { PreviewTree, PreviewTreeNode } from '../previewDocumentTree';
import type { OutlineNode, SourceOutline } from '../protocol';

/** Where an element row is drawn, or why its row cannot pick it. */
export type Drawn =
  | { state: 'drawn'; node: PreviewNode }
  /** Its copies are drawn, but which drawn element is this row's cannot be told. */
  | { state: 'ambiguous' }
  /** Being read from the preview. */
  | { state: 'reading' }
  /** Not read: the preview is not running, could not answer, or stopped before it. */
  | { state: 'unread' }
  /** The preview draws none of it here. */
  | { state: 'absent' };

export interface DrawnLayers {
  /** Each element row's drawn element, or why it has none, by nodeId. */
  drawn: ReadonlyMap<string, Drawn>;
  /** Rows for drawn elements no outline row is written for; siblings keep document order. */
  unwritten: OutlineNode[];
  /** The nodeId of the row each drawn element is on, by instancePath. */
  rowAt: ReadonlyMap<string, string>;
}

/** What one row can be found as, where it is found several ways: the most a pick can use wins. */
const RANK: Record<Drawn['state'], number> = {
  absent: 0,
  unread: 1,
  reading: 1,
  ambiguous: 2,
  drawn: 3,
};

/** The body, which holds the marked elements no marked element holds. */
const ROOT = -1;

interface Written {
  node: OutlineNode;
  elementId: string;
  /** A repeat stands between it and its nearest element row, so it may be drawn many times. */
  repeated: boolean;
}

export function drawnLayers(outline: SourceOutline, tree: PreviewTree): DrawnLayers {
  const { nodes } = tree;
  const childrenOf = new Map<number, number[]>([[ROOT, []]]);
  const holders: number[] = [];
  nodes.forEach((node, index) => {
    holders.length = node.depth;
    childrenOf.get(holders.at(-1) ?? ROOT)?.push(index);
    childrenOf.set(index, []);
    holders.push(index);
  });
  // A walk that stopped at its cap may not have reached all the children of
  // the last element it read and of every element holding it.
  const unfinished = new Set(tree.truncated ? [ROOT, ...holders] : []);
  const written = writtenRows(outline);

  const drawn = new Map<string, Drawn>();
  const unwritten: OutlineNode[] = [];
  const rowAt = new Map<string, string>();
  const settle = (nodeId: string, next: Drawn) => {
    const now = drawn.get(nodeId);
    if (!now || RANK[next.state] > RANK[now.state]) drawn.set(nodeId, next);
  };
  /** Settles `scope`'s rows, and theirs in turn, where its element is not drawn here. */
  const settleWithin = (scope: string, state: 'ambiguous' | 'unread' | 'absent') => {
    const pending = [scope];
    for (let at = pending.pop(); at !== undefined; at = pending.pop()) {
      for (const { node } of written.get(at) ?? []) {
        settle(node.nodeId, { state });
        pending.push(node.nodeId);
      }
    }
  };

  // Each element row found drawn is looked in for its own rows' elements, in
  // document order, so a row drawn many times goes to its first instance.
  const scopes: { scope: string | null; holder: number }[] = [{ scope: null, holder: ROOT }];
  for (const { scope, holder } of scopes) {
    const rows = written.get(scope) ?? [];
    const found = drawnWithin(holder, scope, new Set(rows.map((row) => row.elementId)));
    const finished = !unfinished.has(holder);
    for (const copies of byElement(rows).values()) {
      const instances = found.get(copies[0].elementId) ?? [];
      const paired =
        copies.length === 1 ||
        (instances.length === copies.length && !copies.some((copy) => copy.repeated));
      const unknown = instances.length === 0 || (!finished && instances.length < copies.length);
      copies.forEach(({ node }, index) => {
        const mine = copies.length === 1 ? instances : instances.slice(index, index + 1);
        if (paired && mine.length > 0) {
          settle(node.nodeId, { state: 'drawn', node: previewNode(nodes[mine[0]]) });
          for (const instance of mine) {
            rowAt.set(nodes[instance].instancePath, node.nodeId);
            scopes.push({ scope: node.nodeId, holder: instance });
          }
          return;
        }
        let state: 'ambiguous' | 'unread' | 'absent' = 'ambiguous';
        if (unknown) state = finished ? 'absent' : 'unread';
        settle(node.nodeId, { state });
        settleWithin(node.nodeId, state);
      });
    }
  }
  return { drawn, unwritten, rowAt };

  /**
   * The marked elements `holder` draws that `scope` has rows for, by
   * elementId, looked for through the ones it has none for, which get rows of
   * their own under the row of the element holding them.
   */
  function drawnWithin(holder: number, scope: string | null, elementIds: ReadonlySet<string>) {
    const found = new Map<string, number[]>();
    // Children go on the stack last first, so the walk takes elements in document order.
    const childrenUnder = (at: number, rowId: string | null) =>
      (childrenOf.get(at) ?? []).map((index) => ({ index, rowId })).reverse();
    const pending = childrenUnder(holder, scope);
    for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
      const node = nodes[next.index];
      if (elementIds.has(node.elementId)) {
        const same = found.get(node.elementId);
        if (same) same.push(next.index);
        else found.set(node.elementId, [next.index]);
        continue;
      }
      const row = unwrittenRow(node, next.rowId);
      unwritten.push(row);
      drawn.set(row.nodeId, { state: 'drawn', node: previewNode(node) });
      rowAt.set(node.instancePath, row.nodeId);
      pending.push(...childrenUnder(next.index, row.nodeId));
    }
    return found;
  }
}

/** Each element row, by the nodeId of the nearest element row holding it; null for the root's. */
function writtenRows(outline: SourceOutline): Map<string | null, Written[]> {
  const written = new Map<string | null, Written[]>();
  /** What each row hands the rows it holds: their nearest element row, and whether a repeat came since. */
  const handed = new Map<string, { scope: string | null; repeated: boolean }>();
  for (const node of outline.nodes) {
    const fromParent = node.parentId === null ? undefined : handed.get(node.parentId);
    const { scope, repeated } = fromParent ?? { scope: null, repeated: false };
    if (node.kind === 'element' && node.elementId !== null) {
      const rows = written.get(scope);
      const row = { node, elementId: node.elementId, repeated };
      if (rows) rows.push(row);
      else written.set(scope, [row]);
      handed.set(node.nodeId, { scope: node.nodeId, repeated: false });
    } else {
      handed.set(node.nodeId, { scope, repeated: repeated || node.kind === 'repeat' });
    }
  }
  return written;
}

function byElement(rows: readonly Written[]): Map<string, Written[]> {
  const groups = new Map<string, Written[]>();
  for (const row of rows) {
    const group = groups.get(row.elementId);
    if (group) group.push(row);
    else groups.set(row.elementId, [row]);
  }
  return groups;
}

/** A drawn element's own row; a path is never a hex node id, so the two never meet. */
function unwrittenRow(node: PreviewTreeNode, parentId: string | null): OutlineNode {
  return {
    nodeId: `@${node.instancePath}`,
    parentId,
    kind: 'element',
    name: node.tagName,
    text: null,
    elementId: node.elementId,
    lock: null,
    free: false,
  };
}

function previewNode({ elementId, instancePath }: PreviewTreeNode): PreviewNode {
  return { elementId, instancePath };
}
