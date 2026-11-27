import type { DiffFile } from '../../../types/vcs';

interface PrFileTreeRowBase {
  key: string;
  relative: string;
  name: string;
  depth: number;
}

export interface PrFileTreeDirectoryRow extends PrFileTreeRowBase {
  kind: 'directory';
  file: null;
}

export interface PrFileTreeFileRow extends PrFileTreeRowBase {
  kind: 'file';
  file: DiffFile;
}

export type PrFileTreeRow = PrFileTreeDirectoryRow | PrFileTreeFileRow;

// The nested form of the same tree. Rendering needs it: a directory's
// collapsible container must own its descendants so the fold animation can
// clip them, even the ones a collapse hides from the flat navigation rows.
export interface PrFileTreeNode {
  row: PrFileTreeRow;
  children: PrFileTreeNode[];
}

interface MutableDirectory {
  name: string;
  path: string;
  directories: Map<string, MutableDirectory>;
  files: DiffFile[];
}

function directory(path: string, name: string): MutableDirectory {
  return { name, path, directories: new Map(), files: [] };
}

function byName(left: { name: string }, right: { name: string }): number {
  return left.name.localeCompare(right.name);
}

function byNameFile(left: DiffFile, right: DiffFile): number {
  const leftName = left.path.slice(left.path.lastIndexOf('/') + 1);
  const rightName = right.path.slice(right.path.lastIndexOf('/') + 1);
  return leftName.localeCompare(rightName) || left.path.localeCompare(right.path);
}

// The pull-request patch is a flat list of paths; the review tree is derived
// display state, rebuilt only when the patch or the filter changes.
export function prFileTreeNodes(files: readonly DiffFile[]): PrFileTreeNode[] {
  const root = directory('', '');
  for (const file of [...files].sort((left, right) => left.path.localeCompare(right.path))) {
    const parts = file.path.split('/').filter(Boolean);
    let current = root;
    for (const part of parts.slice(0, -1)) {
      const path = current.path ? `${current.path}/${part}` : part;
      let next = current.directories.get(part);
      if (!next) {
        next = directory(path, part);
        current.directories.set(part, next);
      }
      current = next;
    }
    current.files.push(file);
  }

  const visit = (current: MutableDirectory, depth: number): PrFileTreeNode[] => {
    const nodes: PrFileTreeNode[] = [];
    for (const child of [...current.directories.values()].sort(byName)) {
      nodes.push({
        row: {
          key: `directory:${child.path}`,
          kind: 'directory',
          relative: child.path,
          name: child.name,
          depth,
          file: null,
        },
        children: visit(child, depth + 1),
      });
    }
    for (const file of [...current.files].sort(byNameFile)) {
      nodes.push({
        row: {
          key: `file:${file.path}`,
          kind: 'file',
          relative: file.path,
          name: file.path.slice(file.path.lastIndexOf('/') + 1),
          depth,
          file,
        },
        children: [],
      });
    }
    return nodes;
  };
  return visit(root, 0);
}

// The rows keyboard navigation sees: depth-first, skipping everything inside
// a collapsed directory. Rendering uses the nested nodes instead, so a closed
// directory keeps its subtree mounted for the fold animation to clip.
export function flattenPrFileTree(
  nodes: readonly PrFileTreeNode[],
  collapsedDirectories: ReadonlySet<string>,
): PrFileTreeRow[] {
  const rows: PrFileTreeRow[] = [];
  const visit = (items: readonly PrFileTreeNode[]) => {
    for (const node of items) {
      rows.push(node.row);
      if (node.row.kind === 'directory' && !collapsedDirectories.has(node.row.relative)) {
        visit(node.children);
      }
    }
  };
  visit(nodes);
  return rows;
}
