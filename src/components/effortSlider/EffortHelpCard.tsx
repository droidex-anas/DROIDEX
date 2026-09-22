import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';

const GAP_PX = 8;
const EDGE_PX = 8;
const SHOW_DELAY_MS = 200;

/**
 * The explanation behind the slider's help button. The button lives in the
 * element's shadow root inside a clipped card, so the explanation floats above
 * that card in a portal, the width of the slider it explains.
 */
export default function EffortHelpCard({
  button,
  anchor,
}: {
  /** The help button whose hover or focus opens the card. */
  button: HTMLElement | null;
  /** The surface the card sits above and matches in width. */
  anchor: HTMLElement | null;
}) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<{ left: number; bottom: number; width: number }>();
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!button) return;
    const show = (delay: number) => {
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        setOpen(true);
      }, delay);
    };
    const hide = () => {
      window.clearTimeout(timer.current);
      setOpen(false);
    };
    const onEnter = () => {
      show(SHOW_DELAY_MS);
    };
    const onFocus = () => {
      if (button.matches(':focus-visible')) show(0);
    };
    button.addEventListener('pointerenter', onEnter);
    button.addEventListener('pointerleave', hide);
    button.addEventListener('focus', onFocus);
    button.addEventListener('blur', hide);
    return () => {
      window.clearTimeout(timer.current);
      button.removeEventListener('pointerenter', onEnter);
      button.removeEventListener('pointerleave', hide);
      button.removeEventListener('focus', onFocus);
      button.removeEventListener('blur', hide);
    };
  }, [button]);

  useLayoutEffect(() => {
    if (!open || !anchor) return;
    const rect = anchor.getBoundingClientRect();
    const width = Math.min(rect.width, window.innerWidth - EDGE_PX * 2);
    setPlace({
      left: Math.max(EDGE_PX, Math.min(rect.left, window.innerWidth - width - EDGE_PX)),
      bottom: window.innerHeight - rect.top + GAP_PX,
      width,
    });
  }, [open, anchor]);

  return createPortal(
    <AnimatePresence>
      {open && place && (
        <motion.div
          role="tooltip"
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 4 }}
          transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
          style={place}
          className="pointer-events-none fixed z-[200] rounded-xl border border-droid-border/60 bg-droid-elevated px-3.5 py-3 shadow-droid"
        >
          <div className="text-[13px] font-medium text-droid-text">Effort</div>
          <p className="mt-1 text-[12px] leading-5 text-droid-text-muted">
            Higher effort means more thorough responses, but takes longer and uses your limits
            faster.
          </p>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
