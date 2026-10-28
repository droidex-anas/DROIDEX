// The sidebar in Design mode: New canvas in place of the chat navigation, then
// the user's canvases newest edit first in place of the chat list (spec §4).

import { SquarePen } from '@droidex/icons';
import { formatRelativeTime } from '../../lib/time';
import { useOpenCanvas } from './useOpenCanvas';
import { useCanvases } from './useCanvases';
import { searchCanvases } from './canvasChats';

export function NewCanvasRow() {
  const { startCanvasChat } = useOpenCanvas();
  return (
    <div className="px-2 pb-1.5">
      <button
        onClick={() => {
          startCanvasChat(null);
        }}
        className="group flex w-full cursor-pointer items-center gap-2.5 rounded-xl py-1.5 pr-3 pl-2.5 text-left text-body-strong text-primary"
      >
        <SquarePen className="h-4 w-4 shrink-0 text-secondary transition-colors group-hover:text-primary" />
        New canvas
      </button>
    </div>
  );
}

export function DesignSidebar() {
  const { canvases } = useCanvases();
  const { openCanvas, activeCanvasId } = useOpenCanvas();
  const summaries = canvases.status === 'listed' ? searchCanvases(canvases.summaries, '') : [];

  return (
    <div>
      <div className="px-3 pt-1 pb-1 text-caption font-medium text-muted">Recent</div>
      {canvases.status === 'loading' && (
        <p role="status" className="px-3 py-1 text-label font-normal text-muted">
          Reading your canvases…
        </p>
      )}
      {canvases.status === 'failed' && (
        <p role="alert" className="px-3 py-1 text-label font-normal text-danger">
          {canvases.message}
        </p>
      )}
      {canvases.status === 'listed' && summaries.length === 0 && (
        <p className="px-3 py-1 text-label font-normal leading-relaxed text-muted">
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
                  ? 'bg-accent/10 text-primary'
                  : 'text-secondary hover:bg-elevated/50 hover:text-primary'
              }`}
            >
              <span className="min-w-0 flex-1 truncate text-body">{summary.name}</span>
              <span className="shrink-0 text-caption text-muted">
                {formatRelativeTime(summary.updatedAt, Date.now())}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
