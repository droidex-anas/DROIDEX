// What the Design home adds to the new-chat home (spec §4), loaded with the
// canvas chunk: the canvases already made, under its starting points, and the
// library item its next canvas starts from, in the composer's row.

import { useEffect, useId, useState } from 'react';
import { LibraryBig } from 'lucide-react';
import { Search, X } from '@droidex/icons';
import { formatRelativeTime } from '../../lib/time';
import { searchCanvases } from './canvasChats';
import { useCanvasCover } from './canvasCovers';
import { LibraryPicker } from './LibraryPicker';
import { armLibrarySeed, useArmedLibrarySeed } from './librarySeed';
import { useCanvases } from './useCanvases';
import { useOpenCanvas } from './useOpenCanvas';
import type { CanvasSummary } from './protocol';

// The search field earns its place once the grid is longer than a glance.
const SEARCH_THRESHOLD = 6;

/**
 * The canvases already made, under the composer. A first run has none, so the
 * section stays out of the way until there is something to reopen.
 */
export function RecentCanvases() {
  const { canvases } = useCanvases();
  const { openCanvas } = useOpenCanvas();
  const [query, setQuery] = useState('');
  const headingId = useId();

  if (canvases.status === 'loading') return null;
  if (canvases.status === 'failed')
    return (
      <p role="alert" className="text-caption text-danger">
        {canvases.message}
      </p>
    );
  if (canvases.summaries.length === 0) return null;

  const summaries = searchCanvases(canvases.summaries, query);
  return (
    <section aria-labelledby={headingId} className="droid-rise">
      <div className="flex h-control-md items-center justify-between gap-3 px-0.5">
        <h2 id={headingId} className="text-body-strong text-primary">
          Recent canvases
        </h2>
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
        <p className="px-0.5 pt-2 text-caption text-muted">No canvas by that name.</p>
      ) : (
        <div
          className="mt-2 grid gap-3"
          // Cards keep a cover's width: three beside a full composer, fewer in a
          // narrow tile, and one canvas does not stretch across the row.
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(12rem, 1fr))' }}
        >
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
export function LibrarySeedChip() {
  const armed = useArmedLibrarySeed();
  const [picking, setPicking] = useState(false);
  useEffect(
    () => () => {
      armLibrarySeed(null);
    },
    [],
  );
  return (
    // Sized like the design system control beside it.
    <div
      className={`flex h-control-sm max-w-fit grow basis-0 items-center rounded-md ${
        armed ? 'min-w-11 bg-active/60' : 'min-w-control-sm'
      }`}
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
        className="flex h-full min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-2 text-muted transition-colors hover:bg-active/60 hover:text-primary"
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

/** A canvas's cover over its name, in the starting points' tile. */
function CanvasCard({ summary, onOpen }: { summary: CanvasSummary; onOpen: () => void }) {
  const cover = useCanvasCover(summary.canvasId);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex w-full cursor-pointer flex-col gap-1 rounded-xl bg-raised p-1.5 text-left shadow-sm transition duration-200 ease-out hover:shadow-lg active:scale-97 active:duration-75"
    >
      <span className="relative aspect-tile overflow-hidden rounded-lg bg-text/5">
        {cover ? (
          <img
            src={cover}
            alt=""
            draggable={false}
            className="size-full object-cover object-top motion-safe:animate-fade-in"
          />
        ) : (
          // The board's dot grid until the canvas has a picture: before its
          // first frame works, or before its board was opened with this cover.
          cover === null && <span aria-hidden className="image-grid-dots absolute inset-0" />
        )}
      </span>
      <span className="flex min-w-0 flex-col px-1.5 pb-1">
        <span className="truncate text-body-strong text-primary">{summary.name}</span>
        <span className="truncate text-caption text-muted">{editedLabel(summary.updatedAt)}</span>
      </span>
    </button>
  );
}

function editedLabel(updatedAt: number): string {
  const ago = formatRelativeTime(updatedAt, Date.now());
  return ago === 'now' ? 'Edited just now' : `Edited ${ago} ago`;
}
