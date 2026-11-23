// The version button and its history (spec §10): every saved version, newest
// first, with what it changed and when it was saved. The latest is checked and
// the one on screen highlighted; choosing an older one shows it read-only.

import { useRef } from 'react';
import { Check } from '@droidex/icons';
import { Button } from '../../../components/ui/Button';
import { cn } from '../../../components/ui/cn';
import { Menu } from '../../../components/ui/Menu';
import { formatRelativeTime } from '../../../lib/time';
import type { DesignSystemVersionEntry } from '@droidex/protocol';
import { useVersionHistory } from './useVersionHistory';

export function VersionMenu({
  id,
  shown,
  onShow,
}: {
  id: string;
  shown: number;
  onShow: (version: number) => void;
}) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const { open, list, summarized, close, openMenu } = useVersionHistory(id);

  const latest = list.status === 'listed' ? list.versions.at(0)?.version : undefined;
  return (
    <>
      <Button
        ref={anchorRef}
        variant="ghost"
        size="sm"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          if (open) close();
          else openMenu();
        }}
        className="tabular-nums"
      >
        Version {shown}
      </Button>
      <Menu
        open={open}
        onClose={close}
        anchorRef={anchorRef}
        label="Version history"
        width={300}
        className="max-h-80"
      >
        {list.status === 'loading' && <Menu.Label>Reading versions…</Menu.Label>}
        {list.status === 'failed' && (
          <p role="alert" className="px-2 py-1.5 text-body text-danger">
            {list.message}
          </p>
        )}
        {list.status === 'listed' &&
          list.versions.map((entry) => (
            <VersionRow
              key={entry.version}
              entry={entry}
              summary={summarized.get(entry.version)}
              isShown={entry.version === shown}
              isLatest={entry.version === latest}
              onShow={onShow}
            />
          ))}
      </Menu>
    </>
  );
}

function VersionRow({
  entry,
  summary,
  isShown,
  isLatest,
  onShow,
}: {
  entry: DesignSystemVersionEntry;
  summary: string | undefined;
  isShown: boolean;
  isLatest: boolean;
  onShow: (version: number) => void;
}) {
  return (
    <Menu.Item
      role="menuitemradio"
      aria-checked={isShown}
      onSelect={() => {
        onShow(entry.version);
      }}
      className={cn(isShown && 'bg-elevated/60 dark:bg-active/60')}
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-baseline gap-2">
          <span className={cn('min-w-0 flex-1 truncate', isShown && 'text-body-strong')}>
            Version {entry.version}
            {isLatest && <span className="sr-only">, latest</span>}
          </span>
          <span className="shrink-0 text-caption tabular-nums text-muted">
            {formatRelativeTime(Date.parse(entry.savedAt))}
          </span>
        </span>
        {/* The line keeps its height while the summary is read, so rows do not jump. */}
        <span className="truncate text-caption text-muted">{summary ?? '\u00a0'}</span>
      </span>
      <Check
        className={cn('size-icon-sm shrink-0 text-accent', !isLatest && 'invisible')}
        aria-hidden="true"
      />
    </Menu.Item>
  );
}
