import { useEffect, useRef, useState, type ReactNode, type SVGProps } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CircleCheckFilled, X } from '@droidex/icons';
import {
  dismissToast,
  pauseToast,
  resumeToast,
  subscribeToasts,
  type ToastItem,
  type ToastVariant,
} from '../../lib/toast';
import { cn } from './cn';
import { pushEscapeLayer } from './escapeStack';

const TOAST_WIDTH_PX = 356;
const STACK_SPRING = { type: 'spring', stiffness: 520, damping: 38 } as const;

// The filled circle-alert the icon set does not have yet: CircleCheckFilled's
// grammar (9.25 radius, even-odd knockout).
function CircleAlertFilled(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M12 2.75a9.25 9.25 0 1 1 0 18.5 9.25 9.25 0 0 1 0-18.5ZM12 7.25a.75.75 0 0 0-.75.75v4.75a.75.75 0 0 0 1.5 0V8a.75.75 0 0 0-.75-.75Zm0 8a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z"
      />
    </svg>
  );
}

// Colour lives only in the 16px status glyph (components/Toast.md); info has none.
const GLYPH: Record<ToastVariant, ReactNode> = {
  success: <CircleCheckFilled className="size-icon-md text-success" aria-hidden="true" />,
  error: <CircleAlertFilled className="size-icon-md text-danger" />,
  info: null,
};

function pauseAll(toasts: ToastItem[]) {
  for (const t of toasts) pauseToast(t.id);
}

function resumeAll(toasts: ToastItem[]) {
  for (const t of toasts) resumeToast(t.id);
}

// Bottom-right, above the status bar, newest closest to the corner. Hovering
// or focusing the stack, or leaving the window, pauses every countdown. Each
// toast is its own live region: role="status" on the container would imply
// aria-atomic and re-announce the whole stack whenever one arrives.
export default function Toaster() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [focusedId, setFocusedId] = useState<number | null>(null);
  const regionRef = useRef<HTMLElement>(null);

  useEffect(() => subscribeToasts(setToasts), []);

  // A focused toast is the topmost Escape layer, so Escape dismisses it and
  // nothing beneath it (an open popover, Settings).
  const escapeTargetId = toasts.some((t) => t.id === focusedId) ? focusedId : null;
  useEffect(() => {
    if (escapeTargetId === null) return;
    return pushEscapeLayer(() => {
      dismissToast(escapeTargetId);
    });
  }, [escapeTargetId]);

  useEffect(() => {
    // A toast raised while the window is in the background, or while the
    // stack is hovered or focused, waits like the ones already there.
    const occupied = regionRef.current?.matches(':hover, :focus-within') === true;
    if (!document.hasFocus() || occupied) pauseAll(toasts);
    const onBlur = () => {
      pauseAll(toasts);
    };
    const onFocus = () => {
      if (!regionRef.current?.matches(':hover, :focus-within')) resumeAll(toasts);
    };
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
    };
  }, [toasts]);

  // ⌥T moves focus to the newest toast, so its close button is reachable.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.altKey || event.code !== 'KeyT') return;
      const newest = regionRef.current?.querySelector<HTMLElement>('[data-toast]:last-of-type');
      if (!newest) return;
      event.preventDefault();
      newest.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  return (
    <section
      ref={regionRef}
      aria-label="Notifications"
      className="pointer-events-none fixed bottom-11 right-4 z-toast flex flex-col items-end gap-2"
      onMouseEnter={() => {
        pauseAll(toasts);
      }}
      onMouseLeave={(event) => {
        if (!event.currentTarget.contains(document.activeElement)) resumeAll(toasts);
      }}
      onFocus={() => {
        pauseAll(toasts);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) resumeAll(toasts);
      }}
    >
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            data-toast
            tabIndex={-1}
            role={t.variant === 'error' ? 'alert' : 'status'}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.12, ease: 'easeIn' } }}
            transition={STACK_SPRING}
            onFocus={() => {
              setFocusedId(t.id);
            }}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) setFocusedId(null);
            }}
            style={{ width: TOAST_WIDTH_PX }}
            className="group pointer-events-auto flex select-none items-start gap-2.5 rounded-lg bg-raised py-3 pl-3.5 pr-2.5 shadow-lg"
          >
            {GLYPH[t.variant] && (
              <span className="mt-px flex size-icon-md shrink-0">{GLYPH[t.variant]}</span>
            )}
            <p className="min-w-0 flex-1 break-words text-body-strong text-primary">{t.message}</p>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => {
                dismissToast(t.id);
              }}
              className={cn(
                '-my-0.5 grid size-6 shrink-0 place-items-center rounded-md text-muted transition duration-150 ease-out hover:bg-text/5 hover:text-primary focus-visible:opacity-100',
                // Timed toasts stay clean until hovered; persistent ones always offer the X.
                t.ttl > 0 && 'opacity-0 group-hover:opacity-100',
              )}
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </section>
  );
}
