import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { browserTranscriptReferencesFromDesignReferences } from '@droidex/protocol';
import { useStoreApi, useStoreDispatch, type AppState } from '../../hooks/useStore';
import { promptWithCanvasPins } from '../../features/canvas/framePins';
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
  promptChips,
  type QueuedPrompt,
} from '../../lib/promptQueue';

export function useQueuedPromptDelivery({
  appSessionId,
  cwd,
  isLive,
  hasQueuedPrompt,
  usageLimited,
  appUpdateInstalling,
  appUpdateInstallResult,
}: {
  appSessionId: string | null;
  cwd: string | null;
  isLive: boolean;
  hasQueuedPrompt: boolean;
  // The chat is held on a usage limit: its queue waits until the limit lifts.
  usageLimited: boolean;
  appUpdateInstalling: boolean;
  appUpdateInstallResult: 'downloaded' | 'presented' | null;
}): void {
  const store = useStoreApi();
  const dispatch = useStoreDispatch();
  const guard = useMemo(createPromptQueueDeliveryGuard, []);
  const generation = useRef(0);
  const previous = useRef({
    appSessionId,
    isLive,
    hasQueuedPrompt: false,
    usageLimited,
    appUpdateInstalling,
  });
  // Committed limit state only: a render React drops must not open or shut
  // the gate a delivery in flight reads.
  const limited = useRef(usageLimited);
  useLayoutEffect(() => {
    limited.current = usageLimited;
  }, [usageLimited]);

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
        const transcript = store.getState().transcripts[appSessionId] ?? [];
        const { text, options } = queuedSend(head, hasAppContextForTranscript(transcript, null));
        // A design prompt goes with its own snapshots of its marks, which hold
        // all it needs even once the browser they were picked in has closed.
        if (head.design) {
          sendDesignPrompt(head.design.browserKey, text, head.design.references, options);
          dispatch({
            type: 'SESSION_TRANSCRIPT',
            event: createLocalDesignTranscriptEvent(
              appSessionId,
              head.text,
              browserTranscriptReferencesFromDesignReferences(head.design.references),
              { skills: head.skills, files: head.files, ...promptChips(head) },
            ),
          });
        } else {
          sendToSession(appSessionId, text, options);
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
              ...promptChips(head),
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
    previous.current = {
      appSessionId,
      isLive,
      hasQueuedPrompt,
      usageLimited,
      appUpdateInstalling,
    };
    if (isLive || !hasQueuedPrompt) return;
    // A first prompt can finish staging after the turn has already settled.
    // Watch the empty-to-nonempty edge, not edits or removal of a sent head.
    const queueBecameReady = !was.hasQueuedPrompt;
    const resumedAfterUpdate = shouldResumeQueuedPromptAfterUpdate(
      was.appUpdateInstalling,
      appUpdateInstalling,
      isLive,
      hasQueuedPrompt,
      appUpdateInstallResult,
    );
    if (
      queueBecameReady ||
      was.isLive ||
      was.appSessionId !== appSessionId ||
      (was.usageLimited && !usageLimited) ||
      resumedAfterUpdate
    )
      void deliverPrompt();
  }, [
    appSessionId,
    appUpdateInstalling,
    appUpdateInstallResult,
    deliverPrompt,
    hasQueuedPrompt,
    isLive,
    usageLimited,
  ]);
}

/** What a queued prompt is sent with: everything as it was when it was queued. */
export function queuedSend(
  head: QueuedPrompt,
  hasAppContext: boolean,
): { text: string; options: NonNullable<Parameters<typeof sendToSession>[2]> } {
  // Rows queued as mentions kept their place in the chip list for the
  // preview; the text they are sent with must still leave them out.
  const mentioned = new Set(head.mentions?.map((mention) => mention.name));
  const text = promptWithCanvasPins(
    promptWithSideChatReplies(
      composePrompt(
        head.text,
        head.skills.filter((name) => !mentioned.has(name)),
        head.files,
      ),
      head.sideChatReplies ?? [],
    ),
    head.framePins,
    head.elementPins,
    head.componentPins,
  );
  return {
    text,
    options: {
      responseFormat: responseFormatForPrompt(head.text, hasAppContext),
      mentions: head.mentions,
      canvasContext: head.canvasContext,
    },
  };
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
