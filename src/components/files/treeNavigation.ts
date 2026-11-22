export interface TreeRow {
  relative: string;
  depth: number;
  kind: 'file' | 'directory';
}

type Navigation = { type: 'focus'; path: string } | { type: 'toggle'; path: string };

export function navigateTree(
  rows: readonly TreeRow[],
  path: string,
  expanded: ReadonlySet<string>,
  key: string,
): Navigation | null {
  const index = rows.findIndex((row) => row.relative === path);
  if (index < 0) return null;
  const row = rows[index];
  const focus = (target: TreeRow = row): Navigation => ({ type: 'focus', path: target.relative });
  switch (key) {
    case 'ArrowDown':
      return focus(rows[index + 1]);
    case 'ArrowUp':
      return focus(rows[index - 1]);
    case 'Home':
      return focus(rows[0]);
    case 'End':
      return focus(rows[rows.length - 1]);
    case 'ArrowRight':
      if (row.kind !== 'directory') return focus();
      if (!expanded.has(path)) return { type: 'toggle', path };
      return focus(rows[index + 1]?.depth > row.depth ? rows[index + 1] : row);
    case 'ArrowLeft':
      if (row.kind === 'directory' && expanded.has(path)) return { type: 'toggle', path };
      if (row.depth === 0) return focus();
      return focus(
        rows.find((candidate) => candidate.relative === path.slice(0, path.lastIndexOf('/'))),
      );
    default:
      return null;
  }
}
