import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import { WifiOff } from 'lucide-react';
import { Spinner } from '@droidex/icons';
import { EASE_OUT } from './GateLayout';

// Brief drops (a phone waking, a network hop) recover before this, so they never show.
const SHOW_AFTER_S = 1.2;

/** A quiet notice over the running app while the link to the laptop is re-established. */
export function ReconnectPill({
  status,
  retry,
}: {
  status: 'connecting' | 'offline' | null;
  retry: () => void;
}) {
  return (
    <MotionConfig reducedMotion="user">
      <AnimatePresence>
        {status && (
          <motion.div
            key="reconnect"
            role="status"
            initial={{ opacity: 0, y: -8 }}
            animate={{
              opacity: 1,
              y: 0,
              transition: { delay: SHOW_AFTER_S, duration: 0.24, ease: EASE_OUT },
            }}
            exit={{ opacity: 0, y: -8, transition: { duration: 0.16 } }}
            className="fixed inset-x-0 top-[max(12px,env(safe-area-inset-top))] z-[1300] mx-auto flex w-fit items-center gap-2 whitespace-nowrap rounded-full bg-droid-raised py-1.5 pl-3.5 pr-1.5 text-[12px] text-droid-text-secondary shadow-droid-sm"
          >
            {status === 'offline' ? (
              <WifiOff size={13} className="text-droid-text-muted" aria-hidden />
            ) : (
              <Spinner className="h-3 w-3 motion-safe:animate-spin-slow" />
            )}
            <span className="pr-2">
              {status === 'offline' ? 'Laptop unreachable. Retrying…' : 'Reconnecting…'}
            </span>
            {status === 'offline' && (
              <button
                type="button"
                onClick={retry}
                className="rounded-full bg-droid-elevated px-2.5 py-0.5 font-medium text-droid-text transition-colors hover:bg-droid-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-droid-accent/30"
              >
                Retry
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </MotionConfig>
  );
}
