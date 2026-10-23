import { useRef, useState } from 'react';
import { Check, FolderGit, FolderPlus } from '@droidex/icons';
import { Button } from '../ui/Button';
import { Popover } from '../ui/Popover';
import { WorktreeIcon } from '../icons/WorktreeIcon';

// Custom composer-bar glyph (16x16, currentColor) for the branch pill.
function BranchGlyph({ className }: { className?: string }) {
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
      <circle cx="5" cy="11" r="2" />
      <circle cx="11" cy="5" r="2" />
      <path d="M5 9V5.5A1.5 1.5 0 0 1 6.5 4H9" />
    </svg>
  );
}

import { StartBranchMenu } from './StartBranchMenu';
import { LocalGlyph, StartLocationMenu } from './StartLocationMenu';
import { shallowEqual, useStoreDispatch, useStoreSelector } from '../../hooks/useStore';
import { useGitEnvironment } from '../../hooks/useGitEnvironment';
import { pickDirectory } from '../../lib/desktop';
import { worktreeName } from '../../lib/git';
import { resolveMainCheckout } from '../../lib/chatWorkspace';
import { workspaceName } from '../../lib/workspaces';

// The pointer is the highlight in these popover lists: elevated on light,
// active on dark, where the raised layer already is the elevated rung.
const ITEM_HOVER = 'hover:bg-elevated dark:hover:bg-active';

/** Where a conversation will start, as the bar reads and writes it. */
export interface StartInSelection {
  cwd: string;
  executionMode: 'worktree' | 'local';
  branch?: string;
}

// The composer's "Start in" controls: pick the repository, choose an isolated
// worktree or the local checkout, and select the starting ref. It drives the
// composer's own draft by default; a caller with a draft of its own, such as the
// new-project form, passes it in and gets the same controls over it.
export function StartInBar({
  value,
  onChange,
}: {
  value?: StartInSelection;
  onChange?: (next: StartInSelection) => void;
} = {}) {
  const dispatch = useStoreDispatch();
  const state = useStoreSelector(
    (current) => ({
      draftChat: current.draftChat,
      workspaceCwds: current.workspaceCwds,
    }),
    shallowEqual,
  );
  const draft = value ?? state.draftChat;
  const cwd = draft?.cwd ?? '';
  // 'uncommitted' so the branch-switch warning counts only working-tree changes
  // that a checkout would carry over, not committed work, which stays put.
  const { env, branches, worktrees, diffStat, refresh } = useGitEnvironment(cwd, 'uncommitted');

  const [repoOpen, setRepoOpen] = useState(false);
  const [locOpen, setLocOpen] = useState(false);
  const [branchOpen, setBranchOpen] = useState(false);
  const repoRef = useRef<HTMLButtonElement>(null);
  const locRef = useRef<HTMLButtonElement>(null);
  const branchRef = useRef<HTMLButtonElement>(null);

  if (!draft) return null;

  const mainCheckout = env ? resolveMainCheckout(env, worktrees) : null;
  const repoRoot = mainCheckout?.path ?? env?.repoRoot ?? cwd;
  const isRepo = !!env?.isRepo;
  const base = draft.branch ?? env?.branch ?? env?.head ?? env?.defaultBranch ?? 'main';
  const localWorktrees = worktrees.filter((w) => !w.bare && w.path);
  // Match on the resolved worktree root, not the raw draft cwd, so a chat whose
  // cwd is a subdirectory of a worktree still maps to that worktree.
  const currentWtPath = env?.worktreePath ?? cwd;
  const currentWt = localWorktrees.find((w) => w.path === currentWtPath && w.path !== repoRoot);
  const createsWorktree = draft.executionMode === 'worktree';
  let workLocationLabel = 'Local';
  if (createsWorktree) workLocationLabel = 'New worktree';
  else if (currentWt) workLocationLabel = worktreeName(currentWt);

  const startIn = (
    path: string,
    branch?: string,
    executionMode: 'worktree' | 'local' = 'worktree',
  ) => {
    if (onChange) {
      onChange({ cwd: path, executionMode, ...(branch ? { branch } : {}) });
      return;
    }
    // Moving the draft keeps what it starts, a chat or a project.
    dispatch({
      type: 'START_CHAT',
      cwd: path,
      executionMode,
      branch,
      ...(state.draftChat?.project ? { project: true } : {}),
    });
  };

  const openFolder = async () => {
    setRepoOpen(false);
    const dir = await pickDirectory();
    if (dir) {
      dispatch({ type: 'ADD_WORKSPACE', cwd: dir });
      startIn(dir);
    }
  };

  // A draft with no folder yet, such as a project started from nowhere in
  // particular, offers only the way to choose one.
  if (!cwd)
    return (
      <div className="flex min-w-0 items-center gap-4 overflow-hidden">
        <Button
          variant="ghost"
          size="sm"
          icon={<FolderPlus className="size-icon-sm" />}
          labelClassName="max-w-36"
          shrinkable
          title="Project: Open folder…"
          aria-label="Project: Open folder…"
          onClick={() => void openFolder()}
        >
          Open folder…
        </Button>
      </div>
    );

  return (
    <div className="flex min-w-0 items-center gap-4 overflow-hidden">
      <Button
        ref={repoRef}
        variant="ghost"
        size="sm"
        icon={<FolderGit className="size-icon-sm" />}
        labelClassName="max-w-36"
        shrinkable
        title={`Project: ${workspaceName(repoRoot)}`}
        aria-label={`Project: ${workspaceName(repoRoot)}`}
        aria-expanded={repoOpen}
        aria-haspopup="dialog"
        onClick={() => {
          setLocOpen(false);
          setBranchOpen(false);
          setRepoOpen((v) => !v);
        }}
      >
        {workspaceName(repoRoot)}
      </Button>
      <Popover
        open={repoOpen}
        onClose={() => {
          setRepoOpen(false);
        }}
        anchorRef={repoRef}
        label="Projects"
        placement="bottom-start"
        width={264}
      >
        <div className="max-h-64 overflow-y-auto py-1">
          {state.workspaceCwds.map((path) => (
            <button
              key={path}
              onClick={() => {
                startIn(path);
                setRepoOpen(false);
              }}
              aria-pressed={path === repoRoot}
              className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors ${ITEM_HOVER}`}
            >
              <FolderGit className="size-icon-sm shrink-0 text-muted" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body text-primary">{workspaceName(path)}</span>
                <span className="block truncate text-caption text-muted">{path}</span>
              </span>
              {path === repoRoot && (
                <Check aria-hidden="true" className="size-icon-sm shrink-0 text-accent" />
              )}
            </button>
          ))}
        </div>
        <div className="bg-bg/40 p-1.5">
          <button
            onClick={() => {
              void openFolder();
            }}
            className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-body text-primary transition-colors ${ITEM_HOVER}`}
          >
            <FolderPlus className="size-icon-sm shrink-0 text-muted" />
            Open folder…
          </button>
        </div>
      </Popover>

      {isRepo && (
        <>
          <Button
            ref={locRef}
            variant="ghost"
            size="sm"
            icon={
              createsWorktree ? (
                <WorktreeIcon className="size-icon-sm" />
              ) : (
                <LocalGlyph className="size-icon-sm" />
              )
            }
            labelClassName="max-w-36"
            shrinkable
            title={`Work in: ${workLocationLabel}`}
            aria-label={`Work in: ${workLocationLabel}`}
            aria-expanded={locOpen}
            aria-haspopup="dialog"
            onClick={() => {
              setRepoOpen(false);
              setBranchOpen(false);
              setLocOpen((v) => !v);
            }}
          >
            {workLocationLabel}
          </Button>
          <StartLocationMenu
            open={locOpen}
            onClose={() => {
              setLocOpen(false);
            }}
            anchorRef={locRef}
            mainCheckout={mainCheckout}
            worktrees={localWorktrees.filter((w) => w.path !== repoRoot)}
            currentPath={currentWtPath}
            createsWorktree={createsWorktree}
            onNewWorktree={() => {
              startIn(repoRoot, draft.branch ?? env.branch ?? undefined, 'worktree');
            }}
            onStartIn={startIn}
          />

          <Button
            ref={branchRef}
            variant="ghost"
            size="sm"
            icon={<BranchGlyph className="size-icon-sm" />}
            labelClassName="max-w-36"
            shrinkable
            title={`Branch: ${draft.branch ?? env.branch ?? 'detached'}`}
            aria-label={`Branch: ${draft.branch ?? env.branch ?? 'detached'}`}
            aria-expanded={branchOpen}
            aria-haspopup="dialog"
            onClick={() => {
              setRepoOpen(false);
              setLocOpen(false);
              setBranchOpen((v) => !v);
            }}
          >
            {draft.branch ?? env.branch ?? 'detached'}
          </Button>
          <StartBranchMenu
            open={branchOpen}
            onClose={() => {
              setBranchOpen(false);
            }}
            anchorRef={branchRef}
            cwd={cwd}
            env={env}
            branches={branches}
            worktrees={worktrees}
            uncommittedFiles={diffStat?.files ?? 0}
            base={base}
            executionMode={draft.executionMode}
            onStartIn={startIn}
            onRefresh={refresh}
          />
        </>
      )}
    </div>
  );
}
