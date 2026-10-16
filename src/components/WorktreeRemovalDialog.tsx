import { AlertTriangle, Spinner, Trash } from '@droidex/icons';
import { useRef } from 'react';
import { worktreeName } from '../lib/git';
import type { GitWorktree } from '../types/vcs';
import { Button } from './ui/Button';
import { Dialog, DialogActions, DialogTitle } from './ui/Dialog';

interface WorktreeRemovalDialogProps {
  worktree: GitWorktree;
  changedFileCount: number | null;
  linkedSessionCount: number;
  isMerged: boolean;
  isChecking: boolean;
  isRemoving: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

function removalTitle(isChecking: boolean, hasUnsavedChanges: boolean): string {
  if (isChecking || !hasUnsavedChanges) return 'Delete this worktree?';
  return 'Delete worktree and discard changes?';
}

function removalActionLabel(isChecking: boolean, hasUnsavedChanges: boolean): string {
  if (isChecking) return 'Checking…';
  if (hasUnsavedChanges) return 'Delete anyway';
  return 'Delete worktree';
}

function RemovalStatus({
  changedFileCount,
  isChecking,
}: {
  changedFileCount: number | null;
  isChecking: boolean;
}) {
  if (isChecking) {
    return (
      <div className="flex items-center gap-2.5 text-body text-secondary">
        <Spinner className="size-icon-sm shrink-0 text-muted motion-safe:animate-spin-slow" />
        Checking for unsaved changes…
      </div>
    );
  }
  if (changedFileCount && changedFileCount > 0) {
    return (
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="mt-0.5 size-icon-sm shrink-0 text-danger" />
        <div>
          <p className="text-body-strong text-danger">
            {String(changedFileCount)} changed {changedFileCount === 1 ? 'file will' : 'files will'}{' '}
            be permanently discarded.
          </p>
          <p className="mt-1 text-body text-secondary">
            This includes modified and untracked files. This action cannot be undone.
          </p>
        </div>
      </div>
    );
  }
  return (
    <p className="text-body text-secondary">
      The worktree directory will be removed from this Mac.
    </p>
  );
}

export function WorktreeRemovalDialog({
  worktree,
  changedFileCount,
  linkedSessionCount,
  isMerged,
  isChecking,
  isRemoving,
  onCancel,
  onConfirm,
}: WorktreeRemovalDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const hasUnsavedChanges = (changedFileCount ?? 0) > 0;

  return (
    <Dialog
      role={hasUnsavedChanges ? 'alertdialog' : 'dialog'}
      onClose={onCancel}
      dismissible={!isRemoving}
      initialFocusRef={cancelRef}
      aria-describedby="worktree-removal-description"
      aria-busy={isChecking || isRemoving}
    >
      <DialogTitle>{removalTitle(isChecking, hasUnsavedChanges)}</DialogTitle>
      <p className="mt-1 text-body-strong text-secondary">{worktreeName(worktree)}</p>
      <p className="truncate text-caption text-muted" title={worktree.path ?? undefined}>
        {worktree.path}
      </p>

      <div
        id="worktree-removal-description"
        className={`mt-4 rounded-lg p-4 ${hasUnsavedChanges ? 'bg-danger-soft' : 'bg-elevated'}`}
      >
        <RemovalStatus changedFileCount={changedFileCount} isChecking={isChecking} />
      </div>

      <ul className="mt-4 space-y-2 text-body text-muted">
        {linkedSessionCount > 0 && (
          <li>
            {String(linkedSessionCount)} idle{' '}
            {linkedSessionCount === 1 ? 'conversation' : 'conversations'} will move to the main
            checkout.
          </li>
        )}
        <li>
          {isMerged
            ? 'Git will also delete the merged local branch.'
            : 'The local branch will stay unless Git confirms it is merged.'}
        </li>
      </ul>

      <DialogActions>
        <Button ref={cancelRef} variant="ghost" onClick={onCancel} disabled={isRemoving}>
          Cancel
        </Button>
        <Button
          variant="danger"
          icon={Trash}
          loading={isChecking || isRemoving}
          onClick={onConfirm}
          disabled={isChecking || isRemoving}
        >
          {removalActionLabel(isChecking, hasUnsavedChanges)}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
