import { ArrowDown } from '@droidex/icons';
import { AnimatePresence, motion } from 'framer-motion';
import { Button } from '../ui/Button';

const SMOOTH_OUT = [0.22, 1, 0.36, 1] as const;

// Shown while the reader is a screen or more above the latest output, so
// reading back never pulls the view and the way back stays one click.
export function JumpToLatest({
  visible,
  onJump,
  rightInsetPx,
}: {
  visible: boolean;
  onJump: () => void;
  rightInsetPx?: number;
}) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="jump-to-latest"
          initial={{ opacity: 0, y: 6, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1, transition: { duration: 0.15, ease: SMOOTH_OUT } }}
          exit={{ opacity: 0, transition: { duration: 0.1, ease: 'easeIn' } }}
          className="pointer-events-none absolute inset-x-0 bottom-4 z-10 flex justify-center"
          style={{ paddingRight: rightInsetPx }}
        >
          <Button
            size="sm"
            shape="round"
            icon={ArrowDown}
            onClick={onJump}
            className="pointer-events-auto bg-raised shadow-lg"
          >
            Jump to latest
          </Button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
