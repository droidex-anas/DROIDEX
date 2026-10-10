// The sidebar in Design mode: New canvas, then the user's canvases newest edit
// first (spec §4). It replaces the chat list, so it owns the same region.

import { SquarePen } from '@droidex/icons';
import { formatRelativeTime } from '../../lib/time';
import { useOpenCanvas } from './useOpenCanvas';
import { useCanvases } from './useCanvases';
import { searchCanvases } from './canvasChats';

export function DesignSidebar() {
  const { canvases } = useCanvases();
  const { openCanvas, startCanvasChat, activeCanvasId } = useOpenCanvas();
  const summaries = canvases.status === 'listed' ? searchCanvases(canvases.summaries, '') : [];

  return (
    <>
      <div className="px-2 pb-1.5">
        <button
          onClick={() => {
            startCanvasChat(null);
          }}
          className="group flex w-full cursor-pointer items-center gap-2.5 rounded-xl py-1.5 pr-3 pl-2.5 text-left text-[13px] font-medium text-droid-text"
        >
          <SquarePen className="h-4 w-4 shrink-0 text-droid-text-secondary transition-colors group-hover:text-droid-text" />
          New canvas
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        <div className="px-3 pt-1 pb-1 text-[11px] font-medium text-droid-text-muted">Recent</div>
        {canvases.status === 'loading' && (
          <p role="status" className="px-3 py-1 text-[12px] text-droid-text-muted">
            Reading your canvases…
          </p>
        )}
        {canvases.status === 'failed' && (
          <p role="alert" className="px-3 py-1 text-[12px] text-droid-red">
            {canvases.message}
          </p>
        )}
        {canvases.status === 'listed' && summaries.length === 0 && (
          <p className="px-3 py-1 text-[12px] leading-relaxed text-droid-text-muted">
            Nothing designed yet. New canvas starts one.
          </p>
        )}
        <ul className="flex flex-col gap-0.5">
          {summaries.map((summary) => (
            <li key={summary.canvasId}>
              <button
                type="button"
                aria-current={summary.canvasId === activeCanvasId}
                onClick={() => {
                  openCanvas(summary);
                }}
                className={`flex w-full cursor-pointer items-center gap-2 rounded-xl px-3 py-1.5 text-left transition-colors ${
                  summary.canvasId === activeCanvasId
                    ? 'bg-droid-accent/10 text-droid-text'
                    : 'text-droid-text-secondary hover:bg-droid-elevated/50 hover:text-droid-text'
                }`}
              >
                <span className="min-w-0 flex-1 truncate text-[13px]">{summary.name}</span>
                <span className="shrink-0 text-[11px] text-droid-text-muted">
                  {formatRelativeTime(summary.updatedAt, Date.now())}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
