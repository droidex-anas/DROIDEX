import { useState, type RefObject } from 'react';
import { Check, Search } from '@droidex/icons';
import { Input } from '../ui/Field';
import { Popover } from '../ui/Popover';
import { WorktreeIcon } from '../icons/WorktreeIcon';
import { worktreeName } from '../../lib/git';
import { searchItems } from '../../lib/searchMatch';
import { workspaceName } from '../../lib/workspaces';
import type { GitWorktree } from '../../types/vcs';

const ITEM_HOVER = 'hover:bg-elevated dark:hover:bg-active';

// Custom composer-bar glyph (16x16, currentColor) for the Local/machine pill.
export function LocalGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect x="2.5" y="3.5" width="11" height="8" rx="1.5" />
      <path d="M5 13h6" />
      <path d="M8 11.5V13" />
    </svg>
  );
}

// Where the composer's chat runs: a new worktree, the main checkout, or one of
// the repository's other worktrees, which the search narrows by name.
export function StartLocationMenu({
  open,
  onClose,
  anchorRef,
  mainCheckout,
  worktrees,
  currentPath,
  createsWorktree,
  onNewWorktree,
  onStartIn,
}: {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  mainCheckout: { path: string; branch?: string } | null;
  worktrees: GitWorktree[];
  currentPath: string;
  createsWorktree: boolean;
  onNewWorktree: () => void;
  onStartIn: (path: string, branch: string | undefined, executionMode: 'local') => void;
}) {
  const [query, setQuery] = useState('');
  const searching = query.trim() !== '';
  const shown = searchItems(query, worktrees, (w) => [
    worktreeName(w),
    workspaceName(w.path ?? ''),
  ]);
  const onLocal =
    !createsWorktree && !!mainCheckout && !worktrees.some((w) => w.path === currentPath);

  const close = () => {
    setQuery('');
    onClose();
  };
  const startIn = (path: string, branch: string | undefined) => {
    onStartIn(path, branch, 'local');
    close();
  };

  return (
    <Popover
      open={open}
      onClose={close}
      anchorRef={anchorRef}
      label="Worktrees"
      placement="bottom-start"
      width={280}
    >
      {worktrees.length > 0 && (
        <div className="flex items-center gap-2 bg-bg/40 px-2.5 py-2">
          <Search className="size-icon-sm shrink-0 text-muted" />
          <Input
            variant="embedded"
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
            }}
            onKeyDown={(e) => {
              const top = shown.at(0);
              if (e.key !== 'Enter' || !searching || !top?.path) return;
              e.preventDefault();
              startIn(top.path, top.branch ?? undefined);
            }}
            placeholder="Search worktrees"
            aria-label="Search worktrees"
          />
        </div>
      )}
      <div className="max-h-64 overflow-y-auto py-1">
        {!searching && (
          <>
            <button
              onClick={() => {
                onNewWorktree();
                close();
              }}
              aria-pressed={createsWorktree}
              className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors ${ITEM_HOVER}`}
            >
              <WorktreeIcon className="size-icon-sm shrink-0 text-muted" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body text-primary">New worktree</span>
                <span className="block truncate text-caption text-muted">
                  Isolated checkout for this chat
                </span>
              </span>
              {createsWorktree && (
                <Check aria-hidden="true" className="size-icon-sm shrink-0 text-accent" />
              )}
            </button>
            <button
              onClick={() => {
                if (mainCheckout) startIn(mainCheckout.path, mainCheckout.branch);
                else close();
              }}
              disabled={!mainCheckout}
              aria-pressed={onLocal}
              className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors enabled:hover:bg-elevated enabled:dark:hover:bg-active disabled:opacity-50"
            >
              <LocalGlyph className="size-icon-sm shrink-0 text-muted" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body text-primary">Work locally</span>
                <span className="block truncate text-caption text-muted">
                  {mainCheckout
                    ? `${mainCheckout.branch ?? 'detached'} · main checkout`
                    : 'Loading main checkout…'}
                </span>
              </span>
              {onLocal && (
                <Check aria-hidden="true" className="size-icon-sm shrink-0 text-accent" />
              )}
            </button>
          </>
        )}
        {searching && shown.length === 0 && (
          <p className="px-2.5 py-1.5 text-body text-muted">No worktrees match</p>
        )}
        {shown.map((w) => (
          <button
            key={w.path}
            onClick={() => {
              if (w.path) startIn(w.path, w.branch ?? undefined);
            }}
            aria-pressed={currentPath === w.path}
            className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors ${ITEM_HOVER}`}
          >
            <WorktreeIcon className="size-icon-sm shrink-0 text-muted" />
            <span className="min-w-0 flex-1 truncate text-body text-secondary">
              {worktreeName(w)}
            </span>
            {currentPath === w.path && (
              <Check aria-hidden="true" className="size-icon-sm shrink-0 text-accent" />
            )}
          </button>
        ))}
      </div>
    </Popover>
  );
}
