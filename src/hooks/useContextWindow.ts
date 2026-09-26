import { useCallback } from 'react';
import { shallowEqual, useStoreDispatch, useStoreSelector } from './useStore';
import { updateSessionSettings } from '../lib/commands';
import type { ContextWindowTokens } from '../types/bridge';

/**
 * The window a chat is pinned to and the one way to change it. A live session
 * takes a settings update (echoed at once so the control does not lag the
 * click), an unsent draft keeps the choice until `session.create` carries it.
 * Undefined means the chat runs whatever window its provider chooses.
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
    return {
      contextWindowTokens: session
        ? session.contextWindowTokens
        : (current.draftContextWindowTokens ?? undefined),
      providerWindow: session?.maxContextTokens,
    };
  }, shallowEqual);
  const setContextWindow = useCallback(
    (next: ContextWindowTokens) => {
      if (appSessionId) {
        dispatch({
          type: 'SESSION_SETTINGS_CHANGED',
          appSessionId,
          settings: { contextWindowTokens: next },
        });
        updateSessionSettings({ appSessionId, contextWindowTokens: next });
        return;
      }
      dispatch({ type: 'SET_DRAFT_CONTEXT_WINDOW', contextWindowTokens: next });
    },
    [appSessionId, dispatch],
  );
  return { ...chat, setContextWindow };
}
