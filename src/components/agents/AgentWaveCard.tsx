import { memo, useMemo } from 'react';
import type { ChildSessionSummary } from '../../types/bridge';
import {
  resolveWaveSessions,
  type ChildSessionActivity,
  type ChildSessionTarget,
} from '../../lib/childSessions';
import { sameFeedEvents, type FeedItem } from '../chatFeed';
import { AgentMonitorCard, type AgentMonitorData } from './AgentMonitorCard';

// The feed rebuilds item objects on every streamed token, but an untouched
// wave's events keep their identity, so settled waves bail out of per-token
// re-renders. Live waves still update: the monitor data changes identity when
// the store's child sessions or models change.
export const AgentWaveCard = memo(
  function AgentWaveCard({
    item,
    monitor,
    live,
    onOpen,
    activity,
  }: {
    item: Extract<FeedItem, { type: 'child_sessions' }>;
    monitor: AgentMonitorData;
    live?: boolean;
    onOpen?: (child: ChildSessionSummary) => void;
    activity?: (target: ChildSessionTarget) => ChildSessionActivity | undefined;
  }) {
    // Wave-scoped: resolve only this run's spawns so the card shows this turn's
    // agents, not the session's cumulative list.
    const sessions = useMemo(
      () => resolveWaveSessions(item.events, monitor.sessions),
      [item.events, monitor.sessions],
    );
    return (
      <AgentMonitorCard
        sessions={sessions}
        models={monitor.models}
        live={live}
        onOpen={onOpen}
        activity={activity}
        {...(monitor.snapshots !== undefined ? { snapshots: monitor.snapshots } : {})}
        {...(monitor.provider !== undefined ? { provider: monitor.provider } : {})}
      />
    );
  },
  (prev, next) =>
    prev.monitor === next.monitor &&
    prev.live === next.live &&
    prev.onOpen === next.onOpen &&
    prev.activity === next.activity &&
    sameFeedEvents(prev.item, next.item),
);
