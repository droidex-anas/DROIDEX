import { useEffect, useRef } from 'react';
import { bridge } from '../../lib/bridge';
import { notify } from '../../lib/desktop';
import { isAppInForeground } from '../../lib/finishNotifications';
import { useStoreApi } from '../../hooks/useStore';
import type { ServerEvent } from '../../types/bridge';
import type { ProjectView } from './types';

/* A project runs while the user is somewhere else, so a thread that stops for
   an approval or a question would otherwise wait unseen. One banner per block,
   naming the thread and its project; clicking it opens that conversation, and
   the chat already on screen never raises one.

   This watches the bridge and reads the store imperatively: a notifier renders
   nothing, and subscribing the whole app to every project snapshot would cost a
   re-render for work no one sees. */

type Blocked = 'approval' | 'question';

const LEAD: Record<Blocked, string> = {
  approval: 'needs your approval',
  question: 'asked you a question',
};

export function useThreadAttentionNotifications(enabled: boolean): void {
  const store = useStoreApi();
  const projects = useRef<ProjectView[]>([]);
  const notified = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!enabled) return undefined;
    const review = () => {
      const state = store.getState();
      for (const project of projects.current) {
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
          notified.current.add(key);
          // Looking at the thread is seeing the request; a banner repeats it.
          if (state.activeAppSessionId === thread.appSessionId && isAppInForeground()) continue;
          void notify(`${thread.title} ${LEAD[kind]}`, project.title, {
            appSessionId: thread.appSessionId,
          });
        }
      }
    };
    const unsubscribeBridge = bridge.subscribe((event: ServerEvent) => {
      if (event.type === 'projects.snapshot') projects.current = event.projects;
      review();
    });
    const unsubscribeStore = store.subscribe(review);
    return () => {
      unsubscribeBridge();
      unsubscribeStore();
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
