import { useEffect, useRef } from 'react';
import { shallowEqual, useStoreSelector } from '../../hooks/useStore';
import { notify } from '../../lib/desktop';
import { isAppInForeground } from '../../lib/finishNotifications';
import { useProjects } from './client';

/* A project runs while the user is somewhere else, so a thread that stops for
   an approval or a question would otherwise wait unseen. One banner per block,
   naming the thread and the project, and clicking it opens that conversation.
   The chat the user is already looking at never raises one. */

type Blocked = 'approval' | 'question';

const LEAD: Record<Blocked, string> = {
  approval: 'needs your approval',
  question: 'asked you a question',
};

export function useThreadAttentionNotifications(enabled: boolean): void {
  const { projects } = useProjects();
  const state = useStoreSelector(
    (current) => ({
      activeAppSessionId: current.activeAppSessionId,
      pendingPermissions: current.pendingPermissions,
      pendingQuestions: current.pendingQuestions,
    }),
    shallowEqual,
  );
  const notified = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!enabled) return;
    const blocked = new Map<string, Blocked>();
    for (const id of Object.keys(state.pendingPermissions)) blocked.set(id, 'approval');
    for (const id of Object.keys(state.pendingQuestions)) blocked.set(id, 'question');

    for (const project of projects) {
      for (const thread of project.threads) {
        if (!thread.ownerAppSessionId) continue;
        const kind = blocked.get(thread.appSessionId);
        const key = `${thread.appSessionId}:${kind ?? ''}`;
        if (!kind) {
          for (const stale of [...notified.current]) {
            if (stale.startsWith(`${thread.appSessionId}:`)) notified.current.delete(stale);
          }
          continue;
        }
        if (notified.current.has(key)) continue;
        notified.current.add(key);
        // Looking at the thread is seeing the request; a banner would only repeat it.
        if (state.activeAppSessionId === thread.appSessionId && isAppInForeground()) continue;
        void notify(`${thread.title} ${LEAD[kind]}`, project.title, {
          appSessionId: thread.appSessionId,
        });
      }
    }
  }, [enabled, projects, state]);
}
