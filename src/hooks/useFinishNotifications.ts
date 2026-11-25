import { useEffect, useRef } from 'react';
import {
  ackNotificationActivate,
  isDesktop,
  notify,
  onNotificationActivate,
  readPendingNotificationSession,
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
// a click for a chat the store has not loaded yet waits for that chat.

export function useFinishNotifications(enabled: boolean): void {
  const dispatch = useStoreDispatch();
  const store = useStoreApi();
  const previouslyWorking = useRef<Set<string>>(new Set());
  const seeded = useRef(false);
  const lastOpenedRef = useRef<{ id: string; at: number } | null>(null);

  useEffect(() => {
    if (!enabled || !isDesktop()) return;
    // Main owns the pending click, so a push only prompts a read; push and
    // read replies travel separately, and only the latest read may act.
    let generation = 0;
    let readInFlight = false;
    let heldAppSessionId: string | null = null;

    const openSession = (appSessionId: string) => {
      const state = store.getState();
      if (!(appSessionId in state.sessions)) {
        // A reloaded renderer starts from a partial snapshot. Leave the click
        // unacked so main keeps it until the chat loads or the click expires.
        heldAppSessionId = appSessionId;
        return;
      }
      heldAppSessionId = null;
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
    };

    const readPending = () => {
      const readGeneration = ++generation;
      readInFlight = true;
      void readPendingNotificationSession().then((pending) => {
        if (readGeneration !== generation) return;
        readInFlight = false;
        if (pending) openSession(pending.appSessionId);
        else heldAppSessionId = null;
      });
    };

    const onVisibility = () => {
      if (isDocumentVisible()) readPending();
    };

    const unsubActivate = onNotificationActivate(readPending);
    const unsubStore = store.subscribe(() => {
      if (readInFlight || heldAppSessionId === null) return;
      if (heldAppSessionId in store.getState().sessions) readPending();
    });
    window.addEventListener('focus', readPending);
    const unsubVisibility = subscribeVisibilityChange(onVisibility);
    readPending();

    return () => {
      generation += 1;
      unsubActivate();
      unsubStore();
      window.removeEventListener('focus', readPending);
      unsubVisibility();
    };
  }, [enabled, dispatch, store]);

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
