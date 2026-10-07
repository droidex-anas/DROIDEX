// The Canvas wordmark, and the picker it opens: the canvas on screen, the chats
// working on it, New chat with this canvas, New canvas, and the saved ones
// (spec §4). The wordmark stays the label so the row reads the same before and
// after the list is read; the canvas's own name heads the popover.

import { useCallback, useRef, useState } from 'react';
import { Check, ChevronDown } from '@droidex/icons';
import { Popover } from '../../components/environment/Popover';
import { shallowEqual, useStoreSelector, type AppState } from '../../hooks/useStore';
import { chatDisplayTitle } from '../../lib/chatMetadata';
import { useCanvases } from './useCanvases';
import { searchCanvases } from './canvasChats';
import { useOpenCanvas } from './useOpenCanvas';

/** Wide enough for a canvas name; the same picker width the pane's tools use. */
const PICKER_WIDTH_PX = 248;

export function CanvasMenu({
  appSessionId,
  canvasId,
}: {
  appSessionId: string;
  /** Null while this chat has no canvas yet, so the picker only offers saved ones. */
  canvasId: string | null;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => {
    setOpen(false);
  }, []);
  const { openCanvas, showCanvasInChat, startCanvasChat } = useOpenCanvas();
  // Read only while the picker is open: the list is a request, not pane state.
  const { canvases } = useCanvases(open);
  const summaries = canvases.status === 'listed' ? searchCanvases(canvases.summaries, '') : [];
  const canvas = summaries.find((summary) => summary.canvasId === canvasId) ?? null;
  const attached = canvas?.attachedAppSessionIds ?? [];
  const titles = useStoreSelector((current) => chatTitles(current, attached), shallowEqual);

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
        width={PICKER_WIDTH_PX}
        label="Canvas"
      >
        <div role="menu" aria-label="Canvas" className="min-h-0 overflow-y-auto p-1">
          {canvasId !== null && (
            <>
              <MenuHeading>{canvas?.name ?? 'This canvas'}</MenuHeading>
              {attached.length === 0 && (
                <p className="px-2.5 pb-1 text-[11px] text-droid-text-muted">
                  Only this chat, so far.
                </p>
              )}
              {attached.map((id) => {
                const reachable = id in titles;
                return (
                  <MenuRow
                    key={id}
                    label={reachable ? titles[id] : 'Another window'}
                    checked={id === appSessionId}
                    disabled={!reachable}
                    onRun={() => {
                      close();
                      // The board on screen travels with the switch, so the
                      // other chat opens on this canvas rather than on
                      // whatever its pane last showed.
                      if (id !== appSessionId) showCanvasInChat(id, canvasId);
                    }}
                  />
                );
              })}
              <MenuRow
                label="New chat with this canvas"
                onRun={() => {
                  close();
                  startCanvasChat(canvasId);
                }}
              />
            </>
          )}

          <MenuHeading>Saved canvases</MenuHeading>
          <MenuRow
            label="New canvas"
            onRun={() => {
              close();
              startCanvasChat(null);
            }}
          />
          {canvases.status === 'loading' && (
            <p role="status" className="px-2.5 pb-1 text-[11px] text-droid-text-muted">
              Reading saved canvases…
            </p>
          )}
          {canvases.status === 'failed' && (
            <p role="alert" className="px-2.5 pb-1 text-[11px] text-droid-red">
              {canvases.message}
            </p>
          )}
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

/**
 * The chats this window can name and switch to. A chat the session list does
 * not hold is another window's, so it stays listed but unreachable rather than
 * silently missing from a canvas that counts it.
 */
function chatTitles(state: AppState, appSessionIds: string[]): Record<string, string> {
  const titles: Record<string, string> = {};
  for (const id of appSessionIds) {
    if (id in state.sessions)
      titles[id] = chatDisplayTitle(state.sessions[id], state.chatMetadata[id]);
  }
  return titles;
}

function MenuHeading({ children }: { children: string }) {
  return (
    <div className="truncate px-2.5 pb-1 pt-2 text-[11px] font-medium text-droid-text-muted first:pt-1">
      {children}
    </div>
  );
}

function MenuRow({
  label,
  checked = false,
  disabled = false,
  onRun,
}: {
  label: string;
  checked?: boolean;
  disabled?: boolean;
  onRun: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onRun}
      className="flex h-8 w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 text-left transition-colors hover:bg-droid-accent/10 focus-visible:bg-droid-accent/10 focus-visible:outline-none disabled:cursor-default disabled:opacity-60 disabled:hover:bg-transparent"
    >
      <span className="min-w-0 flex-1 truncate text-[12px] text-droid-text">{label}</span>
      {checked && <Check aria-label="Current" className="h-3.5 w-3.5 shrink-0 text-droid-accent" />}
    </button>
  );
}
