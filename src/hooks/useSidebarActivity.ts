import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import type { AppState } from './useStore';
import type { SessionSummary } from '../types/bridge';
import type { GitDiffStat } from '../types/vcs';
import { linkedPrsDone } from '../lib/chatMetadata';
import { sessionIsLive } from '../lib/sessions';
import { toast } from '../lib/toast';
import { activityReason } from '../lib/activityReason';
import {
  canSettleSession,
  chatActivitySignals,
  pruneReopenedSessions,
  pruneSettledSessions,
  inActivityScope,
  sessionActivityStatus,
  type SessionActivityStatus,
  type SidebarActivityPreferences,
} from '../lib/sidebarActivity';
import {
  sidebarPreferences,
  subscribeSidebarPreferences,
  updateSidebarPreferences,
} from '../lib/sidebarPreferences';
import { useActivityDigests } from './useActivityDigests';
import type { ActivityDigest } from '../lib/activityDigest';
import { useActivityShipSignals } from './useActivityShipSignals';

const SHIP_POLL_LIMIT = 12;

// A persisted digest is only trusted while the chat has not moved past it.
function freshDigest(
  digests: Partial<Record<string, ActivityDigest>>,
  session: SessionSummary,
): ActivityDigest | undefined {
  const digest = digests[session.appSessionId];
  return digest && digest.at >= session.updatedAt ? digest : undefined;
}
const SHIP_WINDOW_MS = 14 * 86_400_000;

function toastSaveFailed(): void {
  toast.error('Could not save sidebar preferences. Check available disk space and try again.');
}

// Sidebar preferences stay local to this profile; runtime status comes from the store.
export function useSidebarActivity(
  state: Pick<
    AppState,
    | 'pendingPermissions'
    | 'pendingQuestions'
    | 'activeAppSessionId'
    | 'sessionLastSeen'
    | 'sessions'
    | 'sessionOrder'
    | 'chatMetadata'
  >,
  now: number,
) {
  const preferences = useSyncExternalStore(
    subscribeSidebarPreferences,
    sidebarPreferences,
    sidebarPreferences,
  );

  useEffect(() => {
    // Read the owner, not this render's copy: a sidebar request may have
    // settled or reopened a chat since this render.
    const latest = sidebarPreferences();
    const settled = pruneSettledSessions(latest.settled, state.sessions, state.chatMetadata);
    const reopened = pruneReopenedSessions(latest.reopened, state.chatMetadata);
    if (settled === latest.settled && reopened === latest.reopened) return;
    // Pruning is authoritative in memory even when persistence is unavailable.
    // This makes the reactive effect converge instead of retrying on every token.
    if (!updateSidebarPreferences({ ...latest, settled, reopened }, 'keep')) toastSaveFailed();
  }, [preferences, state.sessions, state.chatMetadata]);

  function update(next: SidebarActivityPreferences) {
    if (!updateSidebarPreferences(next)) toastSaveFailed();
  }

  const digests = useActivityDigests(preferences.view === 'activity');

  // Idle worktrees worth a git call: the newest chat per folder, if it is
  // idle, unsettled and recent, capped so the poll stays cheap. Only that chat
  // may own the "to ship" signal; a newer live or settled chat in the same
  // folder claims it for nobody, so folder-mates never light up in its place.
  const shipOwners = useMemo(() => {
    const owners = new Map<string, string>();
    if (preferences.view !== 'activity') return owners;
    const claimed = new Set<string>();
    const known: Partial<Record<string, SessionSummary>> = state.sessions;
    const sessions = state.sessionOrder
      .map((id) => known[id])
      .filter((session): session is SessionSummary => Boolean(session?.cwd))
      .sort((a, b) => b.updatedAt - a.updatedAt || a.appSessionId.localeCompare(b.appSessionId));
    for (const session of sessions) {
      if (claimed.has(session.cwd)) continue;
      claimed.add(session.cwd);
      const settledAt = preferences.settled[session.appSessionId] ?? -1;
      if (sessionIsLive(session) || settledAt >= session.updatedAt) continue;
      if (now - session.updatedAt > SHIP_WINDOW_MS) continue;
      owners.set(session.cwd, session.appSessionId);
      if (owners.size >= SHIP_POLL_LIMIT) break;
    }
    return owners;
  }, [preferences.view, preferences.settled, state.sessionOrder, state.sessions, now]);
  const shipCwds = useMemo(() => [...shipOwners.keys()], [shipOwners]);
  const diffs = useActivityShipSignals(shipCwds, preferences.view === 'activity');

  const {
    pendingPermissions,
    pendingQuestions,
    activeAppSessionId,
    sessionLastSeen,
    chatMetadata,
  } = state;
  const statusFor = useCallback(
    (session: SessionSummary): SessionActivityStatus => {
      const digest = freshDigest(digests, session);
      const owned: Partial<Record<string, GitDiffStat>> = diffs;
      const diff =
        shipOwners.get(session.cwd) === session.appSessionId ? owned[session.cwd] : undefined;
      const signals = chatActivitySignals(
        session,
        { pendingPermissions, pendingQuestions, activeAppSessionId, sessionLastSeen, chatMetadata },
        { settled: preferences.settled, reopened: preferences.reopened },
      );
      return sessionActivityStatus(session, {
        ...signals,
        awaitingReply: digest?.modelSpokeLast ?? false,
        uncommitted: (diff?.files ?? 0) > 0,
      });
    },
    [
      digests,
      diffs,
      shipOwners,
      pendingPermissions,
      pendingQuestions,
      activeAppSessionId,
      sessionLastSeen,
      chatMetadata,
      preferences.settled,
      preferences.reopened,
    ],
  );

  const reasonFor = useCallback(
    (session: SessionSummary, status: SessionActivityStatus) =>
      activityReason(status, {
        session,
        permission: state.pendingPermissions[session.appSessionId],
        question: state.pendingQuestions[session.appSessionId],
        digest: freshDigest(digests, session),
        diff: diffs[session.cwd],
      }),
    [digests, diffs, state.pendingPermissions, state.pendingQuestions],
  );

  const inScope = useCallback(
    (session: SessionSummary, now: number) => inActivityScope(statusFor(session), session, now),
    [statusFor],
  );

  return {
    preferences,
    update,
    view: preferences.view,
    statusFor,
    reasonFor,
    inScope,
    settle: (session: SessionSummary) => {
      const status = statusFor(session);
      if (!canSettleSession(status)) return;
      const latest = sidebarPreferences();
      update({
        ...latest,
        settled: { ...latest.settled, [session.appSessionId]: session.updatedAt },
      });
    },
    // Clearing the manual marker is not enough for a chat whose pull requests
    // all closed: without the override it would settle again immediately.
    reopen: (session: SessionSummary) => {
      const id = session.appSessionId;
      const latest = sidebarPreferences();
      const settled = Object.fromEntries(
        Object.entries(latest.settled).filter(([settledId]) => settledId !== id),
      );
      const overridesPrs = linkedPrsDone(chatMetadata[id]) && !latest.reopened.includes(id);
      const reopened = overridesPrs ? [...latest.reopened, id] : latest.reopened;
      update({ ...latest, settled, reopened });
    },
  };
}
