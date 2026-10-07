// The Canvas tab of the utility pane. It shows a named canvas when Open supplies
// one; otherwise it reads and watches the chat's attachment.
// Opening it only ever reads: no canvas is minted and no build is started until
// the user presses Create (spec §4, §6).
//
// This file owns the pane's lifecycle and the seam between the board and the
// bridge: the board asks for a layout write and a preview artifact, and the pane
// is what knows which chat and which canvas those belong to. Every state without
// a board belongs to `CanvasPaneStates`. The navigator and toolbar (5d) and the
// canvas header (5e) mount beside the board.

import { useCallback, useEffect, useReducer, useRef, useState, type RefObject } from 'react';
import { AgentPaneExpand } from '../../components/agents/AgentPaneExpand';
import { bridge } from '../../lib/bridge';
import { CanvasBoard, type CanvasBoardHandle } from './CanvasBoard';
import { CanvasClient } from './client';
import {
  CanvasAction,
  CanvasEmptyState,
  CanvasInvitation,
  CanvasNote,
  CanvasPlate,
  CanvasStatus,
} from './CanvasPaneStates';
import {
  CREATE_RECOVERY_MESSAGE,
  initialCanvasPaneState,
  recoveryMessage,
  reduceCanvasPane,
  SELECT_MODE,
  watchedCanvasId,
  type BoardInteraction,
  type CanvasPaneState,
} from './canvasState';
import { DesignPreview } from './DesignPreview';
import type { ArrangeFramesInput, CanvasSnapshot } from './protocol';

const canvas = new CanvasClient(bridge);
// A bound method, so every preview's artifact read keeps one identity: a fresh
// function each render would tear down and remount every mounted guest.
const readArtifact = canvas.readArtifact.bind(canvas);
// A Create may finish after its tab unmounts. Keep its key until a mounted pane
// confirms the reply, so reopening cannot offer a second Create.
const pendingCreateMutationIds = new Map<string, string>();

export function CanvasWorkspace({
  appSessionId,
  canvasId,
  namedCanvasId,
  frameId,
  isExpanded,
  onToggleExpanded,
  onAttachmentChange,
}: {
  appSessionId: string;
  /** The attachment the app already knows of, so a reopened pane does not blink. */
  canvasId: string | null;
  /** An explicit Open target, viewed without moving the chat's attachment. */
  namedCanvasId?: string;
  /** The frame the opener meant, focused once the board has it. */
  frameId?: string;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  onAttachmentChange: (appSessionId: string, canvasId: string | null) => void;
}) {
  const [state, dispatch] = useReducer(reduceCanvasPane, namedCanvasId ?? canvasId, (initialId) =>
    initialCanvasPaneState(
      initialId,
      namedCanvasId === undefined && pendingCreateMutationIds.has(appSessionId),
    ),
  );
  const [reopenCount, setReopenCount] = useState(0);
  const createInFlight = useRef<string | null>(null);
  const currentTarget = useRef({ appSessionId, namedCanvasId });
  currentTarget.current = { appSessionId, namedCanvasId };
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const attach = useCallback(
    (attached: string | null) => {
      dispatch({ type: 'attached', canvasId: attached });
      onAttachmentChange(appSessionId, attached);
    },
    [appSessionId, onAttachmentChange],
  );

  // The sidecar owns the attachment; a named Open views its target directly.
  useEffect(() => {
    if (namedCanvasId !== undefined) {
      dispatch({ type: 'selected', canvasId: namedCanvasId });
      return;
    }
    if (pendingCreateMutationIds.has(appSessionId)) {
      dispatch({ type: 'create-failed', message: CREATE_RECOVERY_MESSAGE });
      return;
    }
    let active = true;
    canvas
      .attachedCanvasId(appSessionId)
      .then((attached) => {
        if (active) attach(attached);
      })
      .catch((error: unknown) => {
        if (active) dispatch({ type: 'failed', message: recoveryMessage(error) });
      });
    return () => {
      active = false;
    };
  }, [appSessionId, attach, namedCanvasId, reopenCount]);

  const watched = watchedCanvasId(state);
  useEffect(() => {
    if (watched === null) return undefined;
    return canvas.subscribeCanvas(watched, (snapshot) => {
      dispatch({ type: 'snapshot', snapshot });
    });
  }, [watched]);

  // Mode and selection belong to the canvas on screen, so showing another one
  // starts from Select with nothing picked.
  const [interaction, setInteraction] = useState(SELECT_MODE);
  useEffect(() => {
    setInteraction(SELECT_MODE);
  }, [watched]);

  // The opener's frame is focused once the board is up, and only once per
  // target: re-running it on every snapshot would drag the viewport back while
  // the user was reading somewhere else.
  const boardRef = useRef<CanvasBoardHandle | null>(null);
  const focused = useRef<string | null>(null);
  useEffect(() => {
    if (frameId === undefined || watched === null) return;
    const target = `${watched}:${frameId}`;
    if (focused.current === target || !boardRef.current) return;
    focused.current = target;
    boardRef.current.focusFrame(frameId);
  }, [frameId, watched, state]);

  const create = () => {
    if (createInFlight.current === appSessionId) return;
    createInFlight.current = appSessionId;
    const mutationId = pendingCreateMutationIds.get(appSessionId) ?? crypto.randomUUID();
    pendingCreateMutationIds.set(appSessionId, mutationId);
    dispatch({ type: 'creating' });
    canvas
      .createCanvas(appSessionId, mutationId)
      .then(({ attachedCanvasId }) => {
        if (!mounted.current || currentTarget.current.appSessionId !== appSessionId) return;
        pendingCreateMutationIds.delete(appSessionId);
        onAttachmentChange(appSessionId, attachedCanvasId);
        if (currentTarget.current.namedCanvasId === undefined)
          dispatch({ type: 'created', canvasId: attachedCanvasId });
      })
      .catch((error: unknown) => {
        if (
          mounted.current &&
          currentTarget.current.appSessionId === appSessionId &&
          currentTarget.current.namedCanvasId === undefined
        )
          dispatch({ type: 'create-failed', message: recoveryMessage(error) });
      })
      .finally(() => {
        if (createInFlight.current === appSessionId) createInFlight.current = null;
      });
  };

  return (
    <div
      data-testid="canvas-workspace"
      className="relative flex h-full min-h-0 flex-col bg-droid-bg"
    >
      <div className="absolute right-2 top-2 z-10 rounded-lg bg-droid-raised shadow-droid-sm">
        <AgentPaneExpand expanded={isExpanded} onToggle={onToggleExpanded} />
      </div>
      <CanvasBody
        state={state}
        appSessionId={appSessionId}
        interaction={interaction}
        onInteractionChange={setInteraction}
        boardRef={boardRef}
        onAttached={attach}
        onCreate={create}
        onRetry={() => {
          dispatch({ type: 'reopened' });
          setReopenCount((count) => count + 1);
        }}
      />
    </div>
  );
}

function CanvasBody({
  state,
  appSessionId,
  interaction,
  onInteractionChange,
  boardRef,
  onAttached,
  onCreate,
  onRetry,
}: {
  state: CanvasPaneState;
  appSessionId: string;
  interaction: BoardInteraction;
  onInteractionChange: (next: BoardInteraction) => void;
  boardRef: RefObject<CanvasBoardHandle | null>;
  onAttached: (canvasId: string) => void;
  onCreate: () => void;
  onRetry: () => void;
}) {
  switch (state.status) {
    case 'opening':
      return <CanvasStatus label="Opening Canvas…" />;
    case 'creating':
      return <CanvasStatus label="Creating a canvas…" />;
    case 'create-recovering':
      return (
        <CanvasPlate title="Check canvas creation">
          <CanvasNote>{state.message}</CanvasNote>
          <CanvasAction label="Try again" onClick={onCreate} />
        </CanvasPlate>
      );
    case 'loading':
      return <CanvasStatus label="Loading this canvas…" />;
    case 'failed':
      return (
        <CanvasPlate title="Canvas is not available">
          <CanvasNote>{state.message}</CanvasNote>
          <CanvasAction label="Try again" onClick={onRetry} />
        </CanvasPlate>
      );
    case 'unattached':
      return (
        <CanvasEmptyState
          error={state.error}
          onCreate={onCreate}
          onListCanvases={() => canvas.listCanvases()}
          onAttach={(canvasId) => canvas.attachCanvas(appSessionId, canvasId)}
          onAttached={onAttached}
        />
      );
    case 'ready':
      return (
        <CanvasBoardMount
          appSessionId={appSessionId}
          snapshot={state.snapshot}
          interaction={interaction}
          onInteractionChange={onInteractionChange}
          boardRef={boardRef}
        />
      );
  }
}

/**
 * The board, bound to the canvas it is showing. A canvas whose frames were all
 * deleted presents the invitation instead (spec §4), because an empty board is
 * not an answer to "what do I do here".
 */
function CanvasBoardMount({
  appSessionId,
  snapshot,
  interaction,
  onInteractionChange,
  boardRef,
}: {
  appSessionId: string;
  snapshot: CanvasSnapshot;
  interaction: BoardInteraction;
  onInteractionChange: (next: BoardInteraction) => void;
  boardRef: RefObject<CanvasBoardHandle | null>;
}) {
  const { canvasId } = snapshot;
  const arrangeFrames = useCallback(
    (input: ArrangeFramesInput) => canvas.arrangeFrames(appSessionId, canvasId, input),
    [appSessionId, canvasId],
  );

  return (
    <div data-canvas-board className="min-h-0 flex-1">
      {snapshot.frames.length === 0 ? (
        <CanvasInvitation />
      ) : (
        <CanvasBoard
          ref={boardRef}
          snapshot={snapshot}
          onArrangeFrames={arrangeFrames}
          interaction={interaction}
          onInteractionChange={onInteractionChange}
          renderPreview={(frame) => (
            <DesignPreview canvasId={canvasId} frame={frame} readArtifact={readArtifact} />
          )}
        />
      )}
    </div>
  );
}
