// The chat column's header control in the canvas workspace (spec §4): it names
// the chat on screen and opens the chats working on that chat's canvas, plus
// New chat with this canvas. The board's `CanvasMenu` owns which canvas is
// shown; the chats working on it belong here, beside the transcript they write.

import { useCallback, useRef, useState } from 'react';
import { ChevronDown } from '@droidex/icons';
import { Popover } from '../../components/environment/Popover';
import { shallowEqual, useStoreSelector, type AppState } from '../../hooks/useStore';
import { chatDisplayTitle } from '../../lib/chatMetadata';
import { MENU_WIDTH_PX, MenuHeading, MenuNote, MenuRow } from './menuRows';
import { useCanvases } from './useCanvases';
import { useOpenCanvas } from './useOpenCanvas';

export function AttachedChatsMenu({
  appSessionId,
  canvasId,
  title,
  live,
}: {
  appSessionId: string;
  canvasId: string;
  /** The chat on screen: the header's own label, which this menu keeps. */
  title: string;
  /** Working chats shimmer their title, in the menu's trigger as anywhere else. */
  live: boolean;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => {
    setOpen(false);
  }, []);
  const { showCanvasInChat, startCanvasChat } = useOpenCanvas();
  // Read only while the menu is open: the list is a request, not header state.
  const { canvases } = useCanvases(open);
  const canvas =
    canvases.status === 'listed'
      ? (canvases.summaries.find((summary) => summary.canvasId === canvasId) ?? null)
      : null;
  const attached = canvas?.attachedAppSessionIds ?? [];
  const titles = useStoreSelector((current) => chatTitles(current, attached), shallowEqual);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${title}. Open the chats on this canvas`}
        onClick={() => {
          setOpen((value) => !value);
        }}
        className="flex min-w-0 cursor-pointer items-center gap-1 rounded-md text-left"
      >
        <span
          className={`min-w-0 truncate text-[13px] font-medium ${live ? 'shimmer-text' : 'text-droid-text'}`}
        >
          {title}
        </span>
        <ChevronDown aria-hidden className="h-3 w-3 shrink-0 text-droid-text-muted" />
      </button>

      <Popover
        open={open}
        onClose={close}
        anchorRef={triggerRef}
        align="left"
        width={MENU_WIDTH_PX}
        label="Chats on this canvas"
      >
        <div role="menu" aria-label="Chats on this canvas" className="min-h-0 overflow-y-auto p-1">
          <MenuHeading>{canvas?.name ?? 'This canvas'}</MenuHeading>
          {canvases.status === 'loading' && <MenuNote role="status">Reading its chats…</MenuNote>}
          {canvases.status === 'failed' && <MenuNote role="alert">{canvases.message}</MenuNote>}
          {canvases.status === 'listed' && attached.length === 0 && (
            <MenuNote>Only this chat, so far.</MenuNote>
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
                  // The board on screen travels with the switch, so the other
                  // chat opens on this canvas rather than on whatever its pane
                  // last showed.
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
        </div>
      </Popover>
    </>
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
