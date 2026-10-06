import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { MousePointer, PenLine } from '@droidex/icons';

const KEY =
  'rounded-[5px] border border-droid-border-hover bg-droid-elevated px-1 font-sans text-[10px] font-medium leading-4 text-droid-text';

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
            className="pointer-events-auto flex h-10 items-center gap-2.5 whitespace-nowrap rounded-full border border-droid-border bg-droid-raised pl-3 pr-1 text-[12px] text-droid-text-secondary shadow-droid"
          >
            {drawing ? (
              <PenLine className="h-4 w-4 shrink-0 text-droid-text" />
            ) : (
              <MousePointer className="h-4 w-4 shrink-0 text-droid-text" />
            )}
            <span>
              <span className="font-medium text-droid-text">
                {drawing ? 'Drawing.' : 'Design mode.'}
              </span>{' '}
              {drawing ? 'Draw over the page, ' : 'Click to select, '}
              <kbd className={KEY}>D</kbd> {drawing ? 'to stop.' : 'to draw.'}
            </span>
            <button
              type="button"
              onClick={onDone}
              className="flex h-8 items-center gap-2 rounded-full bg-droid-accent pl-3 pr-2 text-[12px] font-medium text-droid-bg transition-[opacity,transform] duration-150 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-droid-accent/40 active:scale-[0.96] motion-reduce:transition-none motion-reduce:active:scale-100"
            >
              Done
              <kbd
                aria-hidden
                className="rounded-[5px] bg-droid-bg/15 px-1 font-sans text-[10px] font-medium leading-4"
              >
                Esc
              </kbd>
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
