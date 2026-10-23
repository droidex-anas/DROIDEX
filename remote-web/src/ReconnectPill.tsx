import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import { CircleAlert, Spinner } from '@droidex/icons';
import { Button } from '../../src/components/ui/Button';
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
            className="remote-gate-top fixed inset-x-0 z-tooltip mx-auto flex h-control-lg w-fit items-center gap-2 whitespace-nowrap rounded-full bg-raised pl-3.5 pr-1 text-label text-secondary shadow-sm"
          >
            {status === 'offline' ? (
              <CircleAlert className="size-icon-sm text-muted" aria-hidden="true" />
            ) : (
              <Spinner className="size-icon-sm motion-safe:animate-spin-slow" aria-hidden="true" />
            )}
            <span className="pr-2.5">
              {status === 'offline' ? 'Laptop unreachable. Retrying…' : 'Reconnecting…'}
            </span>
            {status === 'offline' && (
              <Button size="sm" shape="round" onClick={retry}>
                Retry
              </Button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </MotionConfig>
  );
}
