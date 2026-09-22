import { useEffect, useRef } from 'react';
import { notify } from '../../lib/desktop';
import { isAppInForeground } from '../../lib/finishNotifications';
import { useStoreApi } from '../../hooks/useStore';

/* A project runs while the user is somewhere else, so a thread that stops for
   an approval or a question would otherwise wait unseen. One banner per block,
   naming the thread and its project; clicking it opens that conversation, and
   the chat already on screen never raises one.

   This reads the store imperatively rather than selecting from it: a notifier
   renders nothing, and subscribing the whole app to every project snapshot
   would cost a re-render for work no one sees. */

type Blocked = 'approval' | 'question';

const LEAD: Record<Blocked, string> = {
  approval: 'needs your approval',
  question: 'asked you a question',
};

export function useThreadAttentionNotifications(enabled: boolean): void {
  const store = useStoreApi();
  const notified = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!enabled) return undefined;
    const review = () => {
      const state = store.getState();
      // Read from the store, which already holds the snapshot: a copy of its own
      // would start empty and stay empty until the next snapshot happened by.
      for (const project of state.projects) {
        for (const thread of project.threads) {
          if (!thread.ownerAppSessionId) continue;
          const kind = blockedOn(state, thread.appSessionId);
          const key = `${thread.appSessionId}:${kind ?? ''}`;
          if (!kind) {
            notified.current.delete(`${thread.appSessionId}:approval`);
            notified.current.delete(`${thread.appSessionId}:question`);
            continue;
          }
          if (notified.current.has(key)) continue;
          // Looking at the thread is seeing the request; a banner repeats it.
          // Marking it only once one is sent, so a request first seen on screen
          // still reaches the user after they look away.
          if (state.activeAppSessionId === thread.appSessionId && isAppInForeground()) continue;
          notified.current.add(key);
          void notify(`${thread.title} ${LEAD[kind]}`, project.title, {
            appSessionId: thread.appSessionId,
          });
        }
      }
    };
    review();
    const unsubscribe = store.subscribe(review);
    // Leaving the app is itself a reason to look again: a request first seen on
    // screen raises nothing then, and nothing else would run this until the
    // next project change.
    const onAway = () => {
      review();
    };
    window.addEventListener('blur', onAway);
    document.addEventListener('visibilitychange', onAway);
    return () => {
      unsubscribe();
      window.removeEventListener('blur', onAway);
      document.removeEventListener('visibilitychange', onAway);
    };
  }, [enabled, store]);
}

function blockedOn(
  state: { pendingPermissions: object; pendingQuestions: object },
  appSessionId: string,
): Blocked | null {
  if (Object.hasOwn(state.pendingPermissions, appSessionId)) return 'approval';
  if (Object.hasOwn(state.pendingQuestions, appSessionId)) return 'question';
  return null;
}
