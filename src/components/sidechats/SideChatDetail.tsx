import { useEffect, useMemo, useRef, type ReactNode, type RefObject } from 'react';
import { CornerDownLeft, GitFork } from '@droidex/icons';
import { shallowEqual, useStoreDispatch, useStoreSelector } from '../../hooks/useStore';
import { useForkChat, useForkPending } from '../../hooks/useForkChat';
import { useSessionHistory } from '../../hooks/useSessionHistory';
import { PROVIDER_LABELS, PROVIDER_MARKS } from '../../features/providers/providerIdentity';
import { interruptSession, sendToSession } from '../../lib/commands';
import { sessionIsLive } from '../../lib/sessions';
import { toast } from '../../lib/toast';
import { classifyEvent } from '../../lib/transcript';
import type { SessionSummary, TranscriptEvent } from '../../types/bridge';
import { isConversationAtLatest } from '../conversationListState';
import type { ConversationListHandle } from '../ConversationList';
import { MessageFeed } from '../MessageFeed';
import { ModelIcon } from '../ModelIcon';
import { SideChatComposer } from './SideChatComposer';
import { SideChatBackButton, SideChatHeader, SideChatHeaderButton } from './SideChatHeader';

const EMPTY_TRANSCRIPT: TranscriptEvent[] = [];

/* One side chat: its question and answers, and a composer to keep asking. It
   shows only what happened after it branched; the copied conversation above
   that is the source chat's, already on screen beside it. Its answer can go to
   the main composer, or the whole side chat can carry on as a chat of its own. */

export function SideChatDetail({
  session,
  wide,
  controls,
  onBack,
}: {
  session: SessionSummary;
  // Given the whole content row, the conversation takes the chat's measure.
  wide: boolean;
  controls: ReactNode;
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
      restoring: current.sessionRestore[appSessionId]?.status === 'loading',
      toolActivity: current.toolActivity,
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
  const live = sessionIsLive(session);

  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<ConversationListHandle>(null);
  const pinned = useFollowLatest(scrollRef, contentRef, listRef);

  const continueAsChat = (forkPointId?: string) => {
    forkChat(appSessionId, session.title, forkPointId);
  };

  const send = (text: string) => {
    const message = text.trim();
    try {
      sendToSession(appSessionId, message);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not send to this side chat.');
      return false;
    }
    dispatch({
      type: 'SESSION_TRANSCRIPT',
      event: {
        id: `local-${String(Date.now())}`,
        appSessionId,
        sourceSessionId: 'user',
        role: 'primary',
        ts: Date.now(),
        kind: 'text',
        text: message,
        author: 'user',
      },
    });
    pinned.current = true;
    return true;
  };

  return (
    <div data-testid="side-chat-detail" className="flex min-h-0 flex-1 flex-col">
      <SideChatHeader controls={controls}>
        {onBack ? <SideChatBackButton onClick={onBack} /> : null}
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
            dispatch({ type: 'SEED_COMPOSER', text: reply });
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
            <p className="pt-6 text-center text-[12px] text-droid-text-muted">
              {state.restoring ? 'Loading side chat…' : 'Nothing in this side chat yet.'}
            </p>
          )}
        </div>
      </div>

      <SideChatComposer
        placeholder="Ask a follow-up"
        live={live}
        onSend={send}
        onStop={() => {
          interruptSession(appSessionId);
        }}
      />
    </div>
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
