// The Design chat column's top row (spec §4). The canvas on the board names
// it; its menu lists the chats on that canvas, tags the board's selected frames,
// sets its design-system rule, and lists the other canvases and what can be
// done to the canvas itself. The + at the row's end starts the next chat.

import { useRef, useState, type MouseEvent } from 'react';
import {
  Check,
  ChevronDown,
  LayoutTemplate,
  MessageBubble,
  MessageCirclePlus,
  MessageThread,
  Plus,
  Sketch,
  Trash,
} from '@droidex/icons';
import { Button } from '../../components/ui/Button';
import { Menu } from '../../components/ui/Menu';
import { Tooltip } from '../../components/ui/Tooltip';
import { shallowEqual, useStoreDispatch, useStoreSelector } from '../../hooks/useStore';
import { chatDisplayTitle } from '../../lib/chatMetadata';
import { opensInNewTab } from '../../lib/shortcuts';
import { toast } from '../../lib/toast';
import { TAG_KEY_LABEL } from './boardKeys';
import { useBoardOnScreen } from './boardOnScreen';
import { searchCanvases } from './canvasChats';
import { canvasClient } from './canvasClient';
import { canvasMessage } from './client';
import { DeleteCanvasDialog } from './DeleteCanvasDialog';
import { DESIGN_SYSTEM_RULES } from './designSystemRule';
import { tagFramesLabel, toggleFramePins, useFramePins } from './framePins';
import { useLeaveDeletedCanvas } from './leaveDeletedCanvas';
import type { CanvasSummary } from './protocol';
import { useCanvases, type Canvases } from './useCanvases';
import { useOpenCanvas } from './useOpenCanvas';

const MENU_WIDTH_PX = 260;
// Enough to switch between the canvases in play; the Design home lists them all.
const RECENT_CANVAS_COUNT = 5;

export function DesignColumnHeader({
  appSessionId,
  canvasId,
  leadPx,
}: {
  appSessionId: string;
  canvasId: string;
  /** Room left at the row's start for the window controls. */
  leadPx: number;
}) {
  return (
    <div
      data-electron-drag-region
      className="flex h-9 shrink-0 items-center gap-1 pr-2"
      style={{ paddingLeft: leadPx }}
    >
      <CanvasNameMenu appSessionId={appSessionId} canvasId={canvasId} />
      <div className="min-w-0 flex-1" />
      <NewMenu canvasId={canvasId} />
    </div>
  );
}

function CanvasNameMenu({ appSessionId, canvasId }: { appSessionId: string; canvasId: string }) {
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { canvases } = useCanvases();
  const canvas =
    canvases.status === 'listed'
      ? (canvases.summaries.find((summary) => summary.canvasId === canvasId) ?? null)
      : null;
  const leaveDeletedCanvas = useLeaveDeletedCanvas();
  const close = () => {
    setOpen(false);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${canvas?.name ?? 'Canvas'}. Open the canvas menu`}
        onClick={() => {
          setOpen((value) => !value);
        }}
        className="flex min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-left transition-colors hover:bg-elevated/60 aria-expanded:bg-elevated/60"
      >
        <Sketch aria-hidden className="size-icon-sm shrink-0 text-muted" />
        <span className="min-w-0 truncate text-body-strong text-primary">
          {canvas?.name ?? 'Canvas'}
        </span>
        <ChevronDown aria-hidden className="size-3 shrink-0 text-muted" />
      </button>

      <Menu
        open={open}
        onClose={close}
        anchorRef={triggerRef}
        placement="bottom-start"
        width={MENU_WIDTH_PX}
        label={canvas?.name ?? 'Canvas'}
        className="max-h-96"
      >
        <ChatsOnCanvas
          appSessionId={appSessionId}
          canvasId={canvasId}
          attached={canvas?.attachedAppSessionIds ?? []}
        />
        <TagFramesItem canvasId={canvasId} />
        <Menu.Divider />
        {canvas && (
          <>
            <DesignSystemRuleItems appSessionId={appSessionId} canvas={canvas} />
            <Menu.Divider />
          </>
        )}
        <OtherCanvases canvases={canvases} canvasId={canvasId} />
        <Menu.Divider />
        <Menu.Item
          icon={Trash}
          danger
          onSelect={() => {
            setDeleting(true);
          }}
        >
          Delete canvas…
        </Menu.Item>
      </Menu>

      {deleting && (
        <DeleteCanvasDialog
          canvasId={canvasId}
          onClose={() => {
            setDeleting(false);
          }}
          onDeleted={(removed) => {
            setDeleting(false);
            leaveDeletedCanvas(appSessionId, removed);
          }}
        />
      )}
    </>
  );
}

/**
 * The chats working on this canvas, this one checked. A chat the session list
 * does not hold is another window's, so it stays listed but out of reach.
 * A primary-modifier click opens the chat in a tab of its own.
 */
function ChatsOnCanvas({
  appSessionId,
  canvasId,
  attached,
}: {
  appSessionId: string;
  canvasId: string;
  attached: string[];
}) {
  const dispatch = useStoreDispatch();
  const { showCanvasInChat } = useOpenCanvas();
  const inNewTab = useRef(false);
  const chatIds = attached.includes(appSessionId) ? attached : [appSessionId, ...attached];
  const titles = useStoreSelector((current) => {
    const named: Record<string, string> = {};
    for (const id of chatIds) {
      if (id in current.sessions)
        named[id] = chatDisplayTitle(current.sessions[id], current.chatMetadata[id]);
    }
    return named;
  }, shallowEqual);

  return (
    <>
      <Menu.Label>Chats on this canvas</Menu.Label>
      {chatIds.map((id) => {
        const reachable = id in titles;
        return (
          <Menu.Item
            key={id}
            icon={MessageBubble}
            role="menuitemradio"
            aria-checked={id === appSessionId}
            disabled={!reachable}
            title={reachable ? 'Click to switch, ⌘-click to open in a new tab' : undefined}
            onClick={(event: MouseEvent) => {
              inNewTab.current = opensInNewTab(event);
            }}
            onSelect={() => {
              if (inNewTab.current) {
                dispatch({ type: 'OPEN_TAB', page: { kind: 'chat', appSessionId: id } });
                showCanvasInChat(id, canvasId);
              } else if (id !== appSessionId) {
                showCanvasInChat(id, canvasId);
              }
            }}
          >
            <span className="min-w-0 flex-1 truncate">
              {reachable ? titles[id] : 'Another window'}
            </span>
            {id === appSessionId && (
              <Check aria-hidden className="size-icon-sm shrink-0 text-secondary" />
            )}
          </Menu.Item>
        );
      })}
    </>
  );
}

/**
 * Tags or untags the board's selected frames as the board's own menu does;
 * with nothing selected, says how many are tagged.
 */
function TagFramesItem({ canvasId }: { canvasId: string }) {
  const board = useBoardOnScreen(canvasId);
  const attached = board?.attached ? board : null;
  const pins = useFramePins(attached?.appSessionId ?? null);
  if (!attached) return null;
  const tagged = pins.filter((pin) => pin.canvasId === canvasId).length;
  if (attached.selected.length === 0 && tagged === 0) return null;
  return (
    <>
      <Menu.Divider />
      {attached.selected.length === 0 ? (
        <p className="px-2 py-1.5 text-caption text-muted">
          {tagged === 1 ? '1 frame tagged in chat' : `${String(tagged)} frames tagged in chat`}
        </p>
      ) : (
        <Menu.Item
          icon={MessageThread}
          onSelect={() => {
            toggleFramePins(attached.appSessionId, canvasId, attached.selected);
          }}
        >
          <span className="min-w-0 flex-1 truncate">
            {tagFramesLabel(pins, canvasId, attached.selected)}
          </span>
          <Menu.Shortcut>{TAG_KEY_LABEL}</Menu.Shortcut>
        </Menu.Item>
      )}
    </>
  );
}

/** The board menu's design-system rule, without its notes. */
function DesignSystemRuleItems({
  appSessionId,
  canvas,
}: {
  appSessionId: string;
  canvas: CanvasSummary;
}) {
  const canChange = canvas.attachedAppSessionIds.includes(appSessionId);
  return (
    <>
      <Menu.Label>Design system</Menu.Label>
      {DESIGN_SYSTEM_RULES.map(({ rule, label }) => {
        const checked = rule === canvas.designSystemAdherence;
        return (
          <Menu.Item
            key={rule}
            role="menuitemradio"
            aria-checked={checked}
            disabled={!canChange}
            title={canChange ? undefined : 'Open a chat on this canvas to change this'}
            onSelect={() => {
              if (checked) return;
              canvasClient
                .setDesignSystemAdherence(appSessionId, canvas.canvasId, rule)
                .catch((error: unknown) => {
                  toast.error(canvasMessage(error));
                });
            }}
          >
            {/* The icon column the chat rows above hold, so every label starts on one edge. */}
            <span aria-hidden className="size-icon-md shrink-0" />
            <span className="min-w-0 flex-1 truncate">{label}</span>
            {checked && <Check aria-hidden className="size-icon-sm shrink-0 text-secondary" />}
          </Menu.Item>
        );
      })}
    </>
  );
}

function OtherCanvases({ canvases, canvasId }: { canvases: Canvases; canvasId: string }) {
  const { openCanvas, startCanvasChat } = useOpenCanvas();
  const others =
    canvases.status === 'listed'
      ? searchCanvases(canvases.summaries, '')
          .filter((summary) => summary.canvasId !== canvasId)
          .slice(0, RECENT_CANVAS_COUNT)
      : [];
  return (
    <>
      <Menu.Label>Canvases</Menu.Label>
      {canvases.status === 'loading' && (
        <p role="status" className="px-2 py-1.5 text-caption text-muted">
          Reading canvases…
        </p>
      )}
      {canvases.status === 'failed' && (
        <p role="alert" className="px-2 py-1.5 text-caption text-danger">
          {canvases.message}
        </p>
      )}
      {others.map((summary) => (
        <Menu.Item
          key={summary.canvasId}
          icon={Sketch}
          onSelect={() => {
            openCanvas(summary);
          }}
        >
          <span className="min-w-0 flex-1 truncate">{summary.name}</span>
        </Menu.Item>
      ))}
      <Menu.Item
        icon={LayoutTemplate}
        onSelect={() => {
          startCanvasChat(null);
        }}
      >
        All canvases
      </Menu.Item>
    </>
  );
}

function NewMenu({ canvasId }: { canvasId: string }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { startCanvasChat } = useOpenCanvas();
  return (
    <>
      <Tooltip label="New chat or canvas" placement="bottom">
        <Button
          ref={triggerRef}
          variant="ghost"
          size="sm"
          icon={Plus}
          aria-label="New chat or canvas"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => {
            setOpen((value) => !value);
          }}
        />
      </Tooltip>
      <Menu
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        anchorRef={triggerRef}
        placement="bottom-end"
        width={220}
        label="New"
      >
        <Menu.Item
          icon={MessageCirclePlus}
          onSelect={() => {
            startCanvasChat(canvasId);
          }}
        >
          New chat on this canvas
        </Menu.Item>
        <Menu.Item
          icon={Sketch}
          onSelect={() => {
            startCanvasChat(null);
          }}
        >
          New canvas
        </Menu.Item>
      </Menu>
    </>
  );
}
