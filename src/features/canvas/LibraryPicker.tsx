// From library (spec §7): the saved frames, newest first, each with the
// picture it was saved with and the canvas it came from. What a pick does is
// the owner's: a board places a frame, the Design home starts its next canvas.

import { useEffect, useId, useRef, useState } from 'react';
import { canvasClient } from './canvasClient';
import { CanvasDialog, FIELD_CLASS, QUIET_BUTTON_CLASS } from './CanvasDialog';
import { canvasMessage } from './client';
import type { CanvasSummary, LibraryItem } from './protocol';
import { useCanvases } from './useCanvases';

type Listing =
  | { status: 'loading' }
  /** `query` is the search these items answer, which the box may have moved past. */
  | { status: 'listed'; items: LibraryItem[]; query: string }
  | { status: 'failed'; message: string };

export function LibraryPicker({
  canvasId,
  onPick,
  onClose,
}: {
  /** The canvas a pick lands on, whose own items read "From this canvas"; null before it exists. */
  canvasId: string | null;
  /** Uses the item. The picker closes once it resolves and shows why it rejected. */
  onPick: (item: LibraryItem) => Promise<void>;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const { listing, retry } = useLibraryItems(query);
  const { canvases } = useCanvases();
  const [adding, setAdding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const titleId = useId();

  const add = async (item: LibraryItem) => {
    if (adding !== null) return;
    setAdding(item.itemId);
    setError(null);
    try {
      await onPick(item);
      onClose();
    } catch (failure) {
      setError(canvasMessage(failure));
      setAdding(null);
    }
  };

  const origin = (item: LibraryItem) =>
    canvases.status === 'listed' ? originLabel(item, canvasId, canvases.summaries) : null;

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
                  className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-droid-accent/10 focus-visible:bg-droid-accent/10 focus-visible:outline-none disabled:cursor-default disabled:opacity-60 disabled:hover:bg-transparent"
                >
                  <LibraryThumbnail itemId={item.itemId} />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-[12px] text-droid-text">
                      {adding === item.itemId ? `Adding ${item.name}…` : item.name}
                    </span>
                    <span className="truncate text-[11px] text-droid-text-muted">
                      {[sizeLabel(item), origin(item)].filter(Boolean).join(' · ')}
                    </span>
                  </span>
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

/**
 * The picture the item was saved with, read by item like a frame's capture. An
 * item saved before its frame was ever previewed has none, and says so.
 */
function LibraryThumbnail({ itemId }: { itemId: string }) {
  // Undefined until the read answers, so the tile stays quiet rather than
  // flashing "No preview" before the picture arrives.
  const [png, setPng] = useState<string | null>();
  useEffect(() => {
    let active = true;
    canvasClient.library.thumbnail(itemId).then(
      (read) => {
        if (active) setPng(read);
      },
      (error: unknown) => {
        if (active) setPng(null);
        console.error('A library thumbnail could not be read:', error);
      },
    );
    return () => {
      active = false;
    };
  }, [itemId]);
  return (
    <span className="flex h-10 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-droid-raised text-[10px] text-droid-text-muted shadow-droid-sm">
      {png ? (
        <img
          src={`data:image/png;base64,${png}`}
          alt=""
          draggable={false}
          className="h-full w-full object-cover"
        />
      ) : (
        png === null && 'No preview'
      )}
    </span>
  );
}

function sizeLabel(item: LibraryItem): string {
  return `${String(Math.round(item.width))} × ${String(Math.round(item.height))}`;
}

function originLabel(
  item: LibraryItem,
  canvasId: string | null,
  summaries: CanvasSummary[],
): string {
  if (item.sourceCanvasId === canvasId) return 'From this canvas';
  const source = summaries.find((summary) => summary.canvasId === item.sourceCanvasId);
  return source ? `From ${source.name}` : 'From a deleted canvas';
}
