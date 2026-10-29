import { useState, type ReactNode } from 'react';
import { LayoutTemplate, Spinner } from '@droidex/icons';
import { useStoreDispatch } from '../../hooks/useStore';
import { canvasClient as canvas } from './canvasClient';
import { canvasMessage } from './client';
import { outdatedCanvasMessage } from './canvasState';
import type { CanvasSummary } from './protocol';
import { useOpenCanvas } from './useOpenCanvas';
import { DESIGN_STARTERS, StarterSketch } from './designStarters';

/**
 * The empty state from spec §4: the agent does the designing, so the starting
 * points lead and anything the user can do by hand follows them. Each one
 * seeds the chat's composer; nothing is sent, so the user can keep typing.
 */
export function CanvasInvitation({ children }: { children?: ReactNode }) {
  const dispatch = useStoreDispatch();
  return (
    <div className="flex h-full min-h-0 overflow-y-auto px-6">
      <div className="m-auto flex w-full max-w-md flex-col items-center gap-6 py-10">
        <div className="flex flex-col items-center gap-1 text-center">
          <h2 className="text-body-strong text-primary">Ask your agent to design something</h2>
          <p className="text-label font-normal text-secondary">
            Describe it in the chat, or start from one of these.
          </p>
        </div>
        <ul aria-label="Starting points" className="grid w-full grid-cols-2 gap-3">
          {DESIGN_STARTERS.map((starter) => (
            <li key={starter.label}>
              <button
                type="button"
                onClick={() => {
                  dispatch({ type: 'SEED_COMPOSER', text: starter.prompt, replace: true });
                }}
                className="group flex w-full cursor-pointer flex-col gap-1 rounded-xl bg-raised p-1.5 text-left shadow-sm transition-shadow duration-200 hover:shadow-lg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-focus-ring"
              >
                <span className="flex h-24 items-center justify-center rounded-lg bg-text/5 transition-colors duration-200 group-hover:bg-text/10">
                  <span className="transition-transform duration-200 motion-safe:group-hover:-translate-y-0.5">
                    <StarterSketch kind={starter.sketch} />
                  </span>
                </span>
                <span className="flex flex-col px-1.5 pb-1">
                  <span className="text-body-strong text-primary">{starter.label}</span>
                  <span className="truncate text-caption text-muted">{starter.hint}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        {children && <div className="flex w-full max-w-xs flex-col gap-3">{children}</div>}
      </div>
    </div>
  );
}

const CANVAS_TOOLS_MISSING =
  "This chat's agent started without the Canvas tools and cannot get them now. " +
  'Start a new chat; for an existing canvas, choose New chat with this canvas.';

/** Stands in for the invitation when the chat's agent cannot call the Canvas tools. */
export function CanvasToolsMissing({ canvasId }: { canvasId: string | null }) {
  return (
    <CanvasPlate title="This chat cannot design">
      <CanvasToolsRecovery canvasId={canvasId} />
    </CanvasPlate>
  );
}

export function CanvasToolsRecovery({ canvasId }: { canvasId: string | null }) {
  const { startCanvasChat } = useOpenCanvas();
  return (
    <>
      <CanvasNote>{CANVAS_TOOLS_MISSING}</CanvasNote>
      <div className="flex gap-1.5">
        <CanvasAction
          label={canvasId ? 'New chat with this canvas' : 'New chat'}
          onClick={() => {
            startCanvasChat(canvasId);
          }}
        />
      </div>
    </>
  );
}

export function CanvasEmptyState({
  error,
  outdatedName,
  onCreate,
  onChoose,
}: {
  error: string;
  /** This chat's canvas, made by an earlier DROIDEX that this one cannot open. */
  outdatedName?: string;
  onCreate: () => void;
  onChoose: (canvasId: string) => Promise<void>;
}) {
  const [saved, setSaved] = useState<SavedCanvases | null>(null);

  if (saved) {
    return (
      <SavedCanvasList
        saved={saved}
        onChoose={onChoose}
        onBack={() => {
          setSaved(null);
        }}
      />
    );
  }

  return (
    <CanvasInvitation>
      {outdatedName && (
        <CanvasNote>
          {outdatedCanvasMessage(outdatedName)} Create a new canvas to keep designing in this chat.
        </CanvasNote>
      )}
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
                setSaved({ status: 'failed', message: canvasMessage(failure) });
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
  saved,
  onChoose,
  onBack,
}: {
  saved: SavedCanvases;
  onChoose: (canvasId: string) => Promise<void>;
  onBack: () => void;
}) {
  const [attaching, setAttaching] = useState(false);

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
                    // The pane reports the outcome: a failure leaves this chat
                    // owing that canvas, which is what its recovery replays.
                    void onChoose(summary.canvasId);
                  }}
                  className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left transition-colors hover:bg-accent/15 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-focus-ring"
                >
                  <span className="truncate text-body text-primary">{summary.name}</span>
                  <span className="shrink-0 text-caption text-muted">
                    {designCountLabel(summary.designCount)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ))}
      <CanvasAction label="Back" onClick={onBack} />
    </CanvasPlate>
  );
}

// Controls on the card take a low-alpha accent tint rather than the elevated
// rung: a dark theme resolves `raised` to that same rung, so an elevated fill
// would leave them looking like plain text.

/** The calm centred card every pane state without a board sits on. */
export function CanvasPlate({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex h-full min-h-0 items-center justify-center px-5 pb-12">
      <div className="flex w-full max-w-xs flex-col gap-3 rounded-2xl bg-raised px-5 py-5 shadow-lg">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-muted">
            <LayoutTemplate className="h-4 w-4" />
          </span>
          <h2 className="min-w-0 text-body-strong text-primary">{title}</h2>
        </div>
        {children}
      </div>
    </div>
  );
}

export function CanvasNote({ children }: { children: ReactNode }) {
  return <p className="text-label font-normal leading-relaxed text-secondary">{children}</p>;
}

function CanvasFailure({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="text-label font-normal leading-relaxed text-danger">
      {children}
    </p>
  );
}

export function CanvasAction({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex-1 rounded-xl bg-accent/10 px-3 py-2 text-label text-primary transition-colors hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-focus-ring"
    >
      {label}
    </button>
  );
}

export function CanvasStatus({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center px-5">
      <CanvasStatusLine label={label} />
    </div>
  );
}

function CanvasStatusLine({ label }: { label: string }) {
  return (
    <p role="status" className="flex items-center gap-2 text-label font-normal text-muted">
      <Spinner size={14} className="shrink-0 motion-safe:animate-spin-slow" />
      {label}
    </p>
  );
}

function designCountLabel(count: number): string {
  return count === 1 ? '1 design' : `${String(count)} designs`;
}
