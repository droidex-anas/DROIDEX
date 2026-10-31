import { useState } from 'react';
import { useStoreDispatch, useStoreSelector } from '../../hooks/useStore';
import { DropCue } from './TileDropTarget';
import { endPlaceDrag, isPlaceDrag, usePlaceDrag } from './tileDrag';

// Covers Design while a chat is dragged. A design never splits, so a chat
// dropped anywhere on it opens in a tab of its own.
export function DesignDropTarget() {
  const dispatch = useStoreDispatch();
  const drag = usePlaceDrag();
  const activeAppSessionId = useStoreSelector((state) => state.activeAppSessionId);
  const [over, setOver] = useState(false);
  if (drag?.kind !== 'chat' || drag.appSessionId === activeAppSessionId) return null;

  return (
    <div
      className="absolute inset-0 z-30"
      // No pointer event arrives while a drag runs, so one here means it ended
      // without reaching its source.
      onPointerMove={endPlaceDrag}
      onPointerDown={endPlaceDrag}
      onDragOver={(event) => {
        if (!isPlaceDrag(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        setOver(true);
      }}
      onDragLeave={() => {
        setOver(false);
      }}
      onDrop={(event) => {
        setOver(false);
        if (!isPlaceDrag(event)) return;
        event.preventDefault();
        endPlaceDrag();
        dispatch({ type: 'OPEN_TAB', page: { kind: 'chat', appSessionId: drag.appSessionId } });
      }}
    >
      {over && (
        <DropCue className="inset-0 flex items-center justify-center">
          <span className="rounded-md bg-raised px-2.5 py-1 text-label text-secondary shadow-sm">
            Open in a new tab
          </span>
        </DropCue>
      )}
    </div>
  );
}
