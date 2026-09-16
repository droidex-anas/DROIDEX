import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ChevronRight,
  ExternalLink,
  FolderSearch,
  PanelLeft,
  RefreshCw,
  Spinner,
  X,
} from '@droidex/icons';
import {
  authorizeFilesRoot,
  listDirectory,
  openFileDefault,
  revealFile,
  type FilesEntry,
  type FilesListing,
} from '../../lib/desktop';
import { toast } from '../../lib/toast';
import { FileTypeIcon } from '../FileTypeIcon';
import { FilePreviewPane } from './FilePreviewPane';

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

function baseName(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/g, '').split('/').pop() ?? path;
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
  const [treeCollapsed, setTreeCollapsed] = useState(false);
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
    void authorizeFilesRoot(root)
      .then(async (token) => ({ token, listing: await listDirectory(token, '') }))
      .then(({ token, listing }) => {
        if (!cancelled) {
          setAuthorization({ root, accessToken: token });
          setListings({ '': listing });
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setErrors({ '': reason instanceof Error ? reason.message : String(reason) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [root]);

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
  const fileName = relative ? baseName(relative) : '';
  const rootName = baseName(root);
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
    <div className="files-workspace flex h-full min-h-0 bg-droid-bg">
      <AnimatePresence initial={false}>
        {!treeCollapsed && (
          <motion.section
            key="file-tree"
            initial={{ width: 0, minWidth: 0, opacity: 0 }}
            animate={{ width: '34%', minWidth: 150, opacity: 1 }}
            exit={{ width: 0, minWidth: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="flex h-full shrink-0 flex-col overflow-hidden border-r border-droid-border bg-droid-surface/25"
          >
            <header className="flex h-9 shrink-0 items-center gap-1.5 border-b border-droid-border pl-2.5 pr-1.5">
              <FileTypeIcon filename={root} isDirectory expanded className="h-3.5 w-3.5" />
              <span
                className="min-w-0 flex-1 truncate text-[12px] font-medium text-droid-text-secondary"
                title={root}
              >
                {rootName}
              </span>
              <HeaderButton title="Refresh files" onClick={() => void load('', true)}>
                <RefreshCw className="h-3.5 w-3.5" />
              </HeaderButton>
            </header>
            <div
              className="min-h-0 flex-1 overflow-auto px-1 py-1"
              role="tree"
              aria-label="Session files"
            >
              {!rootListing && !errors[''] && (
                <div className="flex items-center gap-2 px-2 py-3 text-xs text-droid-text-muted">
                  <Spinner className="h-3.5 w-3.5 motion-safe:animate-spin-slow" />
                  Loading files…
                </div>
              )}
              {errors[''] && (
                <p className="px-2 py-3 text-xs leading-relaxed text-red-300">{errors['']}</p>
              )}
              {visible.map((entry) => (
                <FileTreeRow
                  key={entry.relative}
                  entry={entry}
                  selected={entry.relative === relative}
                  expanded={expanded.has(entry.relative)}
                  loading={loading.has(entry.relative)}
                  error={errors[entry.relative]}
                  onClick={() => {
                    if (entry.kind === 'directory') toggleDirectory(entry.relative);
                    else onSelectPath(entry.relative);
                  }}
                />
              ))}
              {rootListing?.capped && (
                <p className="px-2 py-2 text-[11px] text-amber-300">
                  Showing {rootListing.entries.length} of {rootListing.totalSeen} entries.
                </p>
              )}
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-9 shrink-0 items-center gap-1 border-b border-droid-border pl-2 pr-1.5">
          {relative && (
            <div className="flex h-7 min-w-0 items-center gap-1.5 rounded-lg border border-droid-border/60 bg-droid-elevated/40 pl-2 pr-1">
              <FileTypeIcon filename={fileName} className="h-3.5 w-3.5" />
              <span className="min-w-0 truncate text-[12px] text-droid-text">{fileName}</span>
              <button
                type="button"
                aria-label="Close file"
                title="Close file"
                onClick={() => {
                  onSelectPath('');
                }}
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-droid-text-muted transition-colors hover:bg-droid-elevated/60 hover:text-droid-text"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}
          <div className="flex-1" />
          {relative && (
            <>
              <HeaderButton title="Open externally" onClick={handleOpenExternal}>
                <ExternalLink className="h-3.5 w-3.5" />
              </HeaderButton>
              <HeaderButton title="Reveal in Finder / Explorer" onClick={handleReveal}>
                <FolderSearch className="h-3.5 w-3.5" />
              </HeaderButton>
            </>
          )}
        </header>
        <div className="flex h-7 shrink-0 items-center gap-1 border-b border-droid-border pl-2.5 pr-1.5">
          <nav
            className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden text-[11px]"
            aria-label="File path"
            title={relative ? joinRelative(root, relative) : root}
          >
            {crumbs.map((segment, index) => {
              const isLast = index === crumbs.length - 1;
              return (
                <span
                  key={`${String(index)}-${segment}`}
                  className="flex min-w-0 items-center gap-1"
                >
                  {index > 0 && (
                    <ChevronRight className="h-2.5 w-2.5 shrink-0 text-droid-text-muted/50" />
                  )}
                  <span
                    className={`truncate ${
                      isLast ? 'text-droid-text' : 'max-w-[120px] text-droid-text-muted'
                    }`}
                  >
                    {segment}
                  </span>
                </span>
              );
            })}
          </nav>
          <button
            type="button"
            title={treeCollapsed ? 'Show file tree' : 'Hide file tree'}
            aria-label={treeCollapsed ? 'Show file tree' : 'Hide file tree'}
            aria-pressed={treeCollapsed}
            onClick={() => {
              setTreeCollapsed((current) => !current);
            }}
            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-droid-accent/60 ${
              treeCollapsed
                ? 'bg-droid-active text-droid-text'
                : 'text-droid-text-muted hover:bg-droid-elevated/60 hover:text-droid-text'
            }`}
          >
            <PanelLeft className="h-3.5 w-3.5" />
          </button>
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
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-droid-text-muted transition-colors hover:bg-droid-elevated/60 hover:text-droid-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-droid-accent/60"
    >
      {children}
    </button>
  );
}

function FileTreeRow({
  entry,
  selected,
  expanded,
  loading,
  error,
  onClick,
}: {
  entry: VisibleEntry;
  selected: boolean;
  expanded: boolean;
  loading: boolean;
  error?: string;
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
        aria-selected={selected}
        aria-expanded={entry.kind === 'directory' ? expanded : undefined}
        onClick={onClick}
        title={entry.relative}
        className={`file-tree-row flex h-7 w-full items-center gap-1.5 rounded-md pr-2 text-left text-[12px] transition-colors ${
          selected
            ? 'bg-droid-active text-droid-text'
            : 'text-droid-text-secondary hover:bg-droid-elevated/60 hover:text-droid-text'
        }`}
        style={{ paddingLeft: `${String(6 + entry.depth * 14)}px` }}
      >
        <span className="flex h-4 w-4 shrink-0 items-center justify-center">{chevron}</span>
        <FileTypeIcon
          filename={entry.name}
          isDirectory={entry.kind === 'directory'}
          expanded={expanded}
          className="h-3.5 w-3.5"
        />
        <span className="min-w-0 flex-1 truncate">{entry.name}</span>
      </button>
      {error && (
        <p
          className="truncate py-1 pr-2 text-[11px] text-red-300"
          style={{ paddingLeft: `${String(26 + entry.depth * 14)}px` }}
          title={error}
        >
          {error}
        </p>
      )}
    </>
  );
}
