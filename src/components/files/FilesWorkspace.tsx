import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  ChevronRight,
  ExternalLink,
  FolderSearch,
  PanelLeft,
  RefreshCw,
  Spinner,
  X,
  type IconComponent,
} from '@droidex/icons';
import { authorizeFilesRoot, listDirectory, openFileDefault, revealFile } from '../../lib/desktop';
import type { FilesEntry, FilesListing } from '../../lib/desktopContract';
import { pathFileName } from '../../lib/pathDisplay';
import { toast } from '../../lib/toast';
import { FileTypeIcon } from '../FileTypeIcon';
import { Button } from '../ui/Button';
import { Tooltip } from '../ui/Tooltip';
import { FilePreviewPane } from './FilePreviewPane';
import { navigateTree } from './treeNavigation';

const FILE_TREE_ID = 'files-workspace-tree';

interface VisibleEntry extends FilesEntry {
  relative: string;
  depth: number;
}

function normalizeRelative(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

function joinRelative(parent: string, name: string): string {
  return normalizeRelative(parent ? `${parent}/${name}` : name);
}

// Display-only join: unlike joinRelative, the root keeps its absolute form
// (leading slash, drive prefix) instead of being normalized away.
function fullDisplayPath(root: string, relative: string): string {
  return `${root.replace(/\\/g, '/').replace(/\/+$/g, '')}/${relative}`;
}

export function FilesWorkspace({
  root,
  selectedPath,
  onSelectPath,
}: {
  root: string;
  selectedPath?: string;
  onSelectPath: (relative: string) => void;
}) {
  const [listings, setListings] = useState<Partial<Record<string, FilesListing>>>({});
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['']));
  const [loading, setLoading] = useState<Set<string>>(() => new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [authorization, setAuthorization] = useState({ root: '', accessToken: '' });
  const [authorizationAttempt, setAuthorizationAttempt] = useState(0);
  const [treeCollapsed, setTreeCollapsed] = useState(false);
  const [focusedPath, setFocusedPath] = useState<string>();
  const treeRef = useRef<HTMLDivElement>(null);
  const focusedRowRef = useRef<HTMLElement | null>(null);
  const rootVersionRef = useRef(0);
  const accessToken = authorization.root === root ? authorization.accessToken : '';

  useLayoutEffect(() => {
    rootVersionRef.current += 1;
  }, [root]);

  const load = useCallback(
    async (relative: string, force = false) => {
      const key = normalizeRelative(relative);
      if (!accessToken || (!force && key in listings)) return;
      const requestVersion = rootVersionRef.current;
      setLoading((current) => new Set(current).add(key));
      setErrors((current) =>
        Object.fromEntries(Object.entries(current).filter(([k]) => k !== key)),
      );
      try {
        const listing = await listDirectory(accessToken, key);
        if (rootVersionRef.current !== requestVersion) return;
        setListings((current) => ({ ...current, [key]: listing }));
      } catch (reason) {
        if (rootVersionRef.current !== requestVersion) return;
        setErrors((current) => ({
          ...current,
          [key]: reason instanceof Error ? reason.message : String(reason),
        }));
      } finally {
        if (rootVersionRef.current === requestVersion) {
          setLoading((current) => {
            const next = new Set(current);
            next.delete(key);
            return next;
          });
        }
      }
    },
    [accessToken, listings],
  );

  useEffect(() => {
    let cancelled = false;
    setListings({});
    setExpanded(new Set(['']));
    setLoading(new Set());
    setErrors({});
    setAuthorization({ root: '', accessToken: '' });
    if (!root.trim()) {
      setErrors({ '': 'This session has no workspace folder.' });
      return;
    }
    // The token is kept even when the first listing fails, so Refresh can retry it.
    void authorizeFilesRoot(root)
      .then((token) => {
        if (cancelled) return;
        setAuthorization({ root, accessToken: token });
        return listDirectory(token, '').then((listing) => {
          if (!cancelled) setListings({ '': listing });
        });
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setErrors({ '': reason instanceof Error ? reason.message : String(reason) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [root, authorizationAttempt]);

  // Reloads every open folder in place and drops the cached listings of
  // closed ones, so they load fresh when opened again.
  const refresh = () => {
    if (!accessToken) {
      setAuthorizationAttempt((attempt) => attempt + 1);
      return;
    }
    setListings((current) =>
      Object.fromEntries(Object.entries(current).filter(([key]) => expanded.has(key))),
    );
    for (const key of expanded) void load(key, true);
  };

  const visible = useMemo(() => {
    const rows: VisibleEntry[] = [];
    const visit = (parent: string, depth: number) => {
      for (const entry of listings[parent]?.entries ?? []) {
        const relative = joinRelative(parent, entry.name);
        rows.push({ ...entry, relative, depth });
        if (entry.kind === 'directory' && expanded.has(relative)) {
          visit(relative, depth + 1);
        }
      }
    };
    visit('', 0);
    return rows;
  }, [expanded, listings]);

  const tabbablePath =
    visible.find((entry) => entry.relative === focusedPath)?.relative ??
    visible.find((entry) => entry.relative === selectedPath)?.relative ??
    visible[0]?.relative;

  const focusRow = (path: string) => {
    const row = Array.from(
      treeRef.current?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? [],
    ).find((element) => element.dataset.path === path);
    row?.focus();
  };

  useLayoutEffect(() => {
    const previous = focusedRowRef.current;
    if (
      treeCollapsed ||
      !previous ||
      previous.isConnected ||
      document.activeElement !== document.body
    )
      return;
    focusedRowRef.current = null;
    let ancestor = previous.dataset.path ?? '';
    while (ancestor.includes('/')) {
      ancestor = ancestor.slice(0, ancestor.lastIndexOf('/'));
      if (visible.some((entry) => entry.relative === ancestor)) {
        focusRow(ancestor);
        return;
      }
    }
    if (tabbablePath) focusRow(tabbablePath);
  });

  const toggleDirectory = (relative: string) => {
    const willExpand = !expanded.has(relative);
    setExpanded((current) => {
      const next = new Set(current);
      if (willExpand) next.add(relative);
      else next.delete(relative);
      return next;
    });
    if (willExpand) void load(relative);
  };

  const relative = selectedPath ?? '';
  const fileName = relative ? pathFileName(relative) : '';
  // A bare `/` or drive-letter root has no file name; show the root itself.
  const rootName = pathFileName(root) || root;
  const crumbs = relative ? [rootName, ...relative.split('/')] : rootName ? [rootName] : [];

  const handleOpenExternal = useCallback(() => {
    if (!accessToken || !relative) return;
    void openFileDefault(accessToken, relative).catch((reason: unknown) =>
      toast.error(reason instanceof Error ? reason.message : String(reason)),
    );
  }, [accessToken, relative]);

  const handleReveal = useCallback(() => {
    if (!accessToken || !relative) return;
    void revealFile(accessToken, relative).catch((reason: unknown) =>
      toast.error(reason instanceof Error ? reason.message : String(reason)),
    );
  }, [accessToken, relative]);

  const rootListing = listings[''];

  return (
    <div className="files-workspace flex h-full min-h-0 bg-bg">
      {/* Always mounted so the collapse animation can run: while collapsed the
          tree is inert and hidden from assistive technology immediately, not
          only after the exit finishes. */}
      <motion.section
        id={FILE_TREE_ID}
        initial={false}
        animate={
          treeCollapsed
            ? { width: 0, minWidth: 0, opacity: 0 }
            : { width: '34%', minWidth: 150, opacity: 1 }
        }
        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        inert={treeCollapsed}
        aria-hidden={treeCollapsed}
        className="flex h-full shrink-0 flex-col overflow-hidden bg-surface"
      >
        <header className="flex h-9 shrink-0 select-none items-center gap-1.5 pl-3 pr-1">
          <FileTypeIcon filename={root} isDirectory expanded className="size-icon-sm" />
          <span className="min-w-0 flex-1 truncate text-label text-secondary" title={root}>
            {rootName}
          </span>
          <HeaderButton label="Refresh files" icon={RefreshCw} onClick={refresh} />
        </header>
        <div
          ref={treeRef}
          className="min-h-0 flex-1 overflow-auto px-1 pb-1"
          role="tree"
          aria-label="Session files"
          onFocus={(event) => {
            const row = event.target.closest<HTMLElement>('[role="treeitem"]');
            if (row) {
              focusedRowRef.current = row;
              setFocusedPath(row.dataset.path);
            }
          }}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) {
              focusedRowRef.current = null;
            }
          }}
          onKeyDown={(event) => {
            if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
            const path =
              event.target instanceof HTMLElement
                ? event.target.closest<HTMLElement>('[role="treeitem"]')?.dataset.path
                : undefined;
            if (!path) return;
            const action = navigateTree(visible, path, expanded, event.key);
            if (!action) return;
            event.preventDefault();
            if (action.type === 'toggle') toggleDirectory(action.path);
            else focusRow(action.path);
          }}
        >
          {!rootListing && !errors[''] && (
            <div className="flex items-center gap-2 px-2 py-3 text-body text-muted">
              <Spinner className="size-icon-sm motion-safe:animate-spin-slow" />
              Loading files…
            </div>
          )}
          {errors[''] && <p className="px-2 py-3 text-body text-danger">{errors['']}</p>}
          {visible.map((entry) => (
            <FileTreeRow
              key={entry.relative}
              entry={entry}
              selected={entry.relative === relative}
              expanded={expanded.has(entry.relative)}
              loading={loading.has(entry.relative)}
              error={errors[entry.relative]}
              tabIndex={entry.relative === tabbablePath ? 0 : -1}
              onClick={() => {
                setFocusedPath(entry.relative);
                if (entry.kind === 'directory') toggleDirectory(entry.relative);
                else onSelectPath(entry.relative);
              }}
            />
          ))}
          {rootListing?.capped && (
            <p className="px-2 py-2 text-caption text-warning">
              Showing {rootListing.entries.length} of {rootListing.totalSeen} entries.
            </p>
          )}
        </div>
      </motion.section>

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-9 shrink-0 items-center gap-1 pl-2 pr-1">
          {relative && (
            <div className="flex h-control-sm min-w-0 items-center gap-1.5 rounded-md bg-elevated pl-2 pr-1">
              <FileTypeIcon filename={fileName} className="size-icon-sm" />
              <span className="min-w-0 truncate text-label text-primary">{fileName}</span>
              <button
                type="button"
                aria-label="Close file"
                title="Close file"
                onClick={() => {
                  onSelectPath('');
                }}
                className="flex size-5 shrink-0 items-center justify-center rounded-sm text-muted transition-colors hover:bg-active hover:text-primary"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}
          <div className="flex-1" />
          {relative && (
            <>
              <HeaderButton
                label="Open externally"
                icon={ExternalLink}
                onClick={handleOpenExternal}
              />
              <HeaderButton
                label="Reveal in Finder / Explorer"
                icon={FolderSearch}
                onClick={handleReveal}
              />
            </>
          )}
        </header>
        <div className="flex h-control-sm shrink-0 items-center gap-1 pl-3 pr-1">
          <nav
            className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden text-caption"
            aria-label="File path"
            title={relative ? fullDisplayPath(root, relative) : root}
          >
            {crumbs.map((segment, index) => {
              const isLast = index === crumbs.length - 1;
              return (
                <span
                  key={`${String(index)}-${segment}`}
                  className="flex min-w-0 items-center gap-1"
                >
                  {index > 0 && <ChevronRight className="h-2.5 w-2.5 shrink-0 text-muted/50" />}
                  <span className={`truncate ${isLast ? 'text-primary' : 'max-w-32 text-muted'}`}>
                    {segment}
                  </span>
                </span>
              );
            })}
          </nav>
          <Tooltip label={treeCollapsed ? 'Show file tree' : 'Hide file tree'} placement="bottom">
            <Button
              variant="ghost"
              size="sm"
              icon={PanelLeft}
              aria-label={treeCollapsed ? 'Show file tree' : 'Hide file tree'}
              aria-expanded={!treeCollapsed}
              aria-controls={FILE_TREE_ID}
              onClick={() => {
                setTreeCollapsed((current) => !current);
              }}
            />
          </Tooltip>
        </div>
        <FilePreviewPane
          accessToken={accessToken}
          relative={relative}
          onOpenExternal={handleOpenExternal}
          onReveal={handleReveal}
        />
      </section>
    </div>
  );
}

function HeaderButton({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: IconComponent;
  onClick: () => void;
}) {
  return (
    <Tooltip label={label} placement="bottom">
      <Button variant="ghost" size="sm" icon={icon} aria-label={label} onClick={onClick} />
    </Tooltip>
  );
}

function FileTreeRow({
  entry,
  selected,
  expanded,
  loading,
  error,
  tabIndex,
  onClick,
}: {
  entry: VisibleEntry;
  selected: boolean;
  expanded: boolean;
  loading: boolean;
  error?: string;
  tabIndex: number;
  onClick: () => void;
}) {
  const chevron =
    entry.kind !== 'directory' ? null : loading ? (
      <Spinner className="h-3 w-3 motion-safe:animate-spin-slow" />
    ) : (
      <ChevronRight
        className={`h-3 w-3 transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
      />
    );
  return (
    <>
      <button
        type="button"
        role="treeitem"
        data-path={entry.relative}
        tabIndex={tabIndex}
        aria-level={entry.depth + 1}
        aria-selected={selected}
        aria-expanded={entry.kind === 'directory' ? expanded : undefined}
        onClick={onClick}
        title={entry.relative}
        className={`file-tree-row flex h-control-sm w-full select-none items-center gap-1.5 rounded-md pr-2 text-left text-body transition-colors ${
          selected
            ? 'bg-active text-primary'
            : 'text-secondary hover:bg-elevated hover:text-primary'
        }`}
        style={{ paddingLeft: `${String(6 + entry.depth * 14)}px` }}
      >
        <span className="flex h-4 w-4 shrink-0 items-center justify-center">{chevron}</span>
        <FileTypeIcon
          filename={entry.name}
          isDirectory={entry.kind === 'directory'}
          expanded={expanded}
          className="size-icon-sm"
        />
        <span className="min-w-0 flex-1 truncate">{entry.name}</span>
      </button>
      {error && (
        <p
          className="truncate py-1 pr-2 text-caption text-danger"
          style={{ paddingLeft: `${String(26 + entry.depth * 14)}px` }}
          title={error}
        >
          {error}
        </p>
      )}
    </>
  );
}
