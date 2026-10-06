// The Canvas tab of the utility pane. It shows a named canvas when Open supplies
// one; otherwise it reads and watches the chat's attachment.
// Opening it only ever reads: no canvas is minted and no build is started until
// the user presses Create (spec §4, §6).
//
// The board, frames, gestures, navigator and toolbar mount in the body below
// (Tasks 5b–5e); this file owns the pane's lifecycle and its empty state.

import { useCallback, useEffect, useReducer, useRef, useState, type ReactNode } from 'react';
import { LayoutTemplate, Spinner } from '@droidex/icons';
import { AgentPaneExpand } from '../../components/agents/AgentPaneExpand';
import { useStoreDispatch } from '../../hooks/useStore';
import { bridge } from '../../lib/bridge';
import { CanvasClient } from './client';
import {
  CREATE_RECOVERY_MESSAGE,
  initialCanvasPaneState,
  reduceCanvasPane,
  watchedCanvasId,
  type CanvasPaneState,
} from './canvasState';
import type { CanvasSummary } from './protocol';

const canvas = new CanvasClient(bridge);
// A Create may finish after its tab unmounts. Keep its key until a mounted pane
// confirms the reply, so reopening cannot offer a second Create.
const pendingCreateMutationIds = new Map<string, string>();

export function CanvasWorkspace({
  appSessionId,
  canvasId,
  namedCanvasId,
  isExpanded,
  onToggleExpanded,
  onAttachmentChange,
}: {
  appSessionId: string;
  /** The attachment the app already knows of, so a reopened pane does not blink. */
  canvasId: string | null;
  /** An explicit Open target, viewed without moving the chat's attachment. */
  namedCanvasId?: string;
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

  const create = () => {
    if (createInFlight.current === appSessionId) return;
    createInFlight.current = appSessionId;
    const mutationId = pendingCreateMutationIds.get(appSessionId) ?? crypto.randomUUID();
    pendingCreateMutationIds.set(appSessionId, mutationId);
    dispatch({ type: 'creating' });
    canvas
      .createCanvas(appSessionId, mutationId)
      .then((created) => {
        if (!mounted.current || currentTarget.current.appSessionId !== appSessionId) return;
        pendingCreateMutationIds.delete(appSessionId);
        onAttachmentChange(appSessionId, created);
        if (currentTarget.current.namedCanvasId === undefined)
          dispatch({ type: 'created', canvasId: created });
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
  onAttached,
  onCreate,
  onRetry,
}: {
  state: CanvasPaneState;
  appSessionId: string;
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
          appSessionId={appSessionId}
          error={state.error}
          onCreate={onCreate}
          onAttached={onAttached}
        />
      );
    case 'ready':
      return <CanvasBoardMount frameCount={state.snapshot.frames.length} />;
  }
}

/**
 * Where `CanvasBoard` mounts in 5b. Until then the pane states what the
 * snapshot subscription is holding rather than drawing a board that is not here.
 */
function CanvasBoardMount({ frameCount }: { frameCount: number }) {
  return (
    <div data-canvas-board className="min-h-0 flex-1">
      {frameCount === 0 ? (
        <CanvasInvitation />
      ) : (
        <CanvasPlate title={`${designCountLabel(frameCount)} on this canvas`}>
          <CanvasNote>
            Ask your agent in the composer to change one of them, or to design something new.
          </CanvasNote>
        </CanvasPlate>
      )}
    </div>
  );
}

// Starting points for a canvas with nothing on it. Each one seeds the chat's
// own composer; nothing is sent, so the user can keep typing or press Enter.
const EXAMPLE_REQUESTS = [
  'Design a settings page with a theme toggle',
  'Design a pricing card with three tiers',
  'Design a dashboard with a usage chart',
];

/**
 * The empty state from spec §4: the agent does the designing, so the example
 * requests lead and anything the user can do by hand follows them.
 */
function CanvasInvitation({ children }: { children?: ReactNode }) {
  const dispatch = useStoreDispatch();
  return (
    <CanvasPlate title="Ask your agent to design something">
      <CanvasNote>
        Describe a screen, a component or a small app and it is designed on this canvas.
      </CanvasNote>
      <ul className="-mx-1.5 flex flex-col gap-0.5">
        {EXAMPLE_REQUESTS.map((request) => (
          <li key={request}>
            <button
              type="button"
              onClick={() => {
                dispatch({ type: 'SEED_COMPOSER', text: request });
              }}
              className="group flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-[12px] text-droid-text-secondary transition-colors hover:bg-droid-accent/10 hover:text-droid-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-droid-accent/60"
            >
              <span className="shrink-0 text-droid-accent opacity-0 transition-opacity group-hover:opacity-100">
                &gt;
              </span>
              <span className="min-w-0 flex-1">{request}</span>
            </button>
          </li>
        ))}
      </ul>
      {children}
    </CanvasPlate>
  );
}

function CanvasEmptyState({
  appSessionId,
  error,
  onCreate,
  onAttached,
}: {
  appSessionId: string;
  error: string;
  onCreate: () => void;
  onAttached: (canvasId: string) => void;
}) {
  const [saved, setSaved] = useState<SavedCanvases | null>(null);

  if (saved) {
    return (
      <SavedCanvasList
        appSessionId={appSessionId}
        saved={saved}
        onAttached={onAttached}
        onBack={() => {
          setSaved(null);
        }}
      />
    );
  }

  return (
    <CanvasInvitation>
      {error && <CanvasFailure>{error}</CanvasFailure>}
      <div className="flex gap-1.5">
        <CanvasAction label="Create canvas" onClick={onCreate} />
        <CanvasAction
          label="Open saved canvas"
          onClick={() => {
            setSaved({ status: 'loading' });
            canvas
              .listCanvases()
              .then((summaries) => {
                setSaved({ status: 'listed', summaries });
              })
              .catch((failure: unknown) => {
                setSaved({ status: 'failed', message: recoveryMessage(failure) });
              });
          }}
        />
      </div>
    </CanvasInvitation>
  );
}

type SavedCanvases =
  | { status: 'loading' }
  | { status: 'listed'; summaries: CanvasSummary[] }
  | { status: 'failed'; message: string };

function SavedCanvasList({
  appSessionId,
  saved,
  onAttached,
  onBack,
}: {
  appSessionId: string;
  saved: SavedCanvases;
  onAttached: (canvasId: string) => void;
  onBack: () => void;
}) {
  const [attaching, setAttaching] = useState(false);
  const [error, setError] = useState('');

  return (
    <CanvasPlate title="Saved canvases">
      {saved.status === 'loading' && <CanvasStatusLine label="Reading saved canvases…" />}
      {saved.status === 'failed' && <CanvasFailure>{saved.message}</CanvasFailure>}
      {saved.status === 'listed' &&
        (saved.summaries.length === 0 ? (
          <CanvasNote>Nothing has been designed yet. Create a canvas to start one.</CanvasNote>
        ) : (
          <ul className="-mx-1.5 flex max-h-56 flex-col gap-0.5 overflow-y-auto">
            {saved.summaries.map((summary) => (
              <li key={summary.canvasId}>
                <button
                  type="button"
                  disabled={attaching}
                  onClick={() => {
                    setAttaching(true);
                    setError('');
                    canvas
                      .attachCanvas(appSessionId, summary.canvasId)
                      .then(() => {
                        onAttached(summary.canvasId);
                      })
                      .catch((failure: unknown) => {
                        setAttaching(false);
                        setError(recoveryMessage(failure));
                      });
                  }}
                  className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left transition-colors hover:bg-droid-accent/15 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-droid-accent/60"
                >
                  <span className="truncate text-[13px] text-droid-text">{summary.name}</span>
                  <span className="shrink-0 text-[11px] text-droid-text-muted">
                    {designCountLabel(summary.designCount)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ))}
      {error && <CanvasFailure>{error}</CanvasFailure>}
      <CanvasAction label="Back" onClick={onBack} />
    </CanvasPlate>
  );
}

// Controls on the card take a low-alpha accent tint rather than the elevated
// rung: a dark theme resolves `raised` to that same rung, so an elevated fill
// would leave them looking like plain text.

/** The calm centred card every pane state without a board sits on. */
function CanvasPlate({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex h-full min-h-0 items-center justify-center px-5 pb-[6vh]">
      <div className="flex w-full max-w-[320px] flex-col gap-3 rounded-2xl bg-droid-raised px-5 py-5 shadow-droid">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-droid-accent/10 text-droid-text-muted">
            <LayoutTemplate className="h-4 w-4" />
          </span>
          <h2 className="min-w-0 text-[13px] font-medium text-droid-text">{title}</h2>
        </div>
        {children}
      </div>
    </div>
  );
}

function CanvasNote({ children }: { children: ReactNode }) {
  return <p className="text-[12px] leading-relaxed text-droid-text-secondary">{children}</p>;
}

function CanvasFailure({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="text-[12px] leading-relaxed text-droid-red">
      {children}
    </p>
  );
}

function CanvasAction({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex-1 rounded-xl bg-droid-accent/10 px-3 py-2 text-[12px] font-medium text-droid-text transition-colors hover:bg-droid-accent/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-droid-accent/60"
    >
      {label}
    </button>
  );
}

function CanvasStatus({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center px-5">
      <CanvasStatusLine label={label} />
    </div>
  );
}

function CanvasStatusLine({ label }: { label: string }) {
  return (
    <p role="status" className="flex items-center gap-2 text-[12px] text-droid-text-muted">
      <Spinner size={14} className="shrink-0 motion-safe:animate-spin-slow" />
      {label}
    </p>
  );
}

function designCountLabel(count: number): string {
  return count === 1 ? '1 design' : `${String(count)} designs`;
}

/** The short recovery line a Canvas failure carries; never a stack trace. */
function recoveryMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : 'Canvas could not finish that request.';
}
