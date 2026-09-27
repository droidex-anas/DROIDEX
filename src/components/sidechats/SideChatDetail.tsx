import { useEffect, useMemo, useRef, type ReactNode, type RefObject } from 'react';
import { CornerDownLeft, GitFork } from '@droidex/icons';
import { shallowEqual, useStoreDispatch, useStoreSelector } from '../../hooks/useStore';
import { useForkChat, useForkPending } from '../../hooks/useForkChat';
import { useSessionHistory } from '../../hooks/useSessionHistory';
import type { SessionRestore } from '../../hooks/storeChildSession';
import { PROVIDER_LABELS, PROVIDER_MARKS } from '../../features/providers/providerIdentity';
import { interruptSession, loadSessionHistory } from '../../lib/commands';
import { sessionIsLive } from '../../lib/sessions';
import { MAX_RUNNING_SIDE_CHATS } from '../../lib/sideChats';
import { classifyEvent } from '../../lib/transcript';
import type { SessionSummary, TranscriptEvent } from '../../types/bridge';
import { isConversationAtLatest } from '../conversationListState';
import AskUserInline from '../AskUserInline';
import type { ConversationListHandle } from '../ConversationList';
import { MessageFeed } from '../MessageFeed';
import { ModelIcon } from '../ModelIcon';
import PermissionInline from '../PermissionInline';
import PlanApprovalInline from '../PlanApprovalInline';
import { SideChatComposer } from './SideChatComposer';
import { SideChatBackButton, SideChatHeader, SideChatHeaderButton } from './SideChatHeader';
import { runningSideChatCount, sendToSideChat } from './useAskSideChat';

const EMPTY_TRANSCRIPT: TranscriptEvent[] = [];
const SIDE_CHAT_HISTORY_PAGE_EVENTS = 240;

/* One side chat: its question and answers, and a composer to keep asking. It
   shows only what happened after it branched; the copied conversation above
   that is the source chat's, already on screen beside it. Its answer can be
   attached to the main composer, or the whole side chat can carry on as a chat
   of its own. */

export function SideChatDetail({
  sourceAppSessionId,
  session,
  wide,
  controls,
  onBack,
}: {
  sourceAppSessionId: string;
  session: SessionSummary;
  // Given the whole content row, the conversation takes the chat's measure.
  wide: boolean;
  controls: ReactNode;
  // Present when this is an earlier side chat rather than the session's current one.
  onBack?: () => void;
}) {
  const { appSessionId } = session;
  const dispatch = useStoreDispatch();
  const forkChat = useForkChat();
  const forking = useForkPending(appSessionId);
  useSessionHistory(appSessionId);
  const state = useStoreSelector(
    (current) => ({
      transcript: Object.hasOwn(current.transcripts, appSessionId)
        ? current.transcripts[appSessionId]
        : EMPTY_TRANSCRIPT,
      restore: current.sessionRestore[appSessionId],
      olderCursor: current.historyCursor[appSessionId],
      loadingOlder: current.historyLoadingOlder[appSessionId] ?? false,
      toolActivity: current.toolActivity,
      running: runningSideChatCount(current, sourceAppSessionId),
    }),
    shallowEqual,
  );
  const { transcript } = state;
  const forkedAt = session.lineage?.forkedAt ?? 0;
  // A side chat on another model starts with its copied history serialized
  // for that model, which the daemon records as a compaction; it is not one
  // the user needs to see here.
  const events = useMemo(
    () => transcript.filter((event) => event.ts >= forkedAt && event.kind !== 'compaction'),
    [transcript, forkedAt],
  );
  const reply = latestReply(events);
  // The restored window is the chat's latest page. Only when it starts after
  // the branch point can older side-chat messages still be missing from it.
  const olderCursor =
    transcript.length > 0 && transcript[0].ts >= forkedAt ? state.olderCursor : undefined;
  const live = sessionIsLive(session);

  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<ConversationListHandle>(null);
  const pinned = useFollowLatest(scrollRef, contentRef, listRef);

  const continueAsChat = (forkPointId?: string) => {
    forkChat(appSessionId, session.title, forkPointId);
  };

  const loadEarlier = () => {
    if (!olderCursor || state.loadingOlder) return;
    dispatch({ type: 'SESSION_HISTORY_LOADING_OLDER', appSessionId });
    loadSessionHistory(appSessionId, olderCursor, SIDE_CHAT_HISTORY_PAGE_EVENTS);
  };

  const retryRestore = () => {
    dispatch({ type: 'SESSION_RESTORE_START', appSessionId });
    loadSessionHistory(appSessionId);
  };

  const send = (text: string) => {
    if (!sendToSideChat(dispatch, appSessionId, text)) return false;
    pinned.current = true;
    return true;
  };

  return (
    <div data-testid="side-chat-detail" className="flex min-h-0 flex-1 flex-col">
      <SideChatHeader controls={controls}>
        {onBack && <SideChatBackButton onClick={onBack} />}
        <span title={PROVIDER_LABELS[session.provider]} className="flex shrink-0">
          <ModelIcon provider={PROVIDER_MARKS[session.provider]} size={15} />
        </span>
        <span
          title={session.title}
          className="min-w-0 flex-1 truncate text-[13px] font-medium text-droid-text"
        >
          {session.title}
        </span>
        <SideChatHeaderButton
          label="Send answer to chat"
          disabled={!reply}
          onClick={() => {
            dispatch({ type: 'ATTACH_SIDE_CHAT_REPLY', sourceAppSessionId, reply });
          }}
        >
          <CornerDownLeft className="h-3.5 w-3.5" />
        </SideChatHeaderButton>
        <SideChatHeaderButton
          label={forking ? 'Opening as chat…' : 'Continue as chat'}
          disabled={live || forking}
          onClick={() => {
            continueAsChat();
          }}
        >
          <GitFork className="h-3.5 w-3.5" />
        </SideChatHeaderButton>
      </SideChatHeader>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div
          ref={contentRef}
          className={`min-w-0 px-4 py-3 ${wide ? 'mx-auto max-w-4xl px-6 py-6' : ''}`}
        >
          {olderCursor && (
            <div className="pb-2 text-center">
              <button
                type="button"
                disabled={state.loadingOlder}
                onClick={loadEarlier}
                className="rounded-md px-2 py-1 text-[11px] text-droid-text-muted transition-colors hover:bg-droid-elevated hover:text-droid-text-secondary disabled:hover:bg-transparent"
              >
                {state.loadingOlder ? 'Loading earlier messages…' : 'Show earlier messages'}
              </button>
            </div>
          )}
          {events.length > 0 ? (
            <MessageFeed
              events={events}
              pending={live}
              scrollElementRef={scrollRef}
              listRef={listRef}
              density={state.toolActivity.density}
              inlineDiffs={state.toolActivity.inlineDiffs}
              onFork={continueAsChat}
              forking={forking}
            />
          ) : (
            <SideChatEmptyState restore={state.restore} onRetry={retryRestore} />
          )}
        </div>
      </div>

      <div className="shrink-0 px-3 empty:hidden">
        <PlanApprovalInline appSessionId={appSessionId} />
        <PermissionInline appSessionId={appSessionId} />
        <AskUserInline appSessionId={appSessionId} />
      </div>

      <SideChatComposer
        placeholder="Ask a follow-up"
        live={live}
        {...(!live && state.running >= MAX_RUNNING_SIDE_CHATS
          ? { blockedReason: `${String(MAX_RUNNING_SIDE_CHATS)} side chats running` }
          : {})}
        onSend={send}
        onStop={() => {
          interruptSession(appSessionId);
        }}
      />
    </div>
  );
}

function SideChatEmptyState({
  restore,
  onRetry,
}: {
  restore: SessionRestore | undefined;
  onRetry: () => void;
}) {
  if (restore?.status === 'failed') {
    return (
      <div className="flex flex-col items-center gap-2 pt-6 text-center">
        <span className="text-[12px] text-droid-text">Couldn&apos;t load this side chat</span>
        {restore.error && (
          <span className="text-[11px] text-droid-text-muted">{restore.error}</span>
        )}
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md bg-droid-elevated px-2.5 py-1 text-[11px] text-droid-text-secondary transition-colors hover:bg-droid-active"
        >
          Retry
        </button>
      </div>
    );
  }
  return (
    <p className="pt-6 text-center text-[12px] text-droid-text-muted">
      {restore?.status === 'loading' ? 'Loading side chat…' : 'Nothing in this side chat yet.'}
    </p>
  );
}

function latestReply(events: readonly TranscriptEvent[]): string {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.role !== 'primary' || classifyEvent(event) !== 'assistant_chat') continue;
    const text = typeof event.text === 'string' ? event.text.trim() : '';
    if (text) return text;
  }
  return '';
}

// Keeps a reader at the latest message pinned there while the answer grows,
// and leaves one who scrolled up where they are.
function useFollowLatest(
  scrollRef: RefObject<HTMLDivElement | null>,
  contentRef: RefObject<HTMLDivElement | null>,
  listRef: RefObject<ConversationListHandle | null>,
): RefObject<boolean> {
  const pinned = useRef(true);
  useEffect(() => {
    const scroll = scrollRef.current;
    const content = contentRef.current;
    if (!scroll || !content) return;
    const onScroll = () => {
      pinned.current = isConversationAtLatest(
        scroll.scrollHeight,
        scroll.scrollTop,
        scroll.clientHeight,
      );
    };
    const observer = new ResizeObserver(() => {
      if (pinned.current) listRef.current?.scrollToLatest();
    });
    scroll.addEventListener('scroll', onScroll, { passive: true });
    observer.observe(content);
    return () => {
      scroll.removeEventListener('scroll', onScroll);
      observer.disconnect();
    };
  }, [scrollRef, contentRef, listRef]);
  return pinned;
}
