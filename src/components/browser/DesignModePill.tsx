import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { MousePointer, PenLine } from '@droidex/icons';
import { Button } from '../ui/Button';

const KEY = 'rounded-xs bg-elevated px-1 font-sans text-caption font-medium text-primary';

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
            className="pointer-events-auto flex h-10 select-none items-center gap-2.5 whitespace-nowrap rounded-full bg-raised pl-3 pr-1.5 text-body text-secondary shadow-lg"
          >
            {drawing ? (
              <PenLine className="size-icon-md shrink-0 text-primary" />
            ) : (
              <MousePointer className="size-icon-md shrink-0 text-primary" />
            )}
            <span>
              <span className="font-medium text-primary">
                {drawing ? 'Drawing.' : 'Design mode.'}
              </span>{' '}
              {drawing ? 'Draw over the page, ' : 'Click to select, '}
              <kbd className={KEY}>D</kbd> {drawing ? 'to stop.' : 'to draw.'}
            </span>
            <Button variant="primary" size="sm" shape="round" onClick={onDone}>
              Done{' '}
              <kbd aria-hidden className="rounded-xs bg-bg/15 px-1 font-sans text-caption">
                Esc
              </kbd>
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
