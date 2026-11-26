import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type SetStateAction,
} from 'react';
import { motion } from 'framer-motion';
import { Check, ChevronRight, Search, X } from '@droidex/icons';

import { FileTypeIcon } from '../../../components/FileTypeIcon';
import { navigateTree } from '../../../components/files/treeNavigation';
import { Input } from '../../../components/ui/Field';
import type { DiffFile } from '../../../types/vcs';
import {
  flattenPrFileTree,
  prFileTreeNodes,
  type PrFileTreeNode,
  type PrFileTreeRow,
} from '../lib/prFileTree';

export const PR_FILE_TREE_ID = 'pull-request-file-tree';

function DirectoryRowContent({ row, expanded }: { row: PrFileTreeRow; expanded: boolean }) {
  return (
    <>
      <span className="flex size-7 shrink-0 items-center justify-center text-muted">
        <ChevronRight
          className={`size-icon-sm transition-transform duration-quick ${expanded ? 'rotate-90' : ''}`}
        />
      </span>
      <FileTypeIcon filename={row.name} isDirectory expanded={expanded} className="size-icon-sm" />
      <span className="min-w-0 flex-1 truncate">{row.name}</span>
    </>
  );
}

function FileRowContent({
  row,
  viewed,
  onToggleViewed,
}: {
  row: Extract<PrFileTreeRow, { kind: 'file' }>;
  viewed: boolean;
  onToggleViewed: (path: string) => void;
}) {
  const file = row.file;
  return (
    <>
      <button
        type="button"
        role="checkbox"
        aria-checked={viewed}
        aria-label={`Mark ${file.path} as ${viewed ? 'unreviewed' : 'reviewed'}`}
        title={viewed ? 'Mark as unreviewed' : 'Mark as reviewed'}
        onClick={(event) => {
          event.stopPropagation();
          onToggleViewed(file.path);
        }}
        className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:text-primary"
      >
        <span
          className={`flex size-4 items-center justify-center rounded transition-colors duration-quick ${
            viewed ? 'bg-accent text-bg' : 'bg-elevated group-hover:bg-active'
          }`}
        >
          {viewed ? <Check size={11} strokeWidth={3} /> : null}
        </span>
      </button>
      <span
        className={`flex min-w-0 flex-1 items-center gap-1.5 transition-opacity duration-quick ${
          viewed ? 'opacity-55' : ''
        }`}
      >
        <FileTypeIcon filename={file.path} className="size-icon-sm" />
        <span className="min-w-0 flex-1 truncate">{row.name}</span>
        {file.additions > 0 || file.deletions > 0 ? (
          <span className="shrink-0 text-caption tabular-nums">
            {file.additions > 0 ? (
              <span style={{ color: 'var(--diff-add-fg)' }}>+{file.additions}</span>
            ) : null}
            {file.additions > 0 && file.deletions > 0 ? ' ' : null}
            {file.deletions > 0 ? (
              <span style={{ color: 'var(--diff-del-fg)' }}>−{file.deletions}</span>
            ) : null}
          </span>
        ) : null}
      </span>
    </>
  );
}

function FileTreeRowView({
  row,
  expanded,
  selected,
  viewed,
  tabIndex,
  onActivate,
  onToggleViewed,
}: {
  row: PrFileTreeRow;
  expanded: boolean;
  selected: boolean;
  viewed: boolean;
  tabIndex: number;
  onActivate: (row: PrFileTreeRow) => void;
  onToggleViewed: (path: string) => void;
}) {
  let content: ReactNode;
  if (row.kind === 'directory') content = <DirectoryRowContent row={row} expanded={expanded} />;
  else content = <FileRowContent row={row} viewed={viewed} onToggleViewed={onToggleViewed} />;

  return (
    <div
      role="treeitem"
      data-tree-path={row.relative}
      aria-level={row.depth + 1}
      aria-expanded={row.kind === 'directory' ? expanded : undefined}
      aria-selected={row.kind === 'file' ? selected : undefined}
      tabIndex={tabIndex}
      title={row.relative}
      onClick={() => {
        onActivate(row);
      }}
      className={`file-tree-row group flex h-control-sm w-full select-none items-center gap-1 rounded-md pr-2 text-body transition-colors duration-quick ${
        selected ? 'bg-active text-primary' : 'text-secondary hover:bg-elevated hover:text-primary'
      }`}
      style={{ paddingLeft: `${String(4 + row.depth * 14)}px` }}
    >
      {content}
    </div>
  );
}

function ancestorPaths(path: string): string[] {
  const ancestors: string[] = [];
  let slash = path.indexOf('/');
  while (slash > 0) {
    ancestors.push(path.slice(0, slash));
    slash = path.indexOf('/', slash + 1);
  }
  return ancestors;
}

// The hideable tree of changed files beside the diff. It renders the nested
// hierarchy so each directory's fold can animate closed around its subtree;
// the flat navigation rows are the same tree with collapsed subtrees skipped.
// The root is a motion element inside the parent's AnimatePresence, so hiding
// the panel slides it out instead of dropping it.
export function PrFileTree({
  files,
  activePath,
  viewedFiles,
  filter,
  collapsedDirectories,
  onFilterChange,
  onCollapsedDirectoriesChange,
  onSelect,
  onToggleViewed,
}: {
  files: DiffFile[];
  activePath: string | null;
  viewedFiles: ReadonlySet<string>;
  filter: string;
  collapsedDirectories: ReadonlySet<string>;
  onFilterChange: (filter: string) => void;
  onCollapsedDirectoriesChange: Dispatch<SetStateAction<Set<string>>>;
  onSelect: (path: string) => void;
  onToggleViewed: (path: string) => void;
}) {
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  const treeRef = useRef<HTMLDivElement>(null);

  const visibleFiles = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return files;
    return files.filter((file) => file.path.toLowerCase().includes(query));
  }, [files, filter]);
  const nodes = useMemo(() => prFileTreeNodes(visibleFiles), [visibleFiles]);
  const rows = useMemo(
    () => flattenPrFileTree(nodes, collapsedDirectories),
    [nodes, collapsedDirectories],
  );
  const expandedDirectories = useMemo(
    () =>
      new Set(
        rows
          .filter((row) => row.kind === 'directory' && !collapsedDirectories.has(row.relative))
          .map((row) => row.relative),
      ),
    [rows, collapsedDirectories],
  );

  const toggleDirectory = useCallback(
    (path: string) => {
      onCollapsedDirectoriesChange((current) => {
        const next = new Set(current);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        return next;
      });
    },
    [onCollapsedDirectoriesChange],
  );

  const activateRow = useCallback(
    (row: PrFileTreeRow) => {
      if (row.kind === 'directory') {
        toggleDirectory(row.relative);
        return;
      }
      onSelect(row.file.path);
    },
    [onSelect, toggleDirectory],
  );

  const focusTreeRow = useCallback((path: string) => {
    const row = treeRef.current?.querySelector<HTMLElement>(
      `[data-tree-path="${CSS.escape(path)}"]`,
    );
    row?.focus();
  }, []);

  useEffect(() => {
    if (!activePath) return;
    // The active file stays visible: collapse state is the reader's, but a
    // file they just jumped to is never hidden inside a folded directory.
    const ancestors = ancestorPaths(activePath);
    onCollapsedDirectoriesChange((current) => {
      if (!ancestors.some((path) => current.has(path))) return current;
      const next = new Set(current);
      for (const path of ancestors) next.delete(path);
      return next;
    });
    const frame = requestAnimationFrame(() => {
      const row = treeRef.current?.querySelector<HTMLElement>(
        `[data-tree-path="${CSS.escape(activePath)}"]`,
      );
      row?.scrollIntoView({ block: 'nearest' });
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [activePath, onCollapsedDirectoriesChange]);

  const tabbablePath =
    rows.find((row) => row.relative === focusedPath)?.relative ??
    rows.find((row) => row.relative === activePath)?.relative ??
    rows[0]?.relative;

  const onTreeKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const rowElement =
      event.target instanceof HTMLElement
        ? event.target.closest<HTMLElement>('[role="treeitem"]')
        : null;
    const path = rowElement?.dataset.treePath;
    if (!path) return;
    const row = rows.find((candidate) => candidate.relative === path);
    if (!row) return;

    if ((event.key === 'Enter' || event.key === ' ') && event.target === rowElement) {
      event.preventDefault();
      activateRow(row);
      return;
    }
    const action = navigateTree(rows, path, expandedDirectories, event.key);
    if (!action) return;
    event.preventDefault();
    if (action.type === 'toggle') toggleDirectory(action.path);
    else focusTreeRow(action.path);
  };

  const renderNode = (node: PrFileTreeNode): ReactNode => {
    const row = node.row;
    const expanded = !collapsedDirectories.has(row.relative);
    const rowView = (
      <FileTreeRowView
        key={row.key}
        row={row}
        expanded={expanded}
        selected={row.file?.path === activePath}
        viewed={row.file ? viewedFiles.has(row.file.path) : false}
        tabIndex={row.relative === tabbablePath ? 0 : -1}
        onActivate={activateRow}
        onToggleViewed={onToggleViewed}
      />
    );
    if (row.kind === 'file') return rowView;
    return (
      <div key={row.key}>
        {rowView}
        {/* The fold keeps the subtree mounted while closed: the grid track
            animates around it and the inert clip keeps it out of focus and
            the accessibility tree until it opens again. */}
        <div className="expand-rows" data-open={expanded || undefined}>
          <div
            inert={!expanded}
            role="group"
            className={`min-h-0 overflow-hidden transition-opacity duration-150 ease-out motion-reduce:transition-none ${
              expanded ? 'opacity-100' : 'opacity-0'
            }`}
          >
            {node.children.map((child) => renderNode(child))}
          </div>
        </div>
      </div>
    );
  };

  return (
    <motion.aside
      id={PR_FILE_TREE_ID}
      aria-label="Changed files"
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 12 }}
      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
      className="flex w-64 shrink-0 flex-col bg-surface"
    >
      <div className="shrink-0 px-2 pt-2 pb-1.5">
        <Input
          variant="compact"
          type="text"
          aria-label="Filter files"
          placeholder="Filter files"
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          leading={<Search className="size-icon-sm" />}
          actions={
            <button
              type="button"
              aria-label="Clear file filter"
              title="Clear file filter"
              disabled={!filter}
              onClick={() => {
                onFilterChange('');
              }}
              className={`flex size-7 items-center justify-center rounded-md text-muted transition-opacity duration-quick hover:bg-active hover:text-primary ${
                filter ? 'opacity-100' : 'opacity-0'
              }`}
            >
              <X className="size-icon-sm" />
            </button>
          }
          value={filter}
          onChange={(event) => {
            onFilterChange(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return;
            if (filter) {
              event.stopPropagation();
              onFilterChange('');
            } else {
              event.currentTarget.blur();
            }
          }}
        />
      </div>
      <div
        ref={treeRef}
        role="tree"
        aria-label="Changed files"
        className="pr-workspace-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-2"
        tabIndex={-1}
        onFocus={(event) => {
          const row =
            event.target instanceof HTMLElement
              ? event.target.closest<HTMLElement>('[role="treeitem"]')
              : null;
          if (row?.dataset.treePath) setFocusedPath(row.dataset.treePath);
        }}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setFocusedPath(null);
        }}
        onKeyDown={onTreeKeyDown}
      >
        {rows.length === 0 ? (
          <p className="px-2 py-3 text-body text-muted">No files match this filter.</p>
        ) : (
          nodes.map((node) => renderNode(node))
        )}
      </div>
    </motion.aside>
  );
}
