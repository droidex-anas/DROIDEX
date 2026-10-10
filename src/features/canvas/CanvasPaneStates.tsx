import { useState, type ReactNode } from 'react';
import { LayoutTemplate, Spinner } from '@droidex/icons';
import { useStoreDispatch } from '../../hooks/useStore';
import { canvasClient as canvas } from './canvasClient';
import { canvasMessage } from './client';
import type { CanvasSummary } from './protocol';

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
export function CanvasInvitation({ children }: { children?: ReactNode }) {
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
          This chat’s canvas, “{outdatedName}”, was made by an earlier DROIDEX and can’t be opened
          here. Create a new one to keep designing in this chat.
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

export function CanvasNote({ children }: { children: ReactNode }) {
  return <p className="text-[12px] leading-relaxed text-droid-text-secondary">{children}</p>;
}

function CanvasFailure({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="text-[12px] leading-relaxed text-droid-red">
      {children}
    </p>
  );
}

export function CanvasAction({ label, onClick }: { label: string; onClick: () => void }) {
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

export function CanvasStatus({ label }: { label: string }) {
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
