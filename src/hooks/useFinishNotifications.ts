import { useCallback, useEffect, useRef } from 'react';
import {
  ackNotificationActivate,
  isDesktop,
  notify,
  onNotificationActivate,
  takePendingNotificationSession,
} from '../lib/desktop';
import { isDocumentVisible, subscribeVisibilityChange } from './useDocumentVisible';
import {
  collectFinishedSessions,
  decideFinishNotification,
  isAppInForeground,
  latestAssistantSnippet,
  loadFinishNotificationSettings,
} from '../lib/finishNotifications';
import { useStoreApi, useStoreDispatch, type AppState } from './useStore';
import { isChatInView } from '../features/tabs/tabStrip';

// Desktop finish banners: working→idle sessions raise a short OS notification.
// Clicks open that chat via a main-process pending queue (push + focus pull);
// a click for a chat the store does not know yet waits for the session list.

export function useFinishNotifications(enabled: boolean): void {
  const dispatch = useStoreDispatch();
  const store = useStoreApi();
  const previouslyWorking = useRef<Set<string>>(new Set());
  const seeded = useRef(false);
  const lastOpenedRef = useRef<{ id: string; at: number } | null>(null);
  const heldActivationRef = useRef<string | null>(null);

  const openSessionFromNotification = useCallback(
    (appSessionId: string) => {
      if (!appSessionId) return;
      const state = store.getState();
      if (!(appSessionId in state.sessions)) {
        // A reloaded renderer starts from a partial snapshot; only the
        // sidecar's session list can say the chat is gone.
        if (!state.sessionListLoaded) {
          heldActivationRef.current = appSessionId;
          return;
        }
        heldActivationRef.current = null;
        void ackNotificationActivate(appSessionId);
        return;
      }
      heldActivationRef.current = null;
      const now = Date.now();
      if (lastOpenedRef.current?.id === appSessionId && now - lastOpenedRef.current.at < 1500) {
        void ackNotificationActivate(appSessionId);
        return;
      }
      lastOpenedRef.current = { id: appSessionId, at: now };
      dispatch({ type: 'SET_ACTIVE_SESSION', id: appSessionId });
      dispatch({ type: 'SELECT_CHILD', selection: null });
      if (state.settingsOpen) dispatch({ type: 'TOGGLE_SETTINGS' });
      void ackNotificationActivate(appSessionId);
    },
    [dispatch, store],
  );

  useEffect(() => {
    if (!enabled || !isDesktop()) return;
    return onNotificationActivate(({ appSessionId }) => {
      if (appSessionId) openSessionFromNotification(appSessionId);
    });
  }, [enabled, openSessionFromNotification]);

  useEffect(() => {
    if (!enabled || !isDesktop()) return;
    return store.subscribe(() => {
      const held = heldActivationRef.current;
      if (held !== null) openSessionFromNotification(held);
    });
  }, [enabled, openSessionFromNotification, store]);

  useEffect(() => {
    if (!enabled || !isDesktop()) return;

    const pullPending = () => {
      void takePendingNotificationSession().then((pending) => {
        if (pending?.appSessionId) openSessionFromNotification(pending.appSessionId);
      });
    };

    const onVisibility = () => {
      if (isDocumentVisible()) pullPending();
    };

    window.addEventListener('focus', pullPending);
    const unsubVisibility = subscribeVisibilityChange(onVisibility);
    pullPending();

    return () => {
      window.removeEventListener('focus', pullPending);
      unsubVisibility();
    };
  }, [enabled, openSessionFromNotification]);

  useEffect(() => {
    if (!enabled || !isDesktop()) return;

    const review = (sessions: AppState['sessions']) => {
      const { finished, stillWorking } = collectFinishedSessions({
        sessions,
        previouslyWorking: previouslyWorking.current,
      });

      if (!seeded.current) {
        previouslyWorking.current = stillWorking;
        seeded.current = true;
        return;
      }

      previouslyWorking.current = stillWorking;
      if (finished.length === 0) return;

      const settings = loadFinishNotificationSettings();
      if (!settings.enabled) return;
      const appInForeground = isAppInForeground();
      if (settings.suppressWhenFocused && appInForeground) return;

      for (const session of finished) {
        // Build snippet only when we may actually notify this session.
        const isActive = isChatInView(store.getState(), session.appSessionId);
        if (!settings.notifyActiveSession && isActive) continue;

        const decision = decideFinishNotification({
          settings,
          session,
          isActiveSession: isActive,
          assistantSnippet: latestAssistantSnippet(
            store.getState().transcripts[session.appSessionId],
          ),
          appInForeground,
        });
        if (decision.kind !== 'notify') continue;

        void notify(decision.title, decision.body, {
          silent: decision.silent,
          appSessionId: session.appSessionId,
        }).catch(() => {
          /* permission denied or non-desktop — stay quiet */
        });
      }
    };

    let sessions = store.getState().sessions;
    review(sessions);
    return store.subscribe(() => {
      const nextSessions = store.getState().sessions;
      if (nextSessions === sessions) return;
      sessions = nextSessions;
      review(sessions);
    });
  }, [enabled, store]);
}
