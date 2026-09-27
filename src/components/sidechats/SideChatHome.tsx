import { useMemo } from 'react';
import { shallowEqual, useStoreDispatch, useStoreSelector } from '../../hooks/useStore';
import { PROVIDER_MARKS } from '../../features/providers/providerIdentity';
import { sessionIsLive } from '../../lib/sessions';
import {
  MAX_RUNNING_SIDE_CHATS,
  isSideChatOf,
  sideChatPanel,
  sideChatSettings,
} from '../../lib/sideChats';
import { formatRelativeTime } from '../../lib/time';
import type { SessionSummary } from '../../types/bridge';
import { ModelIcon } from '../ModelIcon';
import { SideChatComposer } from './SideChatComposer';
import { SideChatHarnessPicker } from './SideChatHarnessPicker';
import { runningSideChatCount, useStartSideChat } from './useStartSideChat';

/* A session's side chats, newest first, over the composer that starts the next
   one. Each row carries its harness mark, since a side chat can run on a
   different harness than the chat it asks about. */

export function SideChatHome({
  source,
  draft,
}: {
  source: SessionSummary;
  // A question handed back by a start that failed.
  draft: string;
}) {
  const dispatch = useStoreDispatch();
  const startSideChat = useStartSideChat();
  const sourceAppSessionId = source.appSessionId;
  const state = useStoreSelector(
    (current) => ({
      sessions: current.sessions,
      harness: sideChatPanel(current.sideChats, sourceAppSessionId).harness,
      harnessModels: current.harnessModels,
      running: runningSideChatCount(current, sourceAppSessionId),
    }),
    shallowEqual,
  );
  const sideChats = useMemo(
    () =>
      Object.values(state.sessions)
        .filter((session) => isSideChatOf(session, sourceAppSessionId))
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [state.sessions, sourceAppSessionId],
  );
  const settings = sideChatSettings(source, state.harness, state.harnessModels);
  const now = Date.now();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {sideChats.length === 0 ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-[12px] text-droid-text-muted">
            Ask about this chat without adding to it. The answer stays here.
          </div>
        ) : (
          sideChats.map((session) => (
            <SideChatRow
              key={session.appSessionId}
              session={session}
              now={now}
              onOpen={() => {
                dispatch({
                  type: 'SHOW_SIDE_CHAT',
                  sourceAppSessionId,
                  view: { kind: 'chat', appSessionId: session.appSessionId },
                });
              }}
            />
          ))
        )}
      </div>
      <SideChatComposer
        key={draft}
        initialText={draft}
        placeholder="Ask a side question"
        live={false}
        {...(state.running >= MAX_RUNNING_SIDE_CHATS
          ? { blockedReason: `${String(MAX_RUNNING_SIDE_CHATS)} side chats running` }
          : {})}
        leading={
          <SideChatHarnessPicker
            settings={settings}
            onChange={(harness) => {
              dispatch({ type: 'CHOOSE_SIDE_CHAT_HARNESS', sourceAppSessionId, harness });
            }}
          />
        }
        onSend={(text) => startSideChat(sourceAppSessionId, text)}
      />
    </div>
  );
}

function SideChatRow({
  session,
  now,
  onOpen,
}: {
  session: SessionSummary;
  now: number;
  onOpen: () => void;
}) {
  const live = sessionIsLive(session);
  const ago = formatRelativeTime(session.updatedAt, now);
  return (
    <button
      type="button"
      onClick={onOpen}
      title={session.title}
      data-testid="side-chat-row"
      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-droid-elevated/50 focus-visible:bg-droid-elevated/50 focus-visible:outline-none"
    >
      <ModelIcon provider={PROVIDER_MARKS[session.provider]} size={15} />
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-droid-text">
        {session.title}
      </span>
      {live ? (
        <span className="shimmer-text shrink-0 text-[12px] font-medium">Working</span>
      ) : (
        <span className="shrink-0 text-[12px] tabular-nums text-droid-text-muted">
          {ago === 'now' ? 'just now' : `${ago} ago`}
        </span>
      )}
    </button>
  );
}
