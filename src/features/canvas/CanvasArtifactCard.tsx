// A design the agent made, as a card in the transcript (spec §4): its last
// picture, its name, the stage the board shows for it, and Open, which brings
// the board up docked on that frame. It reads only the canvas's own snapshot,
// never the design's source.

import { useEffect, useState, type ReactNode } from 'react';
import './canvasAnimations.css';
import './canvasBloom.css';
import './canvasArtifactCard.css';
import type { CanvasArtifact } from '../../components/chatFeedArtifacts';
import { useSessionLive } from '../../hooks/useSessionLive';
import { useStoreSelector } from '../../hooks/useStore';
import { useBoardOnScreen } from './boardOnScreen';
import { canvasClient } from './canvasClient';
import { coverRevision, useCanvasCover } from './canvasCovers';
import { CanvasToolsRecovery } from './CanvasPaneStates';
import { lacksCanvasTools } from './canvasState';
import { FrameThumbnail } from './FrameThumbnail';
import { useOpenCanvasPane } from './openCanvasPane';
import { PendingBloom } from './PendingBloom';
import { frameStatus, type FrameStatus } from './previewLabels';
import type { CanvasFrame, CanvasSnapshot } from './protocol';
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
  const { frame, pictured } = useCanvasFrame(canvasId, designId);
  const agentWorking = useSessionLive(appSessionId);
  const toolsMissing = useStoreSelector((current) =>
    lacksCanvasTools(current.sessions[appSessionId]),
  );
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
    <>
      <button
        type="button"
        className="canvas-artifact"
        onClick={open}
        aria-label={`Open ${title} on the canvas`}
      >
        <span className="canvas-artifact-sheet">
          <Sheet canvasId={canvasId} frame={frame} status={status} pictured={pictured} />
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
      {toolsMissing && frame?.revisionId === null && (
        // A frame this chat reserved and can no longer write.
        <div className="flex max-w-xs flex-col gap-3">
          <CanvasToolsRecovery canvasId={canvasId} />
        </div>
      )}
    </>
  );
}

/**
 * The frame as its canvas has it (undefined until the canvas loads, null once
 * it is gone), and whether it is the frame the canvas's cover pictures.
 */
function useCanvasFrame(
  canvasId: string,
  designId: string | null,
): { frame: CanvasFrame | null | undefined; pictured: boolean } {
  // A canvas this page already watches (the board beside a design chat) has
  // the frame at hand, so the card opens on its stage, not its loading line.
  const [snapshot, setSnapshot] = useState(() => canvasClient.snapshotOf(canvasId));
  useEffect(() => canvasClient.subscribeCanvas(canvasId, setSnapshot), [canvasId]);
  if (!snapshot) return { frame: undefined, pictured: false };
  return {
    frame: frameIn(snapshot, designId),
    pictured: coverRevision(snapshot.frames)?.designId === designId,
  };
}

function frameIn(snapshot: CanvasSnapshot, designId: string | null): CanvasFrame | null {
  return snapshot.frames.find((candidate) => candidate.designId === designId) ?? null;
}

function metaNote(frame: CanvasFrame | null | undefined): string {
  if (frame === undefined) return 'Canvas';
  if (frame === null) return 'No longer on the canvas';
  return 'Empty frame';
}

/** The frame's last picture, or what the sheet says without one. Main keeps a
    picture once the board has run that revision, for this app run only; the
    frame the canvas's cover shows falls back to that cover across runs. */
function Sheet({
  canvasId,
  frame,
  status,
  pictured,
}: {
  canvasId: string;
  frame: CanvasFrame | null | undefined;
  status: FrameStatus | null;
  pictured: boolean;
}) {
  if (!frame || !status) return null;
  const { stage, revisionId } = status;
  // Waits out a picture that is about to land, so the note never flashes.
  const note = (
    <span className="canvas-artifact-note canvas-state-reveal" data-delayed>
      No preview yet
    </span>
  );
  // A design on its way has nothing to show yet; its stage is named below.
  const underway = stage === 'queued' || stage === 'writing' || stage === 'building';
  if (revisionId === null) return underway ? null : note;
  return (
    <FrameThumbnail
      canvasId={canvasId}
      designId={frame.designId}
      revisionId={revisionId}
      fallback={pictured ? <Cover canvasId={canvasId} fallback={note} /> : note}
    />
  );
}

function Cover({ canvasId, fallback }: { canvasId: string; fallback: ReactNode }) {
  const cover = useCanvasCover(canvasId);
  if (cover === undefined) return null;
  if (cover === null) return fallback;
  // The cover is the top of the frame cut to the tile's shape, as on the Design home.
  return (
    <img
      className="canvas-state-reveal h-full w-full object-cover object-top"
      src={cover}
      alt=""
      draggable={false}
    />
  );
}
