import { useCallback, useEffect, useReducer, useRef, useState, type RefObject } from 'react';
import './canvasAnimations.css';
import { AgentPaneExpand } from '../../components/agents/AgentPaneExpand';
import { useSessionLive } from '../../hooks/useSessionLive';
import { canvasClient as canvas, reportPreview } from './canvasClient';
import { canvasMessage } from './client';
import { CanvasMenu } from './CanvasMenu';
import { CanvasBoard, type CanvasBoardHandle } from './CanvasBoard';
import { DesignPreview } from './DesignPreview';
import {
  CanvasAction,
  CanvasEmptyState,
  CanvasInvitation,
  CanvasNote,
  CanvasPlate,
  CanvasStatus,
} from './CanvasPaneStates';
import {
  acknowledgeAttachment,
  attachCanvasToChat,
  chooseCanvasForChat,
  owedAttachment,
} from './canvasChats';
import {
  initialCanvasPaneState,
  SELECT_MODE,
  type BoardInteraction,
  openSourceFrame,
  openSourcePanel,
  reduceCanvasPane,
  watchedCanvasId,
  type CanvasPaneState,
} from './canvasState';
import { CanvasSourceSlot } from './CanvasSourceSlot';
import type { ArrangeFramesInput, CanvasSnapshot } from './protocol';

const readArtifact = canvas.readArtifact.bind(canvas);

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
      namedCanvasId === undefined ? (owedAttachment(appSessionId)?.message ?? null) : null,
    ),
  );
  const [reopenCount, setReopenCount] = useState(0);
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
    // An attachment this chat still owes decides what the pane shows: reading
    // the sidecar now would report the state that operation has not reached.
    const owed = owedAttachment(appSessionId);
    if (owed) {
      dispatch({ type: 'attach-failed', message: owed.message });
      return;
    }
    let active = true;
    canvas
      .attachedCanvasId(appSessionId)
      .then((attached) => {
        if (active) attach(attached);
      })
      .catch((error: unknown) => {
        if (active) dispatch({ type: 'failed', message: canvasMessage(error) });
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
  const [interactionCanvasId, setInteractionCanvasId] = useState(watched);
  const [interaction, setInteraction] = useState(SELECT_MODE);
  if (interactionCanvasId !== watched) {
    setInteractionCanvasId(watched);
    setInteraction(SELECT_MODE);
  }

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

  /**
   * Starts the canvas this chat is owed, or replays the one it already owes:
   * `canvasChats` keeps the create mutation ID and the attach target, so Try
   * again cannot leave a second canvas behind.
   */
  const attachOwed = () => {
    dispatch({ type: 'attaching' });
    void settle(attachCanvasToChat(canvas, appSessionId, { canvasId: null }));
  };

  /** The canvas the user chose in place of whatever this chat owed. */
  const chooseCanvas = (chosen: string) =>
    settle(chooseCanvasForChat(canvas, appSessionId, chosen));

  const settle = (attaching: Promise<string | null>): Promise<void> =>
    attaching.then(
      (attached) => {
        acknowledgeAttachment(appSessionId);
        if (!mounted.current || currentTarget.current.appSessionId !== appSessionId) return;
        onAttachmentChange(appSessionId, attached);
        if (currentTarget.current.namedCanvasId === undefined)
          dispatch({ type: 'settled', canvasId: attached });
      },
      (error: unknown) => {
        if (
          mounted.current &&
          currentTarget.current.appSessionId === appSessionId &&
          currentTarget.current.namedCanvasId === undefined
        )
          dispatch({ type: 'attach-failed', message: canvasMessage(error) });
      },
    );

  return (
    <div
      data-testid="canvas-workspace"
      className="relative flex h-full min-h-0 flex-col bg-droid-bg"
    >
      {/* Expanded, the window's top row carries the canvas name and the
          Chat | Canvas control instead (`CanvasHeader`). */}
      {!isExpanded && (
        <div className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-lg bg-droid-raised px-1 shadow-droid-sm">
          {watched !== null && <CanvasMenu canvasId={watched} />}
          <AgentPaneExpand expanded={isExpanded} onToggle={onToggleExpanded} />
        </div>
      )}
      <CanvasBody
        state={state}
        appSessionId={appSessionId}
        interaction={interaction}
        onInteractionChange={setInteraction}
        boardRef={boardRef}
        onChoose={chooseCanvas}
        onAttachOwed={attachOwed}
        onRetry={() => {
          dispatch({ type: 'reopened' });
          setReopenCount((count) => count + 1);
        }}
        onOpenSource={(designId) => {
          dispatch(openSourcePanel(designId));
        }}
      />
      <CanvasSourceSlot
        frame={openSourceFrame(state)}
        canvasId={watched}
        appSessionId={appSessionId}
        onClose={() => {
          dispatch({ type: 'close-source' });
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
  onAttachOwed,
  onChoose,
  onRetry,
  onOpenSource,
}: {
  state: CanvasPaneState;
  appSessionId: string;
  interaction: BoardInteraction;
  onInteractionChange: (next: BoardInteraction) => void;
  boardRef: RefObject<CanvasBoardHandle | null>;
  onAttachOwed: () => void;
  onChoose: (canvasId: string) => Promise<void>;
  onRetry: () => void;
  onOpenSource: (designId: string) => void;
}) {
  switch (state.status) {
    case 'opening':
      return <CanvasStatus label="Opening Canvas…" />;
    case 'attaching':
      return <CanvasStatus label="Opening a canvas for this chat…" />;
    case 'attach-recovering':
      return (
        <CanvasPlate title="Check this chat's canvas">
          <CanvasNote>{state.message}</CanvasNote>
          <CanvasAction label="Try again" onClick={onAttachOwed} />
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
      return <CanvasEmptyState error={state.error} onCreate={onAttachOwed} onChoose={onChoose} />;
    case 'ready':
      return (
        <CanvasBoardMount
          appSessionId={appSessionId}
          snapshot={state.snapshot}
          interaction={interaction}
          onInteractionChange={onInteractionChange}
          boardRef={boardRef}
          onOpenSource={onOpenSource}
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
  onOpenSource,
}: {
  appSessionId: string;
  snapshot: CanvasSnapshot;
  interaction: BoardInteraction;
  onInteractionChange: (next: BoardInteraction) => void;
  boardRef: RefObject<CanvasBoardHandle | null>;
  onOpenSource: (designId: string) => void;
}) {
  const { canvasId } = snapshot;
  const agentWorking = useSessionLive(appSessionId);
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
          onOpenSource={onOpenSource}
          onArrangeFrames={arrangeFrames}
          interaction={interaction}
          onInteractionChange={onInteractionChange}
          agentWorking={agentWorking}
          renderPreview={(frame) => (
            <DesignPreview
              canvasId={canvasId}
              frame={frame}
              readArtifact={readArtifact}
              reportPreview={reportPreview}
            />
          )}
        />
      )}
    </div>
  );
}
