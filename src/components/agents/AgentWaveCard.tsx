import { memo, useMemo } from 'react';
import type { ChildSessionSummary } from '@droidex/protocol';
import {
  resolveWaveSessions,
  spawnRegisteredChildren,
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
  // The activity callback reads through a memoized, always-fresh derivation,
  // so its identity carries no meaning and is not compared: what the rows show
  // of it is static per child, and everything live reaches the card through the
  // monitor's sessions and snapshots. The feed-level comparator above already
  // gates this card on the activity values of its own spawns.
  (prev, next) =>
    prev.live === next.live &&
    prev.onOpen === next.onOpen &&
    sameFeedEvents(prev.item, next.item) &&
    sameWaveMonitor(prev.monitor, next.monitor, prev.item.events),
);

// The monitor object is rebuilt whenever any child in the session streams, but
// a wave only renders its own spawns. Store children are replaced immutably
// and stream snapshots are structurally shared, so entry identity is semantic
// for both: a wave whose own spawns did not change skips the commit no matter
// what sibling waves are doing. Comparison failure only ever re-renders.
function sameWaveMonitor(
  prev: AgentMonitorData,
  next: AgentMonitorData,
  spawns: readonly { toolUseId?: string; id: string }[],
): boolean {
  if (prev === next) return true;
  if (prev.models !== next.models || prev.provider !== next.provider) return false;
  if (prev.sessions === next.sessions && prev.snapshots === next.snapshots) return true;
  return spawns.every((spawn) => {
    const toolUseId = spawn.toolUseId ?? spawn.id;
    const before = spawnRegisteredChildren(prev.sessions, toolUseId);
    const after = spawnRegisteredChildren(next.sessions, toolUseId);
    if (before.length !== after.length) return false;
    return before.every(
      (child, index) =>
        child === after[index] &&
        prev.snapshots?.get(child.childSessionId) === next.snapshots?.get(child.childSessionId),
    );
  });
}
