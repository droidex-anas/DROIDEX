import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { motion, useMotionValue, useReducedMotion } from 'framer-motion';
import { ChevronDown, ChevronUp, MessageSquareText, Mic, MicOff, X } from 'lucide-react';
import { Popover } from '../../components/environment/Popover';
import { useStoreDispatch, useStoreSelector } from '../../hooks/useStore';
import { VoiceOrb } from './VoiceOrb';
import { voiceStatusLabel } from './voiceStatus';
import type { Voice } from './useVoice';

/**
 * The conversation while another chat is on screen.
 *
 * The talking has not stopped, so something has to stay in front of whatever
 * the app is showing: a small pill with the orb, the controls the composer
 * would have given it, a way back to the chat that owns the conversation, and
 * what was said just now. It is dragged wherever it suits the user and stays
 * there, inside the window, for as long as the app runs.
 */

// It hangs from the top-right corner, clear of the window controls opposite it
// and of the composer below; the offsets below move it from there.
const EDGE_MARGIN_PX = 16;
const OFFSET_STORAGE_KEY = 'droid-voice-mini-bar-offset';
// The tail worth reading over a chat. The rest of the conversation is in the
// chat's own transcript, which is what the first button goes back to.
const PANEL_LINES = 8;
const PANEL_WIDTH_PX = 288;

/** How far the bar has been dragged from that corner. */
interface Offset {
  x: number;
  y: number;
}

interface DragBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Pinned to the corner until the bar has been measured against the window. */
const PINNED: DragBounds = { left: 0, right: 0, top: 0, bottom: 0 };

const buttonClass =
  'cursor-pointer rounded-full p-1.5 text-droid-text-secondary transition-colors hover:bg-droid-bg/50 hover:text-droid-text';

export function VoiceMiniBar({ voice, appSessionId }: { voice: Voice; appSessionId: string }) {
  const dispatch = useStoreDispatch();
  const reducedMotion = useReducedMotion();
  const { session } = voice;
  const barRef = useRef<HTMLDivElement>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const waiting = useStoreSelector(
    (state) =>
      Boolean(state.pendingPermissions[appSessionId]) ||
      Boolean(state.pendingQuestions[appSessionId]),
  );
  const [panel, setPanel] = useState(false);
  const [bounds, setBounds] = useState<DragBounds>(PINNED);

  // Where the bar sits lives in motion values rather than in state, so neither
  // dragging it nor a render of the app underneath can move it.
  const placed = useRef(readOffset()).current;
  const x = useMotionValue(placed.x);
  const y = useMotionValue(placed.y);

  // A drag that ends on a button must not also press it, and a press that
  // follows must not be swallowed, so each pointer press starts clean.
  const dragged = useRef(false);

  // The bar's room to move is its distance from the far edges, so a resized
  // window pulls a bar that fell outside it back into view.
  useLayoutEffect(() => {
    const fitToWindow = () => {
      const bar = barRef.current;
      if (!bar) return;
      const { width, height } = bar.getBoundingClientRect();
      const next: DragBounds = {
        left: Math.min(0, -(window.innerWidth - width - EDGE_MARGIN_PX * 2)),
        right: 0,
        top: 0,
        bottom: Math.max(0, window.innerHeight - height - EDGE_MARGIN_PX * 2),
      };
      setBounds(next);
      x.set(clamp(x.get(), next.left, next.right));
      y.set(clamp(y.get(), next.top, next.bottom));
    };
    fitToWindow();
    window.addEventListener('resize', fitToWindow);
    return () => {
      window.removeEventListener('resize', fitToWindow);
    };
  }, [x, y]);

  // The newest line stays in view, in the panel as in the full surface.
  useEffect(() => {
    const feed = feedRef.current;
    if (feed) feed.scrollTop = feed.scrollHeight;
  }, [panel, session.lines]);

  const togglePanel = useCallback(() => {
    setPanel((open) => !open);
  }, []);
  const closePanel = useCallback(() => {
    setPanel(false);
  }, []);

  // An ask raised by the conversation lands in its own chat, which is not the
  // one on screen. The bar says so, and its first button is the way there.
  const status = waiting ? 'Needs you' : voiceStatusLabel(voice.activity);
  const lines = session.lines.slice(-PANEL_LINES);

  return (
    <motion.div
      ref={barRef}
      drag
      dragConstraints={bounds}
      dragElastic={0}
      dragMomentum={false}
      onPointerDownCapture={() => {
        dragged.current = false;
      }}
      onDragStart={() => {
        dragged.current = true;
        // What was said would follow the bar around; it opens again where the
        // bar lands.
        setPanel(false);
      }}
      onDragEnd={() => {
        writeOffset({ x: x.get(), y: y.get() });
      }}
      onClickCapture={(event) => {
        if (!dragged.current) return;
        dragged.current = false;
        event.preventDefault();
        event.stopPropagation();
      }}
      initial={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.92 }}
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      style={{ x, y, top: EDGE_MARGIN_PX, right: EDGE_MARGIN_PX }}
      className="fixed z-[1150] cursor-grab active:cursor-grabbing"
    >
      {/* The app's own panel: it anchors to the bar wherever it was dragged,
          clamps itself to the window, and closes on an outside click or
          Escape. */}
      <Popover
        open={panel}
        onClose={closePanel}
        anchorRef={barRef}
        label="What was said"
        width={PANEL_WIDTH_PX}
      >
        <div
          ref={feedRef}
          id={panelId}
          tabIndex={0}
          role="log"
          aria-label="What was said"
          className="max-h-[220px] overflow-y-auto p-3"
        >
          {lines.length === 0 ? (
            <p className="text-[12px] text-droid-text-muted">Nothing said yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {lines.map((line) => (
                <li key={line.id} className={line.role === 'user' ? 'flex justify-end' : ''}>
                  <span
                    className={
                      line.role === 'user'
                        ? 'max-w-[85%] rounded-xl rounded-br-sm bg-droid-elevated px-2.5 py-1.5 text-[12px] leading-[1.5] text-droid-text'
                        : 'block text-[12px] leading-[1.5] text-droid-text-secondary'
                    }
                  >
                    {line.text}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Popover>

      <div
        role="group"
        aria-label="Voice conversation"
        className="flex items-center gap-0.5 rounded-full border border-droid-border bg-droid-raised p-1.5 shadow-droid"
      >
        <button
          type="button"
          aria-label="Open the chat this conversation belongs to"
          title="Open the chat"
          onClick={() => {
            dispatch({ type: 'SET_ACTIVE_SESSION', id: appSessionId });
          }}
          className={buttonClass}
        >
          <MessageSquareText className="h-3.5 w-3.5" />
        </button>
        <Hairline />
        <div className="px-1" title={status}>
          <VoiceOrb micStream={session.micStream} replyStream={session.replyStream} size={26} />
        </div>
        <span className="sr-only" aria-live="polite">
          {status}
        </span>
        <Hairline />
        <button
          type="button"
          aria-label={session.muted ? 'Unmute microphone' : 'Mute microphone'}
          title={session.muted ? 'Unmute' : 'Mute'}
          aria-pressed={session.muted}
          onClick={session.toggleMuted}
          className={buttonClass}
        >
          {session.muted ? (
            <MicOff className="h-3.5 w-3.5 text-droid-red" />
          ) : (
            <Mic className="h-3.5 w-3.5" />
          )}
        </button>
        <button
          type="button"
          aria-label="End voice mode"
          title="End voice mode"
          onClick={voice.close}
          className="cursor-pointer rounded-full bg-droid-accent p-1.5 text-droid-bg transition-opacity hover:opacity-90"
        >
          <X className="h-3.5 w-3.5" />
        </button>
        <Hairline />
        <button
          type="button"
          aria-label={panel ? 'Hide what was said' : 'Show what was said'}
          title={panel ? 'Hide what was said' : 'Show what was said'}
          aria-expanded={panel}
          aria-controls={panelId}
          onClick={togglePanel}
          className={buttonClass}
        >
          {panel ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
      </div>
    </motion.div>
  );
}

function Hairline() {
  return <span aria-hidden className="mx-0.5 h-5 w-px shrink-0 bg-droid-border" />;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

function readOffset(): Offset {
  try {
    const [x, y] = (localStorage.getItem(OFFSET_STORAGE_KEY) ?? '').split(',').map(Number);
    if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
  } catch {
    // Storage can be unavailable; the bar starts in its corner instead.
  }
  return { x: 0, y: 0 };
}

function writeOffset(offset: Offset): void {
  try {
    const position = [Math.round(offset.x), Math.round(offset.y)].join(',');
    localStorage.setItem(OFFSET_STORAGE_KEY, position);
  } catch {
    // Same: the position is a convenience, not something to fail over.
  }
}
