import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { ChevronDown, PanelRight, X } from '@droidex/icons';
import { useStoreDispatch } from '../../hooks/useStore';
import { SIDE_CHAT_DRAG_HANDLE, SideChatHeaderButton } from './SideChatHeader';
import { SideChatPane } from './SideChatPane';

const GEOMETRY_STORAGE_KEY = 'droid-side-chat-window';
const EDGE_PX = 8;
const MIN_WIDTH_PX = 300;
const MIN_HEIGHT_PX = 320;

// Anchored to the chat's bottom right, above the composer, so it stays near it
// as the window resizes.
interface WindowGeometry {
  right: number;
  bottom: number;
  width: number;
  height: number;
}

const DEFAULT_GEOMETRY: WindowGeometry = { right: 16, bottom: 150, width: 380, height: 480 };

interface Area {
  width: number;
  height: number;
}

interface Gesture {
  kind: 'move' | 'resize';
  x: number;
  y: number;
  start: WindowGeometry;
  latest: WindowGeometry;
}

/* Side chats floating over the chat: dragged by the header, resized from the
   top-left corner, minimized to the window toolbar, or docked back into the
   utility pane. */

export function SideChatWindow({ sourceAppSessionId }: { sourceAppSessionId: string }) {
  const dispatch = useStoreDispatch();
  const [geometry, setGeometry] = useState(storedGeometry);
  const gesture = useRef<Gesture | null>(null);
  const windowRef = useRef<HTMLDivElement>(null);
  const [area, setArea] = useState<Area | null>(null);

  // The chat column narrows when the utility pane opens; follow it so the
  // window never hangs off its edge.
  useEffect(() => {
    const parent = windowRef.current?.offsetParent;
    if (!(parent instanceof HTMLElement)) return;
    const measure = () => {
      setArea({ width: parent.clientWidth, height: parent.clientHeight });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(parent);
    return () => {
      observer.disconnect();
    };
  }, []);

  const place = (placement: 'docked' | 'minimized') => {
    dispatch({ type: 'PLACE_SIDE_CHATS', sourceAppSessionId, placement });
  };

  const shown = area ? fitGeometry(geometry, area) : geometry;

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = gesture.current;
    if (!current) return;
    const dx = event.clientX - current.x;
    const dy = event.clientY - current.y;
    const { width, height } = area ?? { width: window.innerWidth, height: window.innerHeight };
    const { start } = current;
    current.latest =
      current.kind === 'move'
        ? {
            ...start,
            right: clamp(start.right - dx, EDGE_PX, width - start.width - EDGE_PX),
            bottom: clamp(start.bottom - dy, EDGE_PX, height - start.height - EDGE_PX),
          }
        : {
            ...start,
            width: clamp(start.width - dx, MIN_WIDTH_PX, width - start.right - EDGE_PX),
            height: clamp(start.height - dy, MIN_HEIGHT_PX, height - start.bottom - EDGE_PX),
          };
    setGeometry(current.latest);
  };

  // Pointer capture ends with the pointer; only the place is left to keep.
  const endGesture = () => {
    if (!gesture.current) return;
    storeGeometry(gesture.current.latest);
    gesture.current = null;
  };

  const beginGesture = (event: ReactPointerEvent<HTMLElement>, kind: Gesture['kind']) => {
    if (event.button !== 0) return;
    gesture.current = {
      kind,
      x: event.clientX,
      y: event.clientY,
      start: shown,
      latest: shown,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  return (
    <div
      ref={windowRef}
      role="dialog"
      aria-label="Side chats"
      data-testid="side-chat-window"
      style={
        {
          right: shown.right,
          bottom: shown.bottom,
          width: shown.width,
          height: shown.height,
          // Raised and elevated share a tone in dark themes; step prompts up one.
          '--prompt-bubble-bg': 'var(--droid-active)',
        } as CSSProperties
      }
      className="absolute z-30 flex flex-col overflow-hidden rounded-2xl bg-droid-raised shadow-droid"
      onPointerDown={(event) => {
        const target = event.target;
        if (!(target instanceof Element) || !target.closest(`[${SIDE_CHAT_DRAG_HANDLE}]`)) return;
        if (target.closest('button, input, textarea, a')) return;
        beginGesture(event, 'move');
      }}
      onPointerMove={onPointerMove}
      onPointerUp={endGesture}
      onPointerCancel={endGesture}
    >
      <div
        aria-hidden="true"
        onPointerDown={(event) => {
          event.stopPropagation();
          beginGesture(event, 'resize');
        }}
        className="absolute left-0 top-0 z-10 h-4 w-4 cursor-nwse-resize"
      />
      <SideChatPane
        sourceAppSessionId={sourceAppSessionId}
        wide={false}
        controls={
          <>
            <SideChatHeaderButton
              label="Minimize"
              onClick={() => {
                place('minimized');
              }}
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </SideChatHeaderButton>
            <SideChatHeaderButton
              label="Dock to side"
              onClick={() => {
                place('docked');
              }}
            >
              <PanelRight className="h-3.5 w-3.5" />
            </SideChatHeaderButton>
            <SideChatHeaderButton
              label="Close"
              onClick={() => {
                dispatch({ type: 'HIDE_SIDE_CHATS', sourceAppSessionId });
              }}
            >
              <X className="h-3.5 w-3.5" />
            </SideChatHeaderButton>
          </>
        }
      />
    </div>
  );
}

function fitGeometry(geometry: WindowGeometry, area: Area): WindowGeometry {
  const width = Math.min(geometry.width, area.width - 2 * EDGE_PX);
  const height = Math.min(geometry.height, area.height - 2 * EDGE_PX);
  return {
    width,
    height,
    right: clamp(geometry.right, EDGE_PX, area.width - width - EDGE_PX),
    bottom: clamp(geometry.bottom, EDGE_PX, area.height - height - EDGE_PX),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.round(Math.min(Math.max(max, min), Math.max(min, value)));
}

function storedGeometry(): WindowGeometry {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(GEOMETRY_STORAGE_KEY) ?? 'null');
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('right' in parsed) ||
      !('bottom' in parsed) ||
      !('width' in parsed) ||
      !('height' in parsed)
    ) {
      return DEFAULT_GEOMETRY;
    }
    return {
      right: storedLength(parsed.right, EDGE_PX, DEFAULT_GEOMETRY.right),
      bottom: storedLength(parsed.bottom, EDGE_PX, DEFAULT_GEOMETRY.bottom),
      width: storedLength(parsed.width, MIN_WIDTH_PX, DEFAULT_GEOMETRY.width),
      height: storedLength(parsed.height, MIN_HEIGHT_PX, DEFAULT_GEOMETRY.height),
    };
  } catch {
    return DEFAULT_GEOMETRY;
  }
}

function storedLength(value: unknown, min: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(min, value) : fallback;
}

function storeGeometry(geometry: WindowGeometry): void {
  try {
    localStorage.setItem(GEOMETRY_STORAGE_KEY, JSON.stringify(geometry));
  } catch {
    // Storage full or blocked: the window keeps its place until the app closes.
  }
}
