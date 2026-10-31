// The version button and its history (spec §10): every saved version, newest
// first, with who saved it and when. Choosing an older one shows it read-only.

import { useRef, useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { Menu } from '../../../components/ui/Menu';
import { useStoreSelector, type AppState } from '../../../hooks/useStore';
import { chatDisplayTitle } from '../../../lib/chatMetadata';
import { canvasClient } from '../canvasClient';
import { canvasMessage } from '../client';
import type { DesignSystemVersionEntry, SavedBy } from '../protocol';

type VersionList =
  | { status: 'loading' }
  | { status: 'failed'; message: string }
  | { status: 'listed'; versions: DesignSystemVersionEntry[] };

const MINUTE_MS = 60_000;

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
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<VersionList>({ status: 'loading' });
  // Only the newest opening's answer may land.
  const requestRef = useRef(0);

  const openMenu = () => {
    setOpen(true);
    setList({ status: 'loading' });
    requestRef.current += 1;
    const request = requestRef.current;
    canvasClient.designSystems.versions(id).then(
      (versions) => {
        if (request === requestRef.current) setList({ status: 'listed', versions });
      },
      (error: unknown) => {
        if (request === requestRef.current)
          setList({ status: 'failed', message: canvasMessage(error) });
      },
    );
  };

  return (
    <>
      <Button
        ref={anchorRef}
        variant="ghost"
        size="sm"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`v${String(shown)}, version history`}
        onClick={() => {
          if (open) setOpen(false);
          else openMenu();
        }}
        className="tabular-nums"
      >
        v{shown}
      </Button>
      <Menu
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        anchorRef={anchorRef}
        label="Version history"
        width={280}
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
            <Menu.Item
              key={entry.version}
              role="menuitemradio"
              aria-checked={entry.version === shown}
              onSelect={() => {
                onShow(entry.version);
              }}
            >
              <VersionLabel entry={entry} />
            </Menu.Item>
          ))}
      </Menu>
    </>
  );
}

function VersionLabel({ entry }: { entry: DesignSystemVersionEntry }) {
  const author = useStoreSelector((state) => authorName(state, entry.savedBy));
  return (
    <span className="min-w-0 truncate tabular-nums">
      v{entry.version} · {author} · {savedAgo(entry.savedAt, Date.now())}
    </span>
  );
}

function authorName(state: AppState, savedBy: SavedBy): string {
  if (savedBy.actor === 'user') return 'You';
  const { appSessionId } = savedBy;
  if (!(appSessionId in state.sessions)) return 'Agent';
  return `Agent in ${chatDisplayTitle(state.sessions[appSessionId], state.chatMetadata[appSessionId])}`;
}

function savedAgo(savedAt: string, now: number): string {
  const minutes = Math.floor((now - Date.parse(savedAt)) / MINUTE_MS);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${String(minutes)} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? '1 hour ago' : `${String(hours)} hours ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${String(days)} days ago`;
  return new Date(savedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
