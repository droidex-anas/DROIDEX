// A design the agent made, as a card in the transcript (spec §4): the version
// its turn wrote, with that version's picture, its name, the stage the board
// shows for it, and Open, which brings the board up docked on that frame
// showing that version. It reads only the canvas's own snapshot and version
// list, never the design's source.

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import './canvasAnimations.css';
import './canvasBloom.css';
import './canvasArtifactCard.css';
import type { CanvasArtifact } from '../../components/chatFeedArtifacts';
import { useSessionLive } from '../../hooks/useSessionLive';
import { useStoreSelector } from '../../hooks/useStore';
import { toast } from '../../lib/toast';
import { Button } from '../../components/ui/Button';
import { useBoardOnScreen } from './boardOnScreen';
import { canvasClient } from './canvasClient';
import { coverRevision, useCanvasCover } from './canvasCovers';
import { CanvasToolsRecovery } from './CanvasPaneStates';
import { lacksCanvasTools } from './canvasState';
import { revisionNumber, useFrameHistory, type HistoryClient } from './frameHistory';
import { FrameThumbnail } from './FrameThumbnail';
import { useOpenCanvasPane } from './openCanvasPane';
import { PendingBloom } from './PendingBloom';
import { frameStatus, type FrameStatus } from './previewLabels';
import type { CanvasFrame, CanvasSnapshot } from './protocol';
import { useCanvasMotion } from './useCanvasMotion';
import type { CanvasActivityStage } from './canvasMotion';
import { MAX_REVISION_PAGE_SIZE } from './wireValidation';

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
  const board = useBoardOnScreen(canvasId);
  const openPane = useOpenCanvasPane();
  const status = frame ? frameStatus(frame, agentWorking) : null;
  const title = frame?.name ?? activity.title ?? 'Design';
  const more = designIds.length - 1;

  // The revision this card's turn wrote; a card without one follows the frame.
  const pinned = activity.revisionId;
  const { label, newer, earlier, show } = useVersions(appSessionId, canvasId, frame, pinned);
  // Showing the pinned version needs the frame, so the card waits for its canvas.
  const loading = pinned !== undefined && frame === undefined;

  const open = (revisionId: string | undefined) => {
    if (!frame) {
      openPane({ appSessionId, canvasId });
      return;
    }
    // The board opens at once and shows the version when the switch lands.
    if (revisionId) show(revisionId);
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
        disabled={loading}
        aria-busy={loading}
        onClick={() => {
          open(pinned);
        }}
        aria-label={`Open ${title}${label ? ` ${label}` : ''} on the canvas`}
      >
        <span className="canvas-artifact-sheet">
          <Sheet
            canvasId={canvasId}
            frame={frame}
            status={status}
            pictured={pictured}
            earlier={earlier}
          />
        </span>
        <span className="canvas-artifact-footer">
          <span className="canvas-artifact-text">
            <span className="canvas-artifact-title">{title}</span>
            <span className="canvas-artifact-meta">
              <FrameMeta
                frame={frame}
                stage={status?.stage ?? null}
                label={label}
                earlier={earlier !== null}
              />
              {more > 0 && ` · ${String(more)} more ${more === 1 ? 'frame' : 'frames'}`}
            </span>
          </span>
          <span className="canvas-artifact-open" aria-hidden>
            Open
          </span>
        </span>
      </button>
      {newer && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            open(newer.revisionId);
          }}
        >
          {`Open latest v${String(newer.version)}`}
        </Button>
      )}
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
 * The pinned revision's version label, the newest version when it is another,
 * and the pinned revision again when the frame has moved off it. Only a pinned
 * card reads the frame's version list.
 */
function useVersions(
  appSessionId: string,
  canvasId: string,
  frame: CanvasFrame | null | undefined,
  pinned: string | undefined,
) {
  const client = useMemo(
    (): HistoryClient => ({
      listRevisions: (designId) =>
        canvasClient.revisions.list(canvasId, designId, { limit: MAX_REVISION_PAGE_SIZE }),
      switchRevision: (input) => canvasClient.revisions.switchTo(appSessionId, canvasId, input),
    }),
    [appSessionId, canvasId],
  );
  const { history, list } = useFrameHistory(client, pinned ? (frame ?? null) : null);
  const version = revisionNumber(list, pinned ?? null);
  const latest = list.status === 'listed' ? list.revisions.at(0) : undefined;
  return {
    label: version === null ? null : `v${String(version)}`,
    newer: latest?.revisionId === pinned ? undefined : latest,
    earlier: pinned && frame && frame.revisionId !== pinned ? pinned : null,
    /** Shows a version on the frame as its version menu does, adding no revision. */
    show: (revisionId: string) => {
      void history.switchTo(revisionId).then((refusal) => {
        if (refusal) toast.error(refusal);
      });
    },
  };
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

/** The card's version, and the stage the board shows for its frame while that version is on show. */
function FrameMeta({
  frame,
  stage,
  label,
  earlier,
}: {
  frame: CanvasFrame | null | undefined;
  stage: CanvasActivityStage | null;
  label: string | null;
  earlier: boolean;
}) {
  const motion = useCanvasMotion();
  if (earlier) return label ?? 'Earlier version';
  return (
    <>
      {label && `${label} · `}
      {stage ? (
        // Rows only mount near the viewport, and a hidden window pauses
        // the loop, so a mounted card is a visible one.
        <PendingBloom stage={stage} visible motion={motion} />
      ) : (
        metaNote(frame)
      )}
    </>
  );
}

function metaNote(frame: CanvasFrame | null | undefined): string {
  if (frame === undefined) return 'Canvas';
  if (frame === null) return 'No longer on the canvas';
  return 'Empty frame';
}

/** The frame's last picture, or an earlier version's, or what the sheet says
    without one. Main keeps a picture once the board has run that revision, for
    this app run only; the frame the canvas's cover shows falls back to that
    cover across runs. */
function Sheet({
  canvasId,
  frame,
  status,
  pictured,
  earlier,
}: {
  canvasId: string;
  frame: CanvasFrame | null | undefined;
  status: FrameStatus | null;
  pictured: boolean;
  /** An older revision to picture in place of the frame's own. */
  earlier: string | null;
}) {
  if (!frame || !status) return null;
  const { stage, revisionId } = status;
  // Waits out a picture that is about to land, so the note never flashes.
  const note = (
    <span className="canvas-artifact-note canvas-state-reveal" data-delayed>
      No preview yet
    </span>
  );
  if (earlier)
    return (
      <FrameThumbnail
        canvasId={canvasId}
        designId={frame.designId}
        revisionId={earlier}
        fallback={note}
      />
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
