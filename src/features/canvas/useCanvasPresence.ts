// The board's presence, kept in step with the store. The derivation runs in
// the store selector and compares by value, so the board re-renders when an
// agent starts or stops on a frame, never for a streamed token.

import { useCallback } from 'react';
import { useStoreSelector, type AppState } from '../../hooks/useStore';
import { childSessionIsLive } from '../../lib/childSessions';
import { sessionIsLive } from '../../lib/sessions';
import type { TranscriptEvent } from '../../types/bridge';
import { canvasPresence, samePresence, type CanvasPresence } from './canvasPresence';
import type { CanvasFrame } from './protocol';

const NO_EVENTS: TranscriptEvent[] = [];

export function useCanvasPresence(appSessionId: string, frames: CanvasFrame[]): CanvasPresence {
  const select = useCallback(
    (state: AppState) => {
      const session = Object.hasOwn(state.sessions, appSessionId)
        ? state.sessions[appSessionId]
        : undefined;
      const children = state.childSessions[appSessionId] ?? {};
      const runtime = state.childRuntime[appSessionId] ?? {};
      const liveChildren = new Set(
        Object.keys(children).filter((childSessionId) =>
          childSessionIsLive(children[childSessionId], runtime[childSessionId]),
        ),
      );
      return canvasPresence(
        {
          appSessionId,
          events: state.transcripts[appSessionId] ?? NO_EVENTS,
          primaryLive: session ? sessionIsLive(session) : false,
          liveChildren,
        },
        frames,
      );
    },
    [appSessionId, frames],
  );
  return useStoreSelector(select, samePresence);
}
