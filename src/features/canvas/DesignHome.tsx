// The Design draft area (spec §4). Two surfaces share its centred composer:
// the Design home, where every prompt makes a new canvas, and the draft a
// chosen canvas pins, where the prompt joins that canvas instead. They are
// deliberately separate: the home promises a canvas it has not got yet, so it
// declares that promise itself rather than trusting whoever navigated here —
// a restored window and a new tab reach this home with no draft of their own.

import { useEffect, useState, type ReactNode } from 'react';
import { BrandMark } from '../../components/BrandMark';
import PromptInput from '../../components/PromptInput';
import { Search } from '@droidex/icons';
import { useStoreDispatch, useStoreSelector } from '../../hooks/useStore';
import { formatRelativeTime } from '../../lib/time';
import { searchCanvases } from './canvasChats';
import { useCanvases } from './useCanvases';
import { useOpenCanvas } from './useOpenCanvas';
import type { CanvasSummary } from './protocol';

// Each one seeds the composer without sending, so the user keeps typing.
const EXAMPLES = [
  'A settings page with a theme toggle',
  'A pricing card with three tiers',
  'A dashboard with a usage chart',
  'A sign-in form with inline errors',
];

export function DesignHome() {
  // A canvas the user named by pressing a card, or by New chat with this
  // canvas, is already chosen; anything else here makes a new one.
  const pinnedCanvasId = useStoreSelector((current) => current.canvasDraft?.canvasId ?? null);
  return pinnedCanvasId === null ? (
    <NewCanvasHome />
  ) : (
    <CanvasChatDraft canvasId={pinnedCanvasId} />
  );
}

function NewCanvasHome() {
  const dispatch = useStoreDispatch();
  const { canvases } = useCanvases();
  const { openCanvas } = useOpenCanvas();
  const [query, setQuery] = useState('');
  const promised = useStoreSelector((current) => current.canvasDraft !== null);
  const summaries = canvases.status === 'listed' ? searchCanvases(canvases.summaries, query) : [];

  // What this home promises its next prompt, on whichever path led here.
  useEffect(() => {
    if (!promised) dispatch({ type: 'SET_CANVAS_DRAFT', canvasId: null });
  }, [dispatch, promised]);

  return (
    <DesignDraftShell
      title="What should we design?"
      hint="Every prompt here starts a new canvas and a chat attached to it."
    >
      <div className="droid-rise mt-12" style={{ animationDelay: '160ms' }}>
        <div className="flex items-center justify-between gap-3 px-1">
          <h2 className="text-[13px] font-medium text-droid-text">Your canvases</h2>
          <label className="flex min-w-0 items-center gap-1.5 rounded-lg bg-droid-elevated/50 px-2 py-1">
            <Search aria-hidden className="h-3.5 w-3.5 shrink-0 text-droid-text-muted" />
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
              }}
              placeholder="Search canvases"
              aria-label="Search canvases"
              className="w-32 min-w-0 bg-transparent text-[12px] text-droid-text placeholder:text-droid-text-muted focus:outline-none"
            />
          </label>
        </div>

        {canvases.status === 'loading' && (
          <p role="status" className="px-1 pt-3 text-[12px] text-droid-text-muted">
            Reading your canvases…
          </p>
        )}
        {canvases.status === 'failed' && (
          <p role="alert" className="px-1 pt-3 text-[12px] text-droid-red">
            {canvases.message}
          </p>
        )}
        {canvases.status === 'listed' && summaries.length === 0 && (
          <p className="px-1 pt-3 text-[12px] leading-relaxed text-droid-text-muted">
            {query
              ? 'No canvas by that name.'
              : 'Nothing designed yet. Your first prompt makes the first one.'}
          </p>
        )}
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {summaries.map((summary) => (
            <CanvasCard
              key={summary.canvasId}
              summary={summary}
              onOpen={() => {
                openCanvas(summary);
              }}
            />
          ))}
        </div>
      </div>
    </DesignDraftShell>
  );
}

/**
 * The draft a chosen canvas pins: "New chat with this canvas", and a card whose
 * own chats this window does not hold. Its prompt joins that canvas, so it
 * never offers the home's new-canvas promise or its grid.
 */
function CanvasChatDraft({ canvasId }: { canvasId: string }) {
  const { canvases } = useCanvases();
  const canvas =
    canvases.status === 'listed'
      ? (canvases.summaries.find((summary) => summary.canvasId === canvasId) ?? null)
      : null;
  return (
    <DesignDraftShell
      title={canvas ? `New chat on ${canvas.name}` : 'New chat on this canvas'}
      hint="This prompt starts a fresh chat on the canvas you opened; its designs stay as they are."
    />
  );
}

/** The centred composer both design drafts are sent from. */
function DesignDraftShell({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children?: ReactNode;
}) {
  const dispatch = useStoreDispatch();
  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div data-electron-drag-region className="h-9 shrink-0" />
      <div className="mx-auto flex w-full max-w-[calc(42rem+46px)] flex-col px-6 pb-10">
        <div className="droid-rise flex flex-col items-center pt-[6vh]">
          <BrandMark size={30} className="text-droid-accent" />
          <h1 className="mt-5 text-[22px] leading-snug font-semibold tracking-tight text-droid-text">
            {title}
          </h1>
          <p className="mt-2 text-center text-[13px] text-droid-text-muted">{hint}</p>
        </div>

        <div className="droid-rise mt-7" style={{ animationDelay: '90ms' }}>
          <DesignSystemChip />
          <PromptInput appSessionId={null} compact />
          <ul className="mt-2 flex flex-wrap gap-1.5 px-3">
            {EXAMPLES.map((example) => (
              <li key={example}>
                <button
                  type="button"
                  onClick={() => {
                    dispatch({ type: 'SEED_COMPOSER', text: example, replace: true });
                  }}
                  className="cursor-pointer rounded-full bg-droid-accent/[0.07] px-3 py-1.5 text-[12px] text-droid-text-secondary transition-colors hover:bg-droid-accent/15 hover:text-droid-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-droid-accent/60"
                >
                  {example}
                </button>
              </li>
            ))}
          </ul>
        </div>

        {children}
      </div>
    </div>
  );
}

/**
 * Where the design-system picker lands (Task 7b). Until it ships this states
 * the kit every request is pinned to rather than offering a control that
 * cannot change it.
 */
function DesignSystemChip() {
  return (
    <div className="mb-2 flex px-3">
      <span className="rounded-full bg-droid-elevated/60 px-2.5 py-1 text-[11px] text-droid-text-muted">
        Design system · DROIDEX
      </span>
    </div>
  );
}

function CanvasCard({ summary, onOpen }: { summary: CanvasSummary; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex cursor-pointer flex-col overflow-hidden rounded-xl bg-droid-raised text-left shadow-droid-sm transition-colors hover:bg-droid-active focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-droid-accent/60"
    >
      {/* A real thumbnail arrives with captured frames (Task 5c); until then the
          tile stays a quiet surface rather than a fake preview. */}
      <span className="flex h-[88px] items-center justify-center bg-droid-elevated/40 text-[11px] text-droid-text-muted">
        {summary.designCount === 0 ? 'Empty' : designCountLabel(summary.designCount)}
      </span>
      <span className="flex flex-col gap-0.5 px-3 py-2">
        <span className="truncate text-[12px] font-medium text-droid-text">{summary.name}</span>
        <span className="truncate text-[11px] text-droid-text-muted">
          {formatRelativeTime(summary.updatedAt, Date.now())} ·{' '}
          {chatCountLabel(summary.attachedAppSessionIds.length)}
        </span>
      </span>
    </button>
  );
}

function designCountLabel(count: number): string {
  return count === 1 ? '1 design' : `${String(count)} designs`;
}

function chatCountLabel(count: number): string {
  return count === 1 ? '1 chat' : `${String(count)} chats`;
}
