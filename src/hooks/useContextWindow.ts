import { useCallback } from 'react';
import { shallowEqual, useStoreDispatch, useStoreSelector } from './useStore';
import { updateSessionSettings } from '../lib/commands';
import type { ContextWindowTokens } from '../types/bridge';

/**
 * The window a chat is pinned to and the one way to change it. A live session
 * shows the change at once and holds it until the sidecar settles the request,
 * the way a model change is held; an unsent draft keeps the choice until
 * `session.create` carries it. Undefined means the chat runs whatever window
 * its provider chooses.
 */
export default function useContextWindow(appSessionId: string | undefined): {
  contextWindowTokens: ContextWindowTokens | undefined;
  /** The window the provider runs for this chat, as far as the app measured it. */
  providerWindow: number | undefined;
  setContextWindow: (next: ContextWindowTokens) => void;
} {
  const dispatch = useStoreDispatch();
  const chat = useStoreSelector((current) => {
    const session = appSessionId ? current.sessions[appSessionId] : undefined;
    if (!session)
      return {
        contextWindowTokens: current.draftContextWindowTokens ?? undefined,
        providerWindow: undefined,
      };
    const pending = current.pendingModelUpdates[session.appSessionId]?.settings;
    return {
      contextWindowTokens: pending?.contextWindowTokens ?? session.contextWindowTokens,
      providerWindow: session.maxContextTokens,
    };
  }, shallowEqual);
  const setContextWindow = useCallback(
    (next: ContextWindowTokens) => {
      if (appSessionId) {
        const requestId = crypto.randomUUID();
        dispatch({
          type: 'MODEL_UPDATE_REQUESTED',
          appSessionId,
          requestId,
          settings: { contextWindowTokens: next },
        });
        updateSessionSettings({ appSessionId, requestId, contextWindowTokens: next });
        return;
      }
      dispatch({ type: 'SET_DRAFT_CONTEXT_WINDOW', contextWindowTokens: next });
    },
    [appSessionId, dispatch],
  );
  return { ...chat, setContextWindow };
}
