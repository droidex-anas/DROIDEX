// The Canvas wordmark, and the picker it opens: the canvas on screen, New
// canvas, and the saved ones (spec §4). The wordmark stays the label so the row
// reads the same before and after the list is read; the canvas's own name heads
// the popover. Which chats work on that canvas is the chat column header's
// menu (`AttachedChatsMenu`), beside the transcript they write.

import { useCallback, useRef, useState } from 'react';
import { ChevronDown } from '@droidex/icons';
import { Popover } from '../../components/environment/Popover';
import { MENU_WIDTH_PX, MenuHeading, MenuNote, MenuRow } from './menuRows';
import { useCanvases } from './useCanvases';
import { searchCanvases } from './canvasChats';
import { useOpenCanvas } from './useOpenCanvas';

export function CanvasMenu({ canvasId }: { canvasId: string | null }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => {
    setOpen(false);
  }, []);
  const { openCanvas, startCanvasChat } = useOpenCanvas();
  // Read only while the picker is open: the list is a request, not pane state.
  const { canvases } = useCanvases(open);
  const summaries = canvases.status === 'listed' ? searchCanvases(canvases.summaries, '') : [];
  const canvas = summaries.find((summary) => summary.canvasId === canvasId) ?? null;

  return (
    <div className="flex min-w-0">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Canvas. Open the canvas picker"
        onClick={() => {
          setOpen((value) => !value);
        }}
        className="flex min-w-0 cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] font-medium text-droid-text transition-colors hover:bg-droid-elevated/50"
      >
        <span className="min-w-0 truncate">Canvas</span>
        <ChevronDown aria-hidden className="h-3 w-3 shrink-0 text-droid-text-muted" />
      </button>

      {/* The docked pane clips its overflow, so the picker is portalled and
          hangs from the trigger's right edge like the pane's own tool menu. */}
      <Popover
        open={open}
        onClose={close}
        anchorRef={triggerRef}
        align="right"
        width={MENU_WIDTH_PX}
        label="Canvas"
      >
        <div role="menu" aria-label="Canvas" className="min-h-0 overflow-y-auto p-1">
          {canvasId !== null && <MenuHeading>{canvas?.name ?? 'This canvas'}</MenuHeading>}

          <MenuHeading>Saved canvases</MenuHeading>
          <MenuRow
            label="New canvas"
            onRun={() => {
              close();
              startCanvasChat(null);
            }}
          />
          {canvases.status === 'loading' && (
            <MenuNote role="status">Reading saved canvases…</MenuNote>
          )}
          {canvases.status === 'failed' && <MenuNote role="alert">{canvases.message}</MenuNote>}
          {summaries
            .filter((summary) => summary.canvasId !== canvasId)
            .map((summary) => (
              <MenuRow
                key={summary.canvasId}
                label={summary.name}
                onRun={() => {
                  close();
                  openCanvas(summary);
                }}
              />
            ))}
        </div>
      </Popover>
    </div>
  );
}
