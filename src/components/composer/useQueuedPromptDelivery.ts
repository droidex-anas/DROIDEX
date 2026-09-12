import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useStoreApi, useStoreDispatch } from '../../hooks/useStore';
import { isAppUpdateInstalling } from '../../lib/appUpdate';
import { sendDesignPrompt, sendToSession } from '../../lib/commands';
import {
  composePrompt,
  hasAppContextForTranscript,
  responseFormatForPrompt,
} from '../../lib/composePrompt';
import { markGitTurnStart } from '../../lib/git';
import {
  createLocalDesignTranscriptEvent,
  createPromptQueueDeliveryGuard,
} from '../../lib/promptQueue';
import { browserTranscriptReferencesFromDesignReferences } from '../browser/browserTranscriptReferences';

export function useQueuedPromptDelivery({
  appSessionId,
  cwd,
  isLive,
  appUpdateInstalling,
  appUpdateInstallResult,
}: {
  appSessionId: string | null;
  cwd: string | null;
  isLive: boolean;
  appUpdateInstalling: boolean;
  appUpdateInstallResult: 'downloaded' | 'presented' | null;
}): void {
  const store = useStoreApi();
  const dispatch = useStoreDispatch();
  const guard = useMemo(createPromptQueueDeliveryGuard, []);
  const generation = useRef(0);
  const previous = useRef<{ appSessionId: string | null; live: boolean }>({
    appSessionId: null,
    live: false,
  });
  const previousInstalling = useRef(appUpdateInstalling);

  useEffect(
    () => () => {
      generation.current += 1;
    },
    [appSessionId],
  );

  const deliverPrompt = useCallback(async () => {
    if (!appSessionId || isAppUpdateInstalling()) return;
    if (!(store.getState().promptQueue[appSessionId] ?? []).length) return;
    const capturedGeneration = generation.current;
    try {
      await guard.run(async () => {
        if (cwd) await markGitTurnStart(cwd, appSessionId);
        if (
          isAppUpdateInstalling() ||
          generation.current !== capturedGeneration ||
          store.getState().activeAppSessionId !== appSessionId
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
            composePrompt(
              head.text,
              head.skills.filter((name) => !mentioned.has(name)),
              head.files,
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
    if (was.live && !isLive && was.appSessionId === appSessionId) void deliverPrompt();
    previous.current = { appSessionId, live: isLive };
  }, [appSessionId, deliverPrompt, isLive]);

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
