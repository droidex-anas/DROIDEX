// Throwaway: counts the commits of what the board's mount reads from the store.
import { Profiler } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { useSessionLive } from '../../../src/hooks/useSessionLive';
import { StoreProvider, useStoreDispatch } from '../../../src/hooks/useStore';
import { useCanvasPresence } from '../../../src/features/canvas/useCanvasPresence';
import type { CanvasFrame } from '../../../src/features/canvas/protocol';

const FRAMES = [
  { designId: 'a', revisionId: 'rev_1' },
  { designId: 'b', revisionId: 'rev_1' },
  { designId: 'c', revisionId: null },
] as unknown as CanvasFrame[];

let commits = 0;
let renders = 0;
let commitMs = 0;

function Board() {
  renders += 1;
  const live = useSessionLive('chat');
  const presence = useCanvasPresence('chat', FRAMES);
  return (
    <div id="board" data-live={String(live)}>
      {[...presence].map(([designId, agent]) => `${designId}:${agent.name}`).join(' ')}
    </div>
  );
}

function Probe() {
  const dispatch = useStoreDispatch();
  Object.assign(window, {
    probe: {
      dispatch: (action: unknown) => {
        flushSync(() => dispatch(action as never));
      },
      counts: () => ({ commits, renders, commitMs }),
    },
  });
  return (
    <Profiler
      id="board"
      onRender={(_id, _phase, actual) => {
        commits += 1;
        commitMs += actual;
      }}
    >
      <Board />
    </Profiler>
  );
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StoreProvider>
    <Probe />
  </StoreProvider>,
);
