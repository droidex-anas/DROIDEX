import { shallowEqual, useStoreDispatch, useStoreSelector } from '../../hooks/useStore';
import { MAX_RUNNING_SIDE_CHATS, sideChatPanel, sideChatSettings } from '../../lib/sideChats';
import type { SessionSummary } from '../../types/bridge';
import { SideChatComposer } from './SideChatComposer';
import { SideChatHarnessPicker } from './SideChatHarnessPicker';
import { runningSideChatCount, useAskSideChat } from './useAskSideChat';

/* The composer that starts a session's side chat, with the harness it runs
   on, since a side chat can run on a different harness than the chat it asks
   about. */

export function SideChatHome({
  source,
  draft,
}: {
  source: SessionSummary;
  // A question handed back by a start that failed.
  draft: string;
}) {
  const dispatch = useStoreDispatch();
  const askSideChat = useAskSideChat();
  const sourceAppSessionId = source.appSessionId;
  const state = useStoreSelector(
    (current) => ({
      harness: sideChatPanel(current.sideChats, sourceAppSessionId).harness,
      harnessModels: current.harnessModels,
      running: runningSideChatCount(current, sourceAppSessionId),
    }),
    shallowEqual,
  );
  const settings = sideChatSettings(source, state.harness, state.harnessModels);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-6 text-center text-[12px] text-droid-text-muted">
        Ask about this chat without adding to it. The answer stays here.
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
        onSend={(text) => askSideChat(sourceAppSessionId, text)}
      />
    </div>
  );
}
