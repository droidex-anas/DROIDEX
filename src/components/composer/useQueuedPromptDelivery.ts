import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useStoreApi, useStoreDispatch, type AppState } from '../../hooks/useStore';
import { isAppUpdateInstalling } from '../../lib/appUpdate';
import { sendDesignPrompt, sendToSession } from '../../lib/commands';
import {
  composePrompt,
  hasAppContextForTranscript,
  responseFormatForPrompt,
} from '../../lib/composePrompt';
import { markGitTurnStart } from '../../lib/git';
import { sessionIsLive } from '../../lib/sessions';
import { promptWithSideChatReplies } from '../../lib/sideChats';
import {
  createLocalDesignTranscriptEvent,
  createPromptQueueDeliveryGuard,
} from '../../lib/promptQueue';
import { browserTranscriptReferencesFromDesignReferences } from '../browser/browserTranscriptReferences';

export function useQueuedPromptDelivery({
  appSessionId,
  cwd,
  isLive,
  usageLimited,
  appUpdateInstalling,
  appUpdateInstallResult,
}: {
  appSessionId: string | null;
  cwd: string | null;
  isLive: boolean;
  // The chat is held on a usage limit: its queue waits until the limit lifts.
  usageLimited: boolean;
  appUpdateInstalling: boolean;
  appUpdateInstallResult: 'downloaded' | 'presented' | null;
}): void {
  const store = useStoreApi();
  const dispatch = useStoreDispatch();
  const guard = useMemo(createPromptQueueDeliveryGuard, []);
  const generation = useRef(0);
  const previous = useRef<{ appSessionId: string | null; live: boolean; limited: boolean }>({
    appSessionId: null,
    live: false,
    limited: false,
  });
  const previousInstalling = useRef(appUpdateInstalling);
  const limited = useRef(usageLimited);
  limited.current = usageLimited;

  useEffect(
    () => () => {
      generation.current += 1;
    },
    [appSessionId],
  );

  const deliverPrompt = useCallback(async () => {
    if (!appSessionId || isAppUpdateInstalling()) return;
    // A chat that is gone from the store has nothing left to deliver to.
    const isSessionIdle = () => {
      const sessions: Partial<AppState['sessions']> = store.getState().sessions;
      const session = sessions[appSessionId];
      return session !== undefined && !sessionIsLive(session);
    };
    if (!(store.getState().promptQueue[appSessionId] ?? []).length) return;
    if (!isSessionIdle() || limited.current) return;
    const capturedGeneration = generation.current;
    try {
      await guard.run(async () => {
        if (cwd) await markGitTurnStart(cwd, appSessionId);
        // The guard serialises queued deliveries, not interactive sends: the
        // user can start a turn while the git baseline is captured, and this
        // prompt must wait for that turn instead of joining it. The generation
        // moves when this composer leaves the session.
        if (
          isAppUpdateInstalling() ||
          !isSessionIdle() ||
          limited.current ||
          generation.current !== capturedGeneration
        )
          return;
        // Edits and reorders may land during baseline capture. Only the current
        // head can be sent, and a failed send leaves it intact.
        const head = (store.getState().promptQueue[appSessionId] ?? []).at(0);
        if (!head) return;
        if (head.design) {
          sendDesignPrompt(head.design.browserKey, head.text, head.design.referenceIds);
          dispatch({
            type: 'SESSION_TRANSCRIPT',
            event: createLocalDesignTranscriptEvent(
              appSessionId,
              head.text,
              browserTranscriptReferencesFromDesignReferences(head.design.references),
            ),
          });
        } else {
          const transcript = store.getState().transcripts[appSessionId] ?? [];
          // Rows queued as mentions kept their place in the chip list for the
          // preview; the text they are sent with must still leave them out.
          const mentioned = new Set(head.mentions?.map((mention) => mention.name));
          sendToSession(
            appSessionId,
            promptWithSideChatReplies(
              composePrompt(
                head.text,
                head.skills.filter((name) => !mentioned.has(name)),
                head.files,
              ),
              head.sideChatReplies ?? [],
            ),
            responseFormatForPrompt(head.text, hasAppContextForTranscript(transcript, null)),
            head.mentions,
          );
          dispatch({
            type: 'SESSION_TRANSCRIPT',
            event: {
              id: `local-${String(Date.now())}`,
              appSessionId,
              sourceSessionId: 'user',
              role: 'primary',
              ts: Date.now(),
              kind: 'text',
              text: head.text,
              author: 'user',
              skills: head.skills,
              files: head.files,
              ...(head.sideChatReplies ? { sideChatReplies: head.sideChatReplies } : {}),
            },
          });
        }
        dispatch({ type: 'REMOVE_QUEUED_PROMPT', appSessionId, id: head.id });
      });
    } catch (error) {
      console.error('[PromptInput] queued delivery failed:', error);
    }
  }, [appSessionId, cwd, dispatch, guard, store]);

  useEffect(() => {
    const was = previous.current;
    // This session just settled, the user came back to one that settled while
    // they were away, or the limit an idle one was held on lifted; each leaves
    // its queue to drain here.
    const sameSession = was.appSessionId === appSessionId;
    const settled = was.live && !isLive && sameSession;
    const returned = !sameSession && !isLive;
    const lifted = was.limited && !usageLimited && !isLive && sameSession;
    previous.current = { appSessionId, live: isLive, limited: usageLimited };
    if (!settled && !returned && !lifted) return;
    if (appSessionId && (store.getState().promptQueue[appSessionId] ?? []).length)
      void deliverPrompt();
  }, [appSessionId, deliverPrompt, isLive, store, usageLimited]);

  useEffect(() => {
    const hasQueued = Boolean(
      appSessionId && (store.getState().promptQueue[appSessionId] ?? []).length,
    );
    if (
      shouldResumeQueuedPromptAfterUpdate(
        previousInstalling.current,
        appUpdateInstalling,
        isLive,
        hasQueued,
        appUpdateInstallResult,
      )
    )
      void deliverPrompt();
    previousInstalling.current = appUpdateInstalling;
  }, [appSessionId, appUpdateInstalling, appUpdateInstallResult, deliverPrompt, isLive, store]);
}

export function shouldResumeQueuedPromptAfterUpdate(
  wasInstalling: boolean,
  isInstalling: boolean,
  isLive: boolean,
  hasQueuedPrompt: boolean,
  installResult: 'downloaded' | 'presented' | null,
): boolean {
  return (
    wasInstalling && !isInstalling && !isLive && hasQueuedPrompt && installResult === 'presented'
  );
}
