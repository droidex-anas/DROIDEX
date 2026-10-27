// A frame's revisions in its toolbar's History popover (spec §9): newest
// first, who made each and when, and Restore behind an inline confirm.

import { useRef } from 'react';
import { formatRelativeTime } from '../../lib/time';
import { revisionNumber, type FrameHistory, type HistoryState } from './frameHistory';
import { MenuHeading, MenuNote, MenuRow } from './menuRows';
import type { RevisionSummary } from './protocol';
import { MAX_REVISION_PAGE_SIZE } from './wireValidation';

const ACTION_CLASS =
  'shrink-0 cursor-pointer rounded-md px-1.5 py-0.5 text-[12px] font-medium text-droid-text transition-colors hover:bg-droid-elevated/50 focus-visible:bg-droid-elevated/50 focus-visible:outline-none';

export function RevisionHistory({
  history,
  state,
  headRevisionId,
  canRestore,
}: {
  history: FrameHistory;
  state: HistoryState;
  headRevisionId: string | null;
  /** False where this chat cannot write the canvas, so its history is read-only. */
  canRestore: boolean;
}) {
  const { list, restore } = state;
  const nameOf = (revisionId: string) => {
    const number = revisionNumber(list, revisionId);
    return number === null ? null : `v${String(number)}`;
  };
  return (
    <div className="min-h-0 overflow-y-auto p-1">
      <MenuHeading>History</MenuHeading>
      {restore.status === 'refused' && <MenuNote role="alert">{restore.message}</MenuNote>}
      {list.status === 'loading' && (
        <MenuNote role="status">Reading this frame’s history…</MenuNote>
      )}
      {list.status === 'failed' && (
        <>
          <MenuNote role="alert">{list.message}</MenuNote>
          <MenuRow
            label="Try again"
            onRun={() => {
              history.reload();
            }}
          />
        </>
      )}
      {list.status === 'listed' &&
        list.revisions.map((revision) => (
          <RevisionRow
            key={revision.revisionId}
            revision={revision}
            name={nameOf(revision.revisionId)}
            restoredFrom={
              revision.state === 'saved' && revision.restoredFromRevisionId
                ? nameOf(revision.restoredFromRevisionId)
                : null
            }
            isHead={revision.revisionId === headRevisionId}
            canRestore={canRestore}
            history={history}
            restore={restore}
          />
        ))}
      {list.status === 'listed' && !list.complete && (
        <MenuNote>{`The newest ${String(MAX_REVISION_PAGE_SIZE)} revisions.`}</MenuNote>
      )}
    </div>
  );
}

function RevisionRow({
  revision,
  name,
  restoredFrom,
  isHead,
  canRestore,
  history,
  restore,
}: {
  revision: RevisionSummary;
  /** `v3`, or null when the history is longer than one read. */
  name: string | null;
  restoredFrom: string | null;
  isHead: boolean;
  canRestore: boolean;
  history: FrameHistory;
  restore: HistoryState['restore'];
}) {
  const phase =
    'revisionId' in restore && restore.revisionId === revision.revisionId ? restore.status : 'idle';
  const called = name ?? 'this revision';
  const saved = revision.state === 'saved' ? revision : null;
  return (
    <div className="flex h-8 w-full items-center gap-2 rounded-lg px-2.5">
      <span className="min-w-0 flex-1 truncate text-[12px] text-droid-text">
        {phase === 'confirming' ? `Restore ${called}?` : describe(revision, name, restoredFrom)}
      </span>
      {phase === 'idle' && saved && (
        <span className="shrink-0 text-[11px] text-droid-text-muted">
          {isHead ? 'Current' : formatRelativeTime(saved.createdAt)}
        </span>
      )}
      {phase === 'restoring' && (
        <span role="status" className="shrink-0 text-[11px] text-droid-text-muted">
          Restoring…
        </span>
      )}
      {canRestore && !isHead && saved && phase !== 'restoring' && (
        <RestoreControls
          called={called}
          confirming={phase === 'confirming'}
          busy={restore.status === 'restoring'}
          onRestore={() => {
            if (phase === 'confirming') void history.restore();
            else history.confirm(revision.revisionId);
          }}
          onCancel={() => {
            history.cancel();
          }}
        />
      )}
    </div>
  );
}

/** Restore…, which asks first: the same button then confirms, beside Cancel. */
function RestoreControls({
  called,
  confirming,
  busy,
  onRestore,
  onCancel,
}: {
  called: string;
  confirming: boolean;
  /** Another revision is being restored. */
  busy: boolean;
  onRestore: () => void;
  onCancel: () => void;
}) {
  const action = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={action}
        type="button"
        aria-label={confirming ? `Restore ${called} as the current revision` : `Restore ${called}`}
        disabled={busy}
        className={ACTION_CLASS}
        onClick={onRestore}
      >
        {confirming ? 'Restore' : 'Restore…'}
      </button>
      {confirming && (
        <button
          type="button"
          className={ACTION_CLASS}
          onClick={() => {
            onCancel();
            action.current?.focus();
          }}
        >
          Cancel
        </button>
      )}
    </>
  );
}
/** "v3 · You edited it": who made the revision and how. */
function describe(
  revision: RevisionSummary,
  name: string | null,
  restoredFrom: string | null,
): string {
  const prefix = name === null ? '' : `${name} · `;
  if (revision.state === 'damaged') return `${prefix}Can’t be read`;
  const who = revision.author.kind === 'user' ? 'You' : 'Agent';
  const what = {
    create: 'created it',
    write: 'wrote it',
    edit: 'edited it',
    restore: `restored ${restoredFrom ?? 'an earlier one'}`,
  }[revision.mutationKind];
  const failed = revision.buildStatus === 'failed' ? ' · didn’t build' : '';
  return `${prefix}${who} ${what}${failed}`;
}
