// The selected frame's toolbar (spec §4): switch its version, run it, read its
// source, add it to the chat, rename it, make variants of it, and the rest
// behind More. It floats at screen size over the frame's label, or under the
// frame where that has no room (toolbarPlacement.ts), so it follows the frame
// through pan and zoom. It is one tab stop: the arrows move inside it and
// Escape hands the keyboard back to the label. Its tools are icons; each says
// what it does on hover and on keyboard focus.

import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { Check, Ellipsis, MessageThread, Pencil, Play } from '@droidex/icons';
import { Popover } from '../../components/ui/Popover';
import { Tooltip } from '../../components/ui/Tooltip';
import type { Point } from './canvasGeometry';
import { revealStyle, type CanvasMotion } from './canvasMotion';
import { revisionNumber, useFrameHistory, type HistoryClient } from './frameHistory';
import { MENU_WIDTH_PX, MenuRow } from './menuRows';
import type { CanvasFrame } from './protocol';
import { RevisionHistory } from './RevisionHistory';
import { placeToolbar, type ToolbarRoom } from './toolbarPlacement';
import type { VariantChoice } from './variantRequests';
import { VariantsTool } from './VariantsTool';

/** What the toolbar does to the canvas, bound to the chat showing it. */
export interface FrameActions {
  history: HistoryClient;
  /** False on a canvas this chat only views: the sidecar refuses its writes. */
  canEdit: boolean;
  rename: (frame: CanvasFrame, name: string) => Promise<unknown>;
  /** Settles once the request has gone or failed, which it reports itself. */
  makeVariants: (frame: CanvasFrame, choice: VariantChoice) => Promise<void>;
  saveToLibrary: (frame: CanvasFrame) => void;
}

export interface FrameToolbarProps {
  frame: CanvasFrame;
  /** This is the frame Interact is driving, so the toolbar is only the way back. */
  interacted: boolean;
  /** Where the bar has room on the board. */
  room: ToolbarRoom;
  /** Spec §11's timings; the bar reveals on the popover token. */
  motion: CanvasMotion;
  inChat: boolean;
  actions: FrameActions;
  onInteract: (frame: CanvasFrame) => void;
  onExitInteract: () => void;
  onOpenSource?: (designId: string) => void;
  onToggleChat?: (frame: CanvasFrame) => void;
  /** Turns the frame's label into its name field. */
  onRename: () => void;
  onDelete: () => void;
  /** Hands the keyboard back to the frame's label. */
  onLeave: () => void;
}

export type ToolId =
  | 'history'
  | 'interact'
  | 'source'
  | 'chat'
  | 'rename'
  | 'variants'
  | 'variant-options'
  | 'more';

/** What makes a button one of the bar's tools: its place in the arrow order and the tab stop. */
export interface ToolButtonProps {
  'data-tool': ToolId;
  tabIndex: number;
  className: string;
  onFocus: () => void;
}

export function FrameToolbar(props: FrameToolbarProps) {
  if (!props.interacted) return <SelectToolbar {...props} />;
  return (
    <ToolbarShell room={props.room} motion={props.motion} label={`${props.frame.name} actions`}>
      <Tooltip label="Return to Select (Escape)">
        <button
          type="button"
          aria-label="Return to Select"
          className="canvas-frame-tool canvas-frame-tool-text"
          onClick={props.onExitInteract}
        >
          Done
        </button>
      </Tooltip>
    </ToolbarShell>
  );
}

function SelectToolbar({
  frame,
  room,
  motion,
  inChat,
  actions,
  onInteract,
  onOpenSource,
  onToggleChat,
  onRename,
  onDelete,
  onLeave,
}: FrameToolbarProps) {
  const [open, setOpen] = useState<'history' | 'more' | null>(null);
  const [focusedTool, setFocusedTool] = useState<ToolId | null>(null);
  const historyAnchor = useRef<HTMLButtonElement>(null);
  const moreAnchor = useRef<HTMLButtonElement>(null);
  const { history, list } = useFrameHistory(actions.history, frame);
  const close = useCallback(() => {
    setOpen(null);
  }, []);

  const tools = toolsShown({ frame, actions, onOpenSource, onToggleChat });
  const tabStop = focusedTool !== null && tools.includes(focusedTool) ? focusedTool : tools[0];
  const tool = (id: ToolId): ToolButtonProps => ({
    'data-tool': id,
    tabIndex: id === tabStop ? 0 : -1,
    className: 'canvas-frame-tool',
    onFocus: () => {
      setFocusedTool(id);
    },
  });

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // The popovers portal out of the bar, but React still bubbles their keys through it.
    if (!event.currentTarget.contains(event.target as Node)) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onLeave();
      return;
    }
    const next = nextTool(tools, tabStop, event.key);
    if (next === null) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.querySelector<HTMLElement>(`[data-tool="${next}"]`)?.focus();
  };

  const version = revisionNumber(list, frame.revisionId);
  return (
    <ToolbarShell room={room} motion={motion} label={`${frame.name} actions`} onKeyDown={onKeyDown}>
      {frame.revisionId && (
        <>
          <Tooltip label="Versions">
            <button
              ref={historyAnchor}
              type="button"
              {...tool('history')}
              className="canvas-frame-tool canvas-frame-version"
              aria-haspopup="menu"
              aria-expanded={open === 'history'}
              aria-label={`Versions of ${frame.name}${version === null ? '' : `, version ${String(version)} on show`}`}
              onClick={() => {
                setOpen(open === 'history' ? null : 'history');
              }}
            >
              {version === null ? '–' : `v${String(version)}`}
            </button>
          </Tooltip>
          <ToolDivider />
        </>
      )}
      <Tooltip label="Interact (double-click)">
        <button
          type="button"
          {...tool('interact')}
          aria-label={`Interact with ${frame.name}`}
          onClick={() => {
            onInteract(frame);
          }}
        >
          <Play className="h-4 w-4" aria-hidden />
        </button>
      </Tooltip>
      {onOpenSource && (
        <Tooltip label="Source">
          <button
            type="button"
            {...tool('source')}
            aria-label={`Source of ${frame.name}`}
            onClick={() => {
              onOpenSource(frame.designId);
            }}
          >
            <CodeGlyph />
          </button>
        </Tooltip>
      )}
      {onToggleChat && (
        <Tooltip label={inChat ? 'In chat. Take it out' : 'Add to chat'}>
          <button
            type="button"
            {...tool('chat')}
            aria-pressed={inChat}
            aria-label={
              inChat ? `Take ${frame.name} out of the chat` : `Add ${frame.name} to the chat`
            }
            onClick={() => {
              onToggleChat(frame);
            }}
          >
            {inChat ? (
              <Check className="h-4 w-4" aria-hidden />
            ) : (
              <MessageThread className="h-4 w-4" aria-hidden />
            )}
          </button>
        </Tooltip>
      )}
      {actions.canEdit && (
        <Tooltip label="Rename">
          <button
            type="button"
            {...tool('rename')}
            aria-label={`Rename ${frame.name}`}
            onClick={onRename}
          >
            <Pencil className="h-4 w-4" aria-hidden />
          </button>
        </Tooltip>
      )}
      {actions.canEdit && frame.revisionId && (
        <>
          <ToolDivider />
          <VariantsTool frame={frame} tool={tool} onMake={actions.makeVariants} />
        </>
      )}
      <ToolDivider />
      <Tooltip label="More">
        <button
          ref={moreAnchor}
          type="button"
          {...tool('more')}
          aria-haspopup="menu"
          aria-expanded={open === 'more'}
          aria-label={`More for ${frame.name}`}
          onClick={() => {
            setOpen(open === 'more' ? null : 'more');
          }}
        >
          <Ellipsis className="h-4 w-4" aria-hidden />
        </button>
      </Tooltip>

      <RevisionHistory
        open={open === 'history'}
        onClose={close}
        anchorRef={historyAnchor}
        frameName={frame.name}
        history={history}
        list={list}
        headRevisionId={frame.revisionId}
        canSwitch={actions.canEdit}
      />
      <Popover
        open={open === 'more'}
        onClose={close}
        anchorRef={moreAnchor}
        placement="bottom-start"
        width={MENU_WIDTH_PX}
        label={`More for ${frame.name}`}
      >
        <div
          role="menu"
          aria-label={`More for ${frame.name}`}
          className="min-h-0 overflow-y-auto p-1"
        >
          <MenuRow
            label="Save to library…"
            disabled={!frame.revisionId}
            onRun={() => {
              close();
              actions.saveToLibrary(frame);
            }}
          />
          <MenuRow
            label="Delete frame"
            hint="⌫"
            onRun={() => {
              close();
              onDelete();
            }}
          />
        </div>
      </Popover>
    </ToolbarShell>
  );
}

/** The bar where `placeToolbar` finds it room, once it knows its own size. */
function ToolbarShell({
  room,
  motion,
  label,
  onKeyDown,
  children,
}: {
  room: ToolbarRoom;
  motion: CanvasMotion;
  label: string;
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
  children: ReactNode;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Point>({ x: 0, y: 0 });
  useLayoutEffect(() => {
    const element = bar.current;
    if (!element) return undefined;
    const measure = () => {
      setSize({ x: element.offsetWidth, y: element.offsetHeight });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);
  const { side, align } = placeToolbar(room, size);
  return (
    <div
      data-side={side}
      data-align={align}
      className="canvas-frame-tools canvas-chrome"
      onPointerDown={(event) => {
        event.stopPropagation();
      }}
    >
      <div
        ref={bar}
        role="toolbar"
        aria-label={label}
        style={revealStyle(motion)}
        className={`canvas-frame-toolbar ${motion.popoverMs > 0 ? 'canvas-popover-reveal' : ''}`}
        onKeyDown={onKeyDown}
      >
        {children}
      </div>
    </div>
  );
}

/** The bar's tools in order, which is the order the arrows walk. */
function toolsShown({
  frame,
  actions,
  onOpenSource,
  onToggleChat,
}: Pick<FrameToolbarProps, 'frame' | 'actions' | 'onOpenSource' | 'onToggleChat'>): ToolId[] {
  const tools: ToolId[] = [];
  if (frame.revisionId) tools.push('history');
  tools.push('interact');
  if (onOpenSource) tools.push('source');
  if (onToggleChat) tools.push('chat');
  if (actions.canEdit) tools.push('rename');
  if (actions.canEdit && frame.revisionId) tools.push('variants', 'variant-options');
  tools.push('more');
  return tools;
}
function nextTool(tools: readonly ToolId[], current: ToolId, key: string): ToolId | null {
  const at = tools.indexOf(current);
  switch (key) {
    case 'ArrowRight':
      return tools[(at + 1) % tools.length];
    case 'ArrowLeft':
      return tools[(at - 1 + tools.length) % tools.length];
    case 'Home':
      return tools[0];
    case 'End':
      return tools[tools.length - 1];
    default:
      return null;
  }
}

function CodeGlyph() {
  return (
    <svg viewBox="0 0 24 24" width={16} height={16} fill="none" aria-hidden>
      <path
        d="M9 7 4 12l5 5M15 7l5 5-5 5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ToolDivider() {
  return <span aria-hidden className="canvas-frame-divider" />;
}
