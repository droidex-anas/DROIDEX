import { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronRight } from 'lucide-react';
import type { RemoteSession } from '../../packages/remote/src/application';

export function AgentList({
  sessions,
  ready,
  open,
}: {
  sessions: RemoteSession[];
  ready: boolean;
  open: (session: RemoteSession) => Promise<void>;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const rows = useVirtualizer({
    count: sessions.length,
    getScrollElement: () => scroll.current,
    estimateSize: () => 78,
    getItemKey: (index) => sessions[index].id,
    overscan: 4,
  });
  if (!sessions.length)
    return (
      <div className="empty">
        <p>No active sessions yet.</p>
        <span className="muted">
          Start a task below. It runs in your selected laptop workspace.
        </span>
      </div>
    );
  return (
    <div
      className="session-list"
      ref={scroll}
      style={{ height: rows.getTotalSize() }}
      aria-label="Agents"
    >
      <div className="session-spacer" style={{ height: rows.getTotalSize() }}>
        {rows.getVirtualItems().map((item) => {
          const session = sessions[item.index];
          return (
            <div
              className="session-item"
              key={item.key}
              data-index={item.index}
              ref={rows.measureElement}
              style={{ transform: `translateY(${String(item.start)}px)` }}
            >
              <button className="session-row" disabled={!ready} onClick={() => void open(session)}>
                <div>
                  <strong>{session.title}</strong>
                  <span className="muted">{session.provider}</span>
                </div>
                <SessionStatus status={session.status} />
                <ChevronRight size={17} className="muted" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function SessionStatus({ status }: { status: RemoteSession['status'] }) {
  return (
    <span className={`session-status ${status}`}>
      <span className="status-dot" />
      {status === 'waiting' ? 'Needs approval' : status}
    </span>
  );
}
