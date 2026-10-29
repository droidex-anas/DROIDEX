// The Design draft area (spec §4). Two surfaces share its centred composer:
// the Design home, where every prompt makes a new canvas, and the draft a
// chosen canvas pins, where the prompt joins that canvas instead. The draft on
// screen carries which one it is.

import { useEffect, useState, type ReactNode } from 'react';
import { LibraryBig } from 'lucide-react';
import PromptInput from '../../components/PromptInput';
import { Search, X } from '@droidex/icons';
import { useStoreDispatch, useStoreSelector } from '../../hooks/useStore';
import { formatRelativeTime } from '../../lib/time';
import { searchCanvases } from './canvasChats';
import { DESIGN_STARTERS } from './designStarters';
import { NEW_CANVAS_KEY } from './designSystemChoices';
import { CanvasDesignSystem } from './DesignSystemPicker';
import { LibraryPicker } from './LibraryPicker';
import { armLibrarySeed, useArmedLibrarySeed } from './librarySeed';
import { useCanvases } from './useCanvases';
import { useOpenCanvas } from './useOpenCanvas';
import type { CanvasSummary } from './protocol';

const DESIGN_PLACEHOLDER = 'Describe a screen, a flow, or a component…';

// The search field earns its place once the grid is longer than a glance.
const SEARCH_THRESHOLD = 6;

// The entrance plays on the first visit only; returning to Design is instant.
let homeEntered = false;

function useEntrance(): boolean {
  const [animate] = useState(() => !homeEntered);
  useEffect(() => {
    homeEntered = true;
  }, []);
  return animate;
}

function rise(animate: boolean, delayMs: number) {
  return animate
    ? { className: 'droid-rise', style: { animationDelay: `${String(delayMs)}ms` } }
    : { className: '', style: undefined };
}

export function DesignHome() {
  // A canvas the user named by pressing a card, or by New chat with this
  // canvas, is already chosen; anything else here makes a new one.
  const pinnedCanvasId = useStoreSelector((current) => current.draftChat?.canvas?.canvasId ?? null);
  return pinnedCanvasId === null ? (
    <NewCanvasHome />
  ) : (
    <CanvasChatDraft canvasId={pinnedCanvasId} />
  );
}

function NewCanvasHome() {
  const animate = useEntrance();
  return (
    <DesignDraftShell
      canvasKey={NEW_CANVAS_KEY}
      title="What should we design?"
      animate={animate}
      startingPoint={<LibrarySeedChip />}
      showStarters
    >
      <RecentCanvases animate={animate} />
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
      canvasKey={canvasId}
      title={canvas ? `New chat on ${canvas.name}` : 'New chat on this canvas'}
      animate={false}
    />
  );
}

/** The centred composer both design drafts are sent from. */
function DesignDraftShell({
  canvasKey,
  title,
  animate,
  startingPoint,
  showStarters = false,
  children,
}: {
  /** Whose design-system choice the draft's prompt runs under. */
  canvasKey: string;
  title: string;
  animate: boolean;
  /** What a new canvas starts from, beside the design-system chip. */
  startingPoint?: ReactNode;
  showStarters?: boolean;
  children?: ReactNode;
}) {
  const dispatch = useStoreDispatch();
  // A hovered or focused starter shows its whole prompt in the empty composer.
  const [preview, setPreview] = useState<string | null>(null);
  const heading = rise(animate, 0);
  const composer = rise(animate, 70);
  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div
        // The composer's column (PromptInput) plus this page's own inset.
        style={{ maxWidth: 'calc(42rem + 46px)' }}
        className="mx-auto flex min-h-full w-full flex-col px-6"
      >
        <div data-electron-drag-region className="h-9 shrink-0" />
        <div className="flex flex-1 flex-col justify-center py-12">
          <h1
            className={`text-balance text-center text-title text-primary ${heading.className}`}
            style={heading.style}
          >
            {title}
          </h1>

          <div className={`mt-8 ${composer.className}`} style={composer.style}>
            <PromptInput appSessionId={null} compact placeholder={preview ?? DESIGN_PLACEHOLDER} />
            <div className="flex gap-1 px-3">
              <CanvasDesignSystem canvasKey={canvasKey} appSessionId={null} />
              {startingPoint}
            </div>
          </div>

          {showStarters && (
            <ul aria-label="Starting points" className="mt-6 max-w-md px-3">
              {DESIGN_STARTERS.map((starter, index) => {
                const entry = rise(animate, 140 + index * 30);
                return (
                  <li key={starter.label} className={entry.className} style={entry.style}>
                    <button
                      type="button"
                      onClick={() => {
                        setPreview(null);
                        dispatch({ type: 'SEED_COMPOSER', text: starter.prompt, replace: true });
                      }}
                      onMouseEnter={() => {
                        setPreview(starter.prompt);
                      }}
                      onMouseLeave={() => {
                        setPreview(null);
                      }}
                      onFocus={() => {
                        setPreview(starter.prompt);
                      }}
                      onBlur={() => {
                        setPreview(null);
                      }}
                      className="group flex w-full cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-left transition-colors hover:bg-elevated/60"
                    >
                      <span className="w-20 shrink-0 text-body-strong text-secondary transition-colors group-hover:text-primary">
                        {starter.label}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-body text-muted transition-colors group-hover:text-secondary">
                        {starter.hint}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {children}
      </div>
    </div>
  );
}

/**
 * The canvases already made, under the composer. A first run has none, so the
 * section stays out of the way until there is something to reopen.
 */
function RecentCanvases({ animate }: { animate: boolean }) {
  const { canvases } = useCanvases();
  const { openCanvas } = useOpenCanvas();
  const [query, setQuery] = useState('');
  const section = rise(animate, 260);

  if (canvases.status === 'loading') return null;
  if (canvases.status === 'failed')
    return (
      <p role="alert" className="px-3 pb-10 text-caption text-danger">
        {canvases.message}
      </p>
    );
  if (canvases.summaries.length === 0) return null;

  const summaries = searchCanvases(canvases.summaries, query);
  return (
    <section
      aria-label="Recent canvases"
      className={`pb-10 ${section.className}`}
      style={section.style}
    >
      <div className="flex h-control-md items-center justify-between gap-3 px-3">
        <h2 className="text-label text-muted">Recent</h2>
        {canvases.summaries.length > SEARCH_THRESHOLD && (
          <label className="flex min-w-0 items-center gap-1.5 rounded-md bg-elevated px-2 py-1">
            <Search aria-hidden className="size-icon-sm shrink-0 text-muted" />
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
              }}
              placeholder="Search canvases"
              aria-label="Search canvases"
              className="w-32 min-w-0 bg-transparent text-label font-normal text-primary placeholder:text-muted focus:outline-none"
            />
          </label>
        )}
      </div>
      {summaries.length === 0 ? (
        <p className="px-3 pt-2 text-caption text-muted">No canvas by that name.</p>
      ) : (
        <div className="mt-2 grid grid-cols-2 gap-3 px-3 sm:grid-cols-3">
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
      )}
    </section>
  );
}

/**
 * From library on the Design home: the item the next prompt's canvas starts
 * from, its first frame an independent copy. The send makes the canvas, so
 * picking only arms it; leaving the home drops it.
 */
function LibrarySeedChip() {
  const armed = useArmedLibrarySeed();
  const [picking, setPicking] = useState(false);
  useEffect(
    () => () => {
      armLibrarySeed(null);
    },
    [],
  );
  return (
    <div
      className={`flex min-w-0 shrink-0 items-center rounded-full text-caption ${armed ? 'bg-elevated/60' : ''}`}
    >
      <button
        type="button"
        aria-haspopup="dialog"
        aria-label={
          armed
            ? `Starts from ${armed.name}. Choose another saved frame`
            : 'Start from a saved frame'
        }
        title="Start the new canvas from a frame saved to the library"
        onClick={() => {
          setPicking(true);
        }}
        className="flex min-w-0 cursor-pointer items-center gap-1.5 rounded-full px-2.5 py-1 text-muted transition-colors hover:bg-active hover:text-primary"
      >
        <LibraryBig aria-hidden className="size-icon-sm shrink-0" />
        <span className="max-w-40 truncate">{armed ? armed.name : 'From library…'}</span>
      </button>
      {armed && (
        <button
          type="button"
          aria-label={`Start blank instead of from ${armed.name}`}
          title="Start blank"
          onClick={() => {
            armLibrarySeed(null);
          }}
          className="-ml-1 mr-1 flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted transition-colors hover:bg-active hover:text-primary"
        >
          <X aria-hidden className="h-2.5 w-2.5" strokeWidth={3} />
        </button>
      )}
      {picking && (
        <LibraryPicker
          canvasId={null}
          onPick={(item) => {
            armLibrarySeed(item);
            return Promise.resolve();
          }}
          onClose={() => {
            setPicking(false);
          }}
        />
      )}
    </div>
  );
}

function CanvasCard({ summary, onOpen }: { summary: CanvasSummary; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex cursor-pointer flex-col overflow-hidden rounded-xl bg-surface text-left transition-colors hover:bg-elevated"
    >
      {/* No captured thumbnail yet, so the tile stays plain rather than
          showing a fake preview. */}
      <span className="flex h-24 items-end justify-end bg-elevated/40 p-2 text-caption text-muted">
        {summary.designCount === 0 ? 'Empty' : designCountLabel(summary.designCount)}
      </span>
      <span className="flex flex-col gap-0.5 px-3 py-2.5">
        <span className="truncate text-body-strong text-primary">{summary.name}</span>
        <span className="truncate text-caption text-muted">
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
