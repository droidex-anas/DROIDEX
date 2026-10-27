// The selected frame's toolbar (spec §4): rename it, read and restore its
// revisions, run it, read its source, add it to the chat, and the rest behind
// More. It floats above the frame's label at screen size, so it follows the
// frame through pan and zoom. It is one tab stop: the arrows move inside it and
// Escape hands the keyboard back to the label.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { Check, Ellipsis, History, MessageThread, Pencil, Play } from '@droidex/icons';
import { Popover } from '../../components/environment/Popover';
import { FrameHistory, revisionNumber, type HistoryClient } from './frameHistory';
import { MENU_WIDTH_PX, MenuRow } from './menuRows';
import type { CanvasFrame } from './protocol';
import { RevisionHistory } from './RevisionHistory';

/** What the toolbar does to the canvas, bound to the chat showing it. */
export interface FrameActions {
  history: HistoryClient;
  /** False on a canvas this chat only views: the sidecar refuses its writes. */
  canEdit: boolean;
  rename: (frame: CanvasFrame, name: string) => Promise<unknown>;
  makeVariants: (frame: CanvasFrame) => void;
  saveToLibrary: (frame: CanvasFrame) => void;
}

export interface FrameToolbarProps {
  frame: CanvasFrame;
  /** This is the frame Interact is driving, so the toolbar is only the way back. */
  interacted: boolean;
  /** Screen pixels from the frame's left edge to the board's right edge. */
  roomRight: number;
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

type ToolId = 'rename' | 'history' | 'interact' | 'source' | 'chat' | 'more';

export function FrameToolbar(props: FrameToolbarProps) {
  if (!props.interacted) return <SelectToolbar {...props} />;
  return (
    <ToolbarShell roomRight={props.roomRight} label={`${props.frame.name} actions`}>
      <button
        type="button"
        aria-label="Return to Select"
        title="Return to Select (Escape)"
        className="canvas-frame-tool"
        onClick={props.onExitInteract}
      >
        Done
      </button>
    </ToolbarShell>
  );
}

function SelectToolbar({
  frame,
  roomRight,
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
  const [focusedTool, setFocusedTool] = useState<ToolId>('rename');
  const historyAnchor = useRef<HTMLButtonElement>(null);
  const moreAnchor = useRef<HTMLButtonElement>(null);
  const { history, state } = useFrameHistory(actions.history, frame);
  const closeMore = useCallback(() => {
    setOpen(null);
  }, []);
  const closeHistory = useCallback(() => {
    history.cancel();
    setOpen(null);
  }, [history]);

  const tools = toolsShown({ frame, actions, onOpenSource, onToggleChat });
  const tabStop = tools.includes(focusedTool) ? focusedTool : tools[0];
  const tool = (id: ToolId) => ({
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

  const version = revisionNumber(state.list, frame.revisionId);
  return (
    <ToolbarShell roomRight={roomRight} label={`${frame.name} actions`} onKeyDown={onKeyDown}>
      {actions.canEdit && (
        <button
          type="button"
          {...tool('rename')}
          aria-label={`Rename ${frame.name}`}
          title="Rename"
          onClick={onRename}
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden />
        </button>
      )}
      {frame.revisionId && (
        <button
          ref={historyAnchor}
          type="button"
          {...tool('history')}
          aria-haspopup="dialog"
          aria-expanded={open === 'history'}
          aria-label={`History of ${frame.name}${version === null ? '' : `, version ${String(version)}`}`}
          title="History"
          onClick={() => {
            setOpen(open === 'history' ? null : 'history');
          }}
        >
          <History className="h-3.5 w-3.5" aria-hidden />
          {version !== null && <span className="canvas-frame-version">v{version}</span>}
        </button>
      )}
      <button
        type="button"
        {...tool('interact')}
        aria-label={`Interact with ${frame.name}`}
        title="Interact (double-click)"
        onClick={() => {
          onInteract(frame);
        }}
      >
        <Play className="h-3.5 w-3.5" aria-hidden />
        Interact
      </button>
      {onOpenSource && (
        <button
          type="button"
          {...tool('source')}
          aria-label={`Source of ${frame.name}`}
          onClick={() => {
            onOpenSource(frame.designId);
          }}
        >
          <CodeGlyph />
          Source
        </button>
      )}
      {onToggleChat && (
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
            <Check className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <MessageThread className="h-3.5 w-3.5" aria-hidden />
          )}
          {inChat ? 'In chat' : 'Add to chat'}
        </button>
      )}
      <button
        ref={moreAnchor}
        type="button"
        {...tool('more')}
        aria-haspopup="menu"
        aria-expanded={open === 'more'}
        aria-label={`More for ${frame.name}`}
        title="More"
        onClick={() => {
          setOpen(open === 'more' ? null : 'more');
        }}
      >
        <Ellipsis className="h-3.5 w-3.5" aria-hidden />
      </button>

      <Popover
        open={open === 'history'}
        onClose={closeHistory}
        anchorRef={historyAnchor}
        align="left"
        width={MENU_WIDTH_PX}
        label={`History of ${frame.name}`}
      >
        <RevisionHistory
          history={history}
          state={state}
          headRevisionId={frame.revisionId}
          canRestore={actions.canEdit}
        />
      </Popover>
      <Popover
        open={open === 'more'}
        onClose={closeMore}
        anchorRef={moreAnchor}
        align="left"
        width={MENU_WIDTH_PX}
        label={`More for ${frame.name}`}
      >
        <div
          role="menu"
          aria-label={`More for ${frame.name}`}
          className="min-h-0 overflow-y-auto p-1"
        >
          <MenuRow
            label="Make variants…"
            disabled={!actions.canEdit || !frame.revisionId}
            onRun={() => {
              closeMore();
              actions.makeVariants(frame);
            }}
          />
          <MenuRow
            label="Save to library…"
            disabled={!frame.revisionId}
            onRun={() => {
              closeMore();
              actions.saveToLibrary(frame);
            }}
          />
          <MenuRow
            label="Delete frame"
            hint="⌫"
            onRun={() => {
              closeMore();
              onDelete();
            }}
          />
        </div>
      </Popover>
    </ToolbarShell>
  );
}

/**
 * The bar above the label, starting where the frame does, or ending where it
 * does when the board would cut it off.
 */
function ToolbarShell({
  roomRight,
  label,
  onKeyDown,
  children,
}: {
  roomRight: number;
  label: string;
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
  children: ReactNode;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = bar.current;
    if (!element) return undefined;
    setWidth(element.offsetWidth);
    const observer = new ResizeObserver(() => {
      setWidth(element.offsetWidth);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);
  return (
    <div
      data-align={roomRight >= width ? undefined : 'end'}
      className="canvas-frame-tools canvas-chrome"
      onPointerDown={(event) => {
        event.stopPropagation();
      }}
    >
      <div
        ref={bar}
        role="toolbar"
        aria-label={label}
        className="canvas-frame-toolbar"
        onKeyDown={onKeyDown}
      >
        {children}
      </div>
    </div>
  );
}

/** The frame's history, read again whenever its head moves. */
function useFrameHistory(client: HistoryClient, frame: CanvasFrame) {
  const history = useMemo(() => new FrameHistory(client), [client]);
  const { designId, revisionId } = frame;
  useEffect(() => {
    if (revisionId) history.show({ designId, headRevisionId: revisionId });
  }, [history, designId, revisionId]);
  useEffect(
    () => () => {
      history.dispose();
    },
    [history],
  );
  const state = useSyncExternalStore(history.subscribe, history.read, history.read);
  return { history, state };
}

/** The bar's tools in order, which is the order the arrows walk. */
function toolsShown({
  frame,
  actions,
  onOpenSource,
  onToggleChat,
}: Pick<FrameToolbarProps, 'frame' | 'actions' | 'onOpenSource' | 'onToggleChat'>): ToolId[] {
  const tools: ToolId[] = [];
  if (actions.canEdit) tools.push('rename');
  if (frame.revisionId) tools.push('history');
  tools.push('interact');
  if (onOpenSource) tools.push('source');
  if (onToggleChat) tools.push('chat');
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
    <svg viewBox="0 0 24 24" width={14} height={14} fill="none" aria-hidden>
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
