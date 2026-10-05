import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';

// Says design mode is on and how to use it, at the bottom of the page, with
// the way out. It rises in as design mode starts.
export function DesignModePill({
  open,
  drawing,
  bottom = 12,
  onDone,
}: {
  open: boolean;
  drawing: boolean;
  /** How far above the page's foot it sits. */
  bottom?: number | string;
  onDone: () => void;
}) {
  const still = useReducedMotion();
  return (
    <div className="pointer-events-none absolute left-1/2 z-10 -translate-x-1/2" style={{ bottom }}>
      <AnimatePresence>
        {open && (
          <motion.div
            role="status"
            initial={{ opacity: 0, y: still ? 0 : 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: still ? 0 : 8, transition: { duration: 0.15 } }}
            transition={{ duration: 0.4, ease: [0.2, 0.8, 0.2, 1] }}
            className="pointer-events-auto flex items-center gap-3 whitespace-nowrap rounded-full border border-droid-border bg-droid-raised py-1 pl-3.5 pr-1 text-[12px] text-droid-text-secondary shadow-droid"
          >
            <span>
              <span className="font-medium text-droid-text">
                {drawing ? 'Drawing.' : 'Design mode.'}
              </span>{' '}
              {drawing ? 'Draw over the page, D to stop.' : 'Click to select, D to draw.'}
            </span>
            <span className="flex items-center gap-1.5">
              <kbd className="rounded border border-droid-border px-1 font-sans text-[10px] leading-4 text-droid-text-muted">
                Esc
              </kbd>
              <button
                type="button"
                onClick={onDone}
                className="rounded-full bg-droid-accent px-2.5 py-1 text-[11px] font-medium text-droid-bg transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-droid-accent/60"
              >
                Done
              </button>
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
