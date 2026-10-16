import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import { ArrowUp, Search, X } from 'lucide-react';
import { Spinner } from '@droidex/icons';
import { ghostButton, primaryButton } from '../../src/components/buttonStyles';
import { loadWorkspaceCwds } from '../../src/hooks/persistedUiPreferences';
import type { DirectoryListing } from '../../src/lib/desktop';
import { wrapTabFocus } from '../../src/lib/focusTrap';
import { baseName, breadcrumb, describeListingError, joinPath } from './folderPaths';
import {
  Breadcrumbs,
  FOLDER_LIST_ID,
  folderOptionId,
  FolderRows,
  KeyHint,
  Places,
} from './FolderPickerParts';
import { EASE_OUT } from './GateLayout';

type ListDirectories = (path: string) => Promise<DirectoryListing>;

const MAX_WORKSPACES = 8;

/** Lets a Remote browser choose a folder on the laptop, which has no dialog it can open. */
export function pickRemoteDirectory(listDirectories: ListDirectories): Promise<string | null> {
  const opener = document.activeElement;
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (path: string | null) => {
      if (settled) return;
      settled = true;
      render(false);
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
      resolve(path);
    };
    const render = (open: boolean) => {
      root.render(
        <MotionConfig reducedMotion="user">
          <AnimatePresence
            onExitComplete={() => {
              // Unmounting inside React's own commit is not allowed.
              setTimeout(() => {
                root.unmount();
                host.remove();
              });
            }}
          >
            {open && <FolderPicker listDirectories={listDirectories} onDone={finish} />}
          </AnimatePresence>
        </MotionConfig>,
      );
    };
    render(true);
  });
}

interface Target {
  path: string;
  // The child folder to highlight once this folder lists, so going up keeps your place.
  focusName: string | null;
}

type Result = { target: Target; listing: DirectoryListing } | { target: Target; error: string };

function matchingFolders(directories: string[], query: string): string[] {
  if (!query) return directories;
  const prefix: string[] = [];
  const inside: string[] = [];
  for (const name of directories) {
    const lower = name.toLowerCase();
    if (lower.startsWith(query)) prefix.push(name);
    else if (lower.includes(query)) inside.push(name);
  }
  return [...prefix, ...inside];
}

function FolderPicker({
  listDirectories,
  onDone,
}: {
  listDirectories: ListDirectories;
  onDone: (path: string | null) => void;
}) {
  const [target, setTarget] = useState<Target>({ path: '~', focusName: null });
  const [result, setResult] = useState<Result | null>(null);
  const [listing, setListing] = useState<DirectoryListing | null>(null);
  const [home, setHome] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [workspaces] = useState(() => [...new Set(loadWorkspaceCwds())].slice(0, MAX_WORKSPACES));
  const [layout] = useState(() => ({
    sheet: window.matchMedia('(max-width: 639px)').matches,
    touch: window.matchMedia('(pointer: coarse)').matches,
    mac: /Mac|iPhone|iPad/.test(navigator.userAgent),
  }));
  // A touch screen has no keyboard cursor until a hardware keyboard moves it.
  const [showsCursor, setShowsCursor] = useState(!layout.touch);
  const dialogRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);

  const loading = result?.target !== target;
  const error = !loading && 'error' in result ? result.error : '';
  const problem = error ? describeListingError(error) : null;
  const rows = matchingFolders(listing?.directories ?? [], filter.trim().toLowerCase());
  const active = Math.min(activeIndex, rows.length - 1);
  const hasPlaces = workspaces.length > 0;
  const modifierLabel = layout.mac ? '⌘' : 'Ctrl';

  useEffect(() => {
    let current = true;
    listDirectories(target.path).then(
      (next) => {
        if (!current) return;
        setResult({ target, listing: next });
        setListing(next);
        if (target.path === '~') setHome(next.path);
        const focusIndex = target.focusName ? next.directories.indexOf(target.focusName) : -1;
        setActiveIndex(Math.max(focusIndex, 0));
      },
      (reason: unknown) => {
        if (!current) return;
        setResult({
          target,
          error: reason instanceof Error ? reason.message : 'Unable to open this folder.',
        });
      },
    );
    return () => {
      current = false;
    };
  }, [listDirectories, target]);

  useEffect(() => {
    // A phone keyboard covering half the sheet is worse than one extra tap to filter.
    if (layout.touch) dialogRef.current?.focus();
    else filterRef.current?.focus();
  }, [layout.touch]);

  useEffect(() => {
    document.getElementById(folderOptionId(active))?.scrollIntoView({ block: 'nearest' });
  }, [active, rows.length]);

  const open = (path: string, focusName: string | null = null) => {
    setFilter('');
    setTarget({ path, focusName });
    // Clicking a place or a crumb should leave the keyboard ready to keep browsing.
    if (!layout.touch) filterRef.current?.focus();
  };
  const openParent = () => {
    if (listing?.parent) open(listing.parent, baseName(listing.path));
  };
  const openActive = () => {
    const name = rows[active];
    if (listing && name) open(joinPath(listing.path, name));
  };
  const choose = () => {
    if (listing && !loading && !error) onDone(listing.path);
  };
  const canGoBack = problem !== null && !problem.retryable && listing !== null;

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    // The app behind this dialog has its own shortcuts; none of these keys are for it.
    event.stopPropagation();
    wrapTabFocus(event, dialogRef.current);
    const inFilter = event.target === filterRef.current;
    const navigable = inFilter || event.target === dialogRef.current;
    const modifier = event.metaKey || event.ctrlKey;
    if (event.key === 'Escape') {
      event.preventDefault();
      if (filter) setFilter('');
      else onDone(null);
    } else if (event.key === 'Enter' && modifier) {
      event.preventDefault();
      choose();
    } else if (!navigable || loading) {
      return;
    } else if (event.key === 'ArrowDown' && modifier) {
      event.preventDefault();
      openActive();
    } else if ((event.key === 'ArrowUp' && modifier) || (event.key === 'Backspace' && !filter)) {
      event.preventDefault();
      openParent();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setShowsCursor(true);
      setActiveIndex(Math.max(0, Math.min(rows.length - 1, active + step)));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      openActive();
    } else if (!inFilter && event.key.length === 1 && !modifier && !event.altKey) {
      // Typing anywhere in the dialog filters, like type-to-select in a native panel.
      filterRef.current?.focus();
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16 }}
      className="fixed inset-0 z-[1250] flex items-end justify-center bg-black/40 backdrop-blur-sm sm:items-center sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onDone(null);
      }}
    >
      <motion.div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="folder-picker-title"
        aria-busy={loading}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        initial={layout.sheet ? { y: '100%' } : { y: 8, scale: 0.985, opacity: 0 }}
        animate={layout.sheet ? { y: 0 } : { y: 0, scale: 1, opacity: 1 }}
        exit={layout.sheet ? { y: '100%' } : { y: 4, scale: 0.99, opacity: 0 }}
        transition={{ duration: layout.sheet ? 0.28 : 0.18, ease: EASE_OUT }}
        className={`flex w-full flex-col overflow-hidden bg-droid-raised text-droid-text shadow-droid outline-none ${
          layout.sheet
            ? 'h-[min(88dvh,720px)] rounded-t-2xl pb-[env(safe-area-inset-bottom)]'
            : `h-[min(600px,calc(100dvh-48px))] rounded-2xl ${hasPlaces ? 'max-w-[720px]' : 'max-w-[560px]'}`
        }`}
      >
        {layout.sheet && (
          <span
            aria-hidden
            className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-droid-active"
          />
        )}
        <header className="shrink-0 px-5 pb-3 pt-4 sm:px-6 sm:pt-5">
          <h2
            id="folder-picker-title"
            className="text-[15px] font-semibold tracking-[-0.015em] text-droid-text"
          >
            Choose a folder on your laptop
          </h2>
          <div className="mt-3 flex items-center gap-1.5">
            <button
              type="button"
              className={`${ghostButton} !w-8 shrink-0 !px-0`}
              disabled={!listing?.parent}
              aria-label="Parent folder"
              title={`Parent folder (${modifierLabel}↑)`}
              onClick={openParent}
            >
              <ArrowUp size={15} />
            </button>
            <Breadcrumbs crumbs={listing ? breadcrumb(listing.path, home) : []} open={open} />
            {loading && listing && (
              <motion.span
                initial={{ opacity: 0 }}
                animate={{ opacity: 1, transition: { delay: 0.15 } }}
                className="shrink-0"
              >
                <Spinner className="h-3.5 w-3.5 text-droid-text-muted motion-safe:animate-spin-slow" />
              </motion.span>
            )}
          </div>
          <label className="relative mt-3 block">
            <Search
              size={14}
              aria-hidden
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-droid-text-muted"
            />
            <input
              ref={filterRef}
              role="combobox"
              aria-label="Filter folders"
              aria-expanded="true"
              aria-controls={FOLDER_LIST_ID}
              aria-autocomplete="list"
              aria-activedescendant={rows.length > 0 ? folderOptionId(active) : undefined}
              value={filter}
              placeholder="Filter folders"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="h-9 w-full rounded-lg bg-droid-elevated pl-8 pr-8 text-[16px] text-droid-text transition-colors duration-150 placeholder:text-droid-text-muted focus:outline-none focus-visible:bg-droid-active sm:text-[13px]"
              onChange={(event) => {
                setFilter(event.target.value);
                setActiveIndex(0);
              }}
            />
            {filter && (
              <button
                type="button"
                aria-label="Clear filter"
                className="absolute right-1.5 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-md text-droid-text-muted hover:bg-droid-elevated hover:text-droid-text"
                onClick={() => {
                  setFilter('');
                  filterRef.current?.focus();
                }}
              >
                <X size={13} />
              </button>
            )}
          </label>
        </header>

        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          {hasPlaces && (
            <Places
              home={home}
              workspaces={workspaces}
              currentPath={listing?.path ?? null}
              open={open}
            />
          )}
          <div
            id={FOLDER_LIST_ID}
            role="listbox"
            aria-label={listing ? `Folders in ${baseName(listing.path)}` : 'Folders'}
            className={`min-h-0 flex-1 overflow-y-auto px-3 pb-2 transition-opacity duration-150 ${
              hasPlaces ? 'sm:pl-1' : ''
            } ${loading && listing ? 'pointer-events-none opacity-50' : ''}`}
          >
            <FolderRows
              rows={rows}
              filter={filter}
              active={showsCursor ? active : -1}
              ready={listing !== null}
              problem={problem}
              recoverLabel={canGoBack ? `Back to ${baseName(listing.path)}` : 'Try again'}
              recover={() => {
                if (canGoBack) open(listing.path);
                else setTarget({ ...target });
              }}
              setActive={setActiveIndex}
              openFolder={(name) => {
                if (listing) open(joinPath(listing.path, name));
              }}
            />
          </div>
        </div>

        <footer className="flex shrink-0 items-center gap-2 bg-droid-bg/30 px-5 py-3.5 sm:px-6">
          {!layout.touch && (
            <p className="mr-auto hidden items-center gap-3 text-[11px] text-droid-text-muted md:flex">
              <KeyHint keys="↑↓" label="Move" />
              <KeyHint keys="↵" label="Open" />
              <KeyHint keys="⌫" label="Back" />
              <KeyHint keys={`${modifierLabel}↵`} label="Choose" />
            </p>
          )}
          <button
            type="button"
            className={`${ghostButton} ${layout.sheet ? '!h-11 flex-1 !text-[14px]' : 'ml-auto'}`}
            onClick={() => {
              onDone(null);
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            className={`${primaryButton} ${layout.sheet ? '!h-11 flex-1 !text-[14px]' : ''}`}
            disabled={!listing || loading || error !== ''}
            onClick={choose}
          >
            Use this folder
          </button>
        </footer>
      </motion.div>
    </motion.div>
  );
}
