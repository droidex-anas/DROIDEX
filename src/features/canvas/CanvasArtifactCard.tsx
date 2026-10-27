// A design the agent made, as a card in the transcript (spec §4): its last
// picture, its name, the stage the board shows for it, and Open, which brings
// the board up docked on that frame. It reads only the canvas's own snapshot,
// never the design's source.

import { useEffect, useState } from 'react';
import './canvasBloom.css';
import './canvasArtifactCard.css';
import type { CanvasArtifact } from '../../components/chatFeedArtifacts';
import { useSessionLive } from '../../hooks/useSessionLive';
import { useBoardOnScreen } from './boardOnScreen';
import { canvasClient } from './canvasClient';
import type { CanvasActivityStage } from './canvasMotion';
import { FrameThumbnail } from './FrameThumbnail';
import { useOpenCanvasPane } from './openCanvasPane';
import { PendingBloom } from './PendingBloom';
import type { CanvasFrame } from './protocol';
import { useCanvasMotion } from './useCanvasMotion';

export default function CanvasArtifactCard({
  appSessionId,
  activity,
}: {
  appSessionId: string;
  activity: CanvasArtifact;
}) {
  const { canvasId, designIds } = activity;
  const designId = designIds.at(0) ?? null;
  const frame = useCanvasFrame(canvasId, designId);
  const agentWorking = useSessionLive(appSessionId);
  const motion = useCanvasMotion();
  const board = useBoardOnScreen(canvasId);
  const openPane = useOpenCanvasPane();
  const status = frame ? frameStatus(frame, agentWorking) : null;
  const title = frame?.name ?? activity.title ?? 'Design';
  const more = designIds.length - 1;

  const open = () => {
    if (!frame) {
      openPane({ appSessionId, canvasId });
      return;
    }
    openPane({ appSessionId, canvasId, frameId: frame.designId });
    // The pane focuses its opener's frame once per target, so a board already
    // showing this frame is focused here instead.
    if (board?.appSessionId === appSessionId) board.focusFrame(frame.designId);
  };

  return (
    <button
      type="button"
      className="canvas-artifact"
      onClick={open}
      aria-label={`Open ${title} on the canvas`}
    >
      <span className="canvas-artifact-sheet">
        <Sheet canvasId={canvasId} frame={frame} revisionId={status?.revisionId ?? null} />
      </span>
      <span className="canvas-artifact-footer">
        <span className="canvas-artifact-text">
          <span className="canvas-artifact-title">{title}</span>
          <span className="canvas-artifact-meta">
            {status?.stage ? (
              // Rows only mount near the viewport, and a hidden window pauses
              // the loop, so a mounted card is a visible one.
              <PendingBloom stage={status.stage} visible motion={motion} />
            ) : (
              metaNote(frame)
            )}
            {more > 0 && ` · ${String(more)} more ${more === 1 ? 'frame' : 'frames'}`}
          </span>
        </span>
        <span className="canvas-artifact-open" aria-hidden>
          Open
        </span>
      </span>
    </button>
  );
}

/** The frame as its canvas has it: undefined until the canvas loads, null once it is gone. */
function useCanvasFrame(canvasId: string, designId: string | null): CanvasFrame | null | undefined {
  const [frame, setFrame] = useState<CanvasFrame | null | undefined>(undefined);
  useEffect(
    () =>
      canvasClient.subscribeCanvas(canvasId, (snapshot) => {
        setFrame(snapshot.frames.find((candidate) => candidate.designId === designId) ?? null);
      }),
    [canvasId, designId],
  );
  return frame;
}

/** The board's stage for a frame, and the revision whose picture it can show. */
function frameStatus(
  frame: CanvasFrame,
  agentWorking: boolean,
): { stage: CanvasActivityStage | null; revisionId: string | null } {
  // A reserved frame is being written only while its chat has a turn running.
  if (frame.revisionId === null)
    return { stage: agentWorking ? 'writing' : null, revisionId: null };
  const { build } = frame;
  switch (build.status) {
    case 'pending':
      return { stage: 'queued', revisionId: null };
    case 'building':
      return { stage: 'building', revisionId: null };
    case 'ready':
      return { stage: 'ready', revisionId: build.revisionId };
    case 'failed':
      return { stage: 'failed', revisionId: build.lastWorkingRevisionId };
    case 'cancelled':
      return { stage: 'cancelled', revisionId: null };
  }
}

function metaNote(frame: CanvasFrame | null | undefined): string {
  if (frame === undefined) return 'Canvas';
  if (frame === null) return 'No longer on the canvas';
  return 'Empty frame';
}

/** The frame's last picture, or what the sheet says without one. Main keeps a
    picture once the board has run that revision. */
function Sheet({
  canvasId,
  frame,
  revisionId,
}: {
  canvasId: string;
  frame: CanvasFrame | null | undefined;
  revisionId: string | null;
}) {
  if (!frame) return null;
  const note = <span className="canvas-artifact-note">No preview yet</span>;
  if (revisionId === null) return note;
  return (
    <FrameThumbnail
      canvasId={canvasId}
      designId={frame.designId}
      revisionId={revisionId}
      fallback={note}
    />
  );
}
