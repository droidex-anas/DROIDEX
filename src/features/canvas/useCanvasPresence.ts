// The board's presence and the writes that landed on it, kept in step with the
// store. Each derivation runs in a store selector and compares by value, so the
// board re-renders when an agent starts or stops on a frame or a write lands,
// never for a streamed token.

import { useCallback, useMemo, useRef } from 'react';
import { useStoreSelector, type AppState } from '../../hooks/useStore';
import { isWorkingAgent } from '../../lib/childSessions';
import { sessionIsLive } from '../../lib/sessions';
import type { TranscriptEvent } from '../../types/bridge';
import {
  canvasPresence,
  landedWrites,
  sameLandedWrites,
  samePresence,
  type CanvasPresence,
  type LandedWrites,
  type PresenceSources,
} from './canvasPresence';
import type { CanvasFrame } from './protocol';

const NO_EVENTS: TranscriptEvent[] = [];

export function useCanvasPresence(appSessionId: string, frames: CanvasFrame[]): CanvasPresence {
  const arrivedAt = useFrameArrivalTimes(frames);
  const select = useCallback(
    (state: AppState) => canvasPresence(presenceSources(state, appSessionId), frames, arrivedAt),
    [appSessionId, frames, arrivedAt],
  );
  return useStoreSelector(select, samePresence);
}

export function useLandedWrites(appSessionId: string): LandedWrites {
  const select = useCallback(
    (state: AppState) => landedWrites(presenceSources(state, appSessionId)),
    [appSessionId],
  );
  return useStoreSelector(select, sameLandedWrites);
}

function presenceSources(state: AppState, appSessionId: string): PresenceSources {
  const session = Object.hasOwn(state.sessions, appSessionId)
    ? state.sessions[appSessionId]
    : undefined;
  const primaryLive = session ? sessionIsLive(session) : false;
  const children = state.childSessions[appSessionId] ?? {};
  // A subagent running inside the chat's own process has no runtime of its
  // own, so whether it is at work is its status alone.
  const liveChildren = new Map<string, number | undefined>();
  for (const [childSessionId, child] of Object.entries(children))
    if (isWorkingAgent(child, primaryLive)) liveChildren.set(childSessionId, child.startedAt);
  return {
    appSessionId,
    events: state.transcripts[appSessionId] ?? NO_EVENTS,
    primaryLive,
    liveChildren,
  };
}

/**
 * When each frame reached this board, by design id, on the machine clock the
 * sidecar stamps events with. The frames the board opened with count as there
 * from the start: until a create's result names them, nothing says who made
 * them.
 */
function useFrameArrivalTimes(frames: readonly CanvasFrame[]): ReadonlyMap<string, number> {
  const known = useRef<ReadonlyMap<string, number>>(undefined);
  return useMemo(() => {
    const previous = known.current;
    const now = Date.now();
    const arrivedAt = new Map<string, number>();
    for (const { designId } of frames)
      arrivedAt.set(designId, previous ? (previous.get(designId) ?? now) : 0);
    known.current = arrivedAt;
    return arrivedAt;
  }, [frames]);
}
