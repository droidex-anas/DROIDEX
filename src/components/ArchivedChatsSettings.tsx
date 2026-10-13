import { useState } from 'react';
import { ArchiveRestore, Trash } from '@droidex/icons';
import { shallowEqual, useStoreDispatch, useStoreSelector } from '../hooks/useStore';
import { archivedChats, chatDisplayTitle } from '../lib/chatMetadata';
import { formatRelativeTime } from '../lib/time';
import { workspaceName } from '../lib/workspaces';
import { SectionTitle } from './settingsKit';
import { Button } from './ui/Button';

// Settings > Archived chats: chats hidden from the sidebar live here. Restore
// brings a chat back to the normal list; delete removes it from the app
// permanently. Both are app-level metadata only — the underlying conversation
// data is never touched.
export function ArchivedChatsSettings() {
  const dispatch = useStoreDispatch();
  const { sessionOrder, sessions, chatMetadata } = useStoreSelector(
    (state) => ({
      sessionOrder: state.sessionOrder,
      sessions: state.sessions,
      chatMetadata: state.chatMetadata,
    }),
    shallowEqual,
  );
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const rows = archivedChats(sessionOrder.map((id) => sessions[id]).filter(Boolean), chatMetadata);
  const now = Date.now();

  return (
    <div className="max-w-2xl mx-auto">
      <SectionTitle
        title="Archived chats"
        sub="Hidden from your sidebar. Restore a chat to bring it back, or delete it for good."
      />
      {rows.length === 0 ? (
        <div className="rounded-xl bg-surface p-10 text-center">
          <p className="text-body text-secondary">No archived chats.</p>
        </div>
      ) : (
        <div className="divide-y divide-divider overflow-hidden rounded-xl bg-surface shadow-lg">
          {rows.map(({ session, archivedAt }) => {
            const title = chatDisplayTitle(session, chatMetadata[session.appSessionId]);
            return (
              <div
                key={session.appSessionId}
                data-testid="archived-chat-row"
                className="flex items-center gap-3 px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-body text-primary">{title}</div>
                  <div className="mt-0.5 truncate text-caption text-muted">
                    Archived {formatRelativeTime(archivedAt, now)}
                    {session.cwd ? ` · ${workspaceName(session.cwd)}` : ''}
                  </div>
                </div>
                {confirmingDelete === session.appSessionId ? (
                  <div className="flex shrink-0 items-center gap-2">
                    <span aria-live="polite" className="text-caption text-danger">
                      Delete permanently?
                    </span>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => {
                        dispatch({ type: 'DELETE_CHAT', appSessionId: session.appSessionId });
                        setConfirmingDelete(null);
                      }}
                    >
                      Delete
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      // The trash button unmounts when the confirm opens, so
                      // focus the safe action to keep keyboard users in place.
                      autoFocus
                      onClick={() => {
                        setConfirmingDelete(null);
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={ArchiveRestore}
                      title="Restore to sidebar"
                      aria-label={`Restore ${title}`}
                      onClick={() => {
                        dispatch({ type: 'RESTORE_CHAT', appSessionId: session.appSessionId });
                      }}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={Trash}
                      title="Delete permanently"
                      aria-label={`Delete ${title} permanently`}
                      onClick={() => {
                        setConfirmingDelete(session.appSessionId);
                      }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
