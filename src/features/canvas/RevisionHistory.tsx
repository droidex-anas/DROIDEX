// A frame's versions in its toolbar menu (spec §9): newest first, numbered
// from v1, the one on show checked. Choosing another switches the frame to it.

import type { RefObject } from 'react';
import { Check } from '@droidex/icons';
import { Menu } from '../../components/ui/Menu';
import { cn } from '../../components/ui/cn';
import { formatRelativeTime } from '../../lib/time';
import { toast } from '../../lib/toast';
import type { FrameHistory, RevisionList } from './frameHistory';
import type { RevisionSummary } from './protocol';
import { MAX_REVISION_PAGE_SIZE } from './wireValidation';

const MENU_WIDTH_PX = 200;

export function RevisionHistory({
  open,
  onClose,
  anchorRef,
  frameName,
  history,
  list,
  headRevisionId,
  canSwitch,
}: {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  frameName: string;
  history: FrameHistory;
  list: RevisionList;
  headRevisionId: string | null;
  /** False where this chat cannot write the canvas, so its versions are read-only. */
  canSwitch: boolean;
}) {
  const switchTo = (revisionId: string) => {
    void history.switchTo(revisionId).then((refusal) => {
      if (refusal) toast.error(refusal);
    });
  };
  return (
    <Menu
      open={open}
      onClose={onClose}
      anchorRef={anchorRef}
      placement="bottom-start"
      width={MENU_WIDTH_PX}
      label={`Versions of ${frameName}`}
      className="max-h-72"
    >
      {list.status === 'loading' && <Menu.Label role="status">Reading versions…</Menu.Label>}
      {list.status === 'failed' && (
        <>
          <Menu.Label role="alert" className="text-danger">
            {list.message}
          </Menu.Label>
          <Menu.Item
            onClick={(event) => {
              // Keeps the menu open, so the versions appear where the error was.
              event.preventDefault();
              history.reload();
            }}
            onSelect={() => undefined}
          >
            Try again
          </Menu.Item>
        </>
      )}
      {list.status === 'listed' &&
        list.revisions.map((revision) => (
          <VersionItem
            key={revision.revisionId}
            revision={revision}
            isCurrent={revision.revisionId === headRevisionId}
            canSwitch={canSwitch}
            onSwitch={switchTo}
          />
        ))}
      {list.status === 'listed' && !list.complete && (
        <Menu.Label>{`The newest ${String(MAX_REVISION_PAGE_SIZE)} versions`}</Menu.Label>
      )}
    </Menu>
  );
}

function VersionItem({
  revision,
  isCurrent,
  canSwitch,
  onSwitch,
}: {
  revision: RevisionSummary;
  isCurrent: boolean;
  canSwitch: boolean;
  onSwitch: (revisionId: string) => void;
}) {
  const saved = revision.state === 'saved' ? revision : null;
  return (
    <Menu.Item
      role="menuitemradio"
      aria-checked={isCurrent}
      disabled={!saved || (!canSwitch && !isCurrent)}
      onSelect={() => {
        if (!isCurrent) onSwitch(revision.revisionId);
      }}
    >
      <span className="min-w-0 flex-1 truncate tabular-nums">{`v${String(revision.version)}`}</span>
      <span className="shrink-0 text-caption text-muted">
        {saved ? formatRelativeTime(saved.createdAt) : 'Can’t be read'}
      </span>
      <Check
        className={cn('size-icon-sm shrink-0 text-accent', !isCurrent && 'invisible')}
        aria-hidden="true"
      />
    </Menu.Item>
  );
}
