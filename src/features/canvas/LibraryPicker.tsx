// From library (spec §7): the saved frames, newest first, and the one the user
// picks placed on this canvas as a new frame beside the selection. An item
// keeps no picture, so a row names it and the canvas it was saved from.

import { useEffect, useId, useRef, useState } from 'react';
import { canvasClient } from './canvasClient';
import type { BoardOnScreen } from './boardOnScreen';
import { CanvasDialog, FIELD_CLASS, QUIET_BUTTON_CLASS } from './CanvasDialog';
import { canvasMessage, CanvasRequestError } from './client';
import type { CanvasSummary, LibraryItem } from './protocol';
import { useCanvases } from './useCanvases';

// An item records no size, so it takes the selected frame's or a square.
const DEFAULT_FRAME_PX = 720;

type Listing =
  | { status: 'loading' }
  /** `query` is the search these items answer, which the box may have moved past. */
  | { status: 'listed'; items: LibraryItem[]; query: string }
  | { status: 'failed'; message: string };

export function LibraryPicker({ board, onClose }: { board: BoardOnScreen; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const { listing, retry } = useLibraryItems(query);
  const { canvases } = useCanvases();
  const [adding, setAdding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // One mutation per item until the sidecar answers, so picking it again after
  // a lost reply finds the frame that request placed instead of a second one.
  const attempt = useRef<{ itemId: string; mutationId: string } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const titleId = useId();

  const add = async (item: LibraryItem) => {
    if (adding !== null) return;
    if (attempt.current?.itemId !== item.itemId)
      attempt.current = { itemId: item.itemId, mutationId: crypto.randomUUID() };
    const beside = board.selected.at(0);
    setAdding(item.itemId);
    setError(null);
    try {
      const created = await canvasClient.createFrames(board.appSessionId, board.canvasId, {
        mutationId: attempt.current.mutationId,
        ...(beside ? { placeBeside: { designId: beside.designId } } : {}),
        frames: [
          {
            name: item.name,
            width: beside?.rect.width ?? DEFAULT_FRAME_PX,
            height: beside?.rect.height ?? DEFAULT_FRAME_PX,
            designSystem: item.designSystem,
            seed: { kind: 'library', itemId: item.itemId },
          },
        ],
      });
      const frame = created.frames.at(0);
      if (frame) board.focusFrame(frame.designId);
      onClose();
    } catch (failure) {
      if (failure instanceof CanvasRequestError) attempt.current = null;
      setError(canvasMessage(failure));
      setAdding(null);
    }
  };

  const origin = (item: LibraryItem) =>
    canvases.status === 'listed' ? originLabel(item, board.canvasId, canvases.summaries) : null;

  return (
    <CanvasDialog
      labelledBy={titleId}
      onClose={adding === null ? onClose : null}
      initialFocus={searchRef}
      style={{ height: 'min(480px, calc(100vh - 2.5rem))' }}
      className="flex w-full max-w-md flex-col"
    >
      <div className="flex flex-col gap-3 px-5 pb-3 pt-5">
        <h2 id={titleId} className="text-[15px] font-semibold text-droid-text">
          From library
        </h2>
        <input
          ref={searchRef}
          type="search"
          value={query}
          aria-label="Search the library"
          placeholder="Search saved frames"
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          className={`h-8 ${FIELD_CLASS}`}
        />
        {error && (
          <p role="alert" className="text-[12px] text-droid-red">
            {error}
          </p>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {listing.status === 'loading' && (
          <p role="status" className="px-2 py-1 text-[12px] text-droid-text-muted">
            Reading the library…
          </p>
        )}
        {listing.status === 'failed' && (
          <div className="flex flex-col items-start gap-2 px-2 py-1">
            <p role="alert" className="text-[12px] text-droid-red">
              {listing.message}
            </p>
            <button type="button" onClick={retry} className={QUIET_BUTTON_CLASS}>
              Try again
            </button>
          </div>
        )}
        {listing.status === 'listed' && listing.items.length === 0 && (
          <p className="px-2 py-1 text-[12px] leading-5 text-droid-text-muted">
            {listing.query === ''
              ? 'Nothing is saved yet. Select a frame and choose Save to library in the canvas menu.'
              : `No saved frame is named like “${listing.query}”.`}
          </p>
        )}
        {listing.status === 'listed' && listing.items.length > 0 && (
          <ul aria-label="Saved frames" className="flex flex-col gap-0.5">
            {listing.items.map((item) => (
              <li key={item.itemId}>
                <button
                  type="button"
                  disabled={adding !== null}
                  onClick={() => {
                    void add(item);
                  }}
                  className="flex w-full cursor-pointer flex-col items-start gap-0.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-droid-accent/10 focus-visible:bg-droid-accent/10 focus-visible:outline-none disabled:cursor-default disabled:opacity-60 disabled:hover:bg-transparent"
                >
                  <span className="w-full truncate text-[12px] text-droid-text">
                    {adding === item.itemId ? `Adding ${item.name}…` : item.name}
                  </span>
                  {origin(item) && (
                    <span className="w-full truncate text-[11px] text-droid-text-muted">
                      {origin(item)}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </CanvasDialog>
  );
}

/** The sidecar does the matching; the last answer stays on screen while the next is read. */
function useLibraryItems(query: string): { listing: Listing; retry: () => void } {
  const [listing, setListing] = useState<Listing>({ status: 'loading' });
  const [retries, setRetries] = useState(0);
  const trimmed = query.trim();
  useEffect(() => {
    let active = true;
    canvasClient.library.list(trimmed).then(
      (items) => {
        if (active) setListing({ status: 'listed', items, query: trimmed });
      },
      (error: unknown) => {
        if (active) setListing({ status: 'failed', message: canvasMessage(error) });
      },
    );
    return () => {
      active = false;
    };
  }, [trimmed, retries]);
  const retry = () => {
    setListing({ status: 'loading' });
    setRetries((count) => count + 1);
  };
  return { listing, retry };
}

function originLabel(item: LibraryItem, canvasId: string, summaries: CanvasSummary[]): string {
  if (item.sourceCanvasId === canvasId) return 'From this canvas';
  const source = summaries.find((summary) => summary.canvasId === item.sourceCanvasId);
  return source ? `From ${source.name}` : 'From a deleted canvas';
}
