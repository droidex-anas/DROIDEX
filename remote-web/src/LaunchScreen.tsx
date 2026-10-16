import { MotionConfig, motion } from 'framer-motion';
import { Spinner } from '@droidex/icons';
import { BrandMark } from '../../src/components/BrandMark';
import { EASE_OUT } from './GateLayout';

/**
 * What a browser shows while it reaches the laptop. A trusted browser usually
 * goes straight from here into the app, so the message only appears once the
 * wait is long enough to notice.
 */
export function LaunchScreen({ message }: { message: string }) {
  return (
    <MotionConfig reducedMotion="user">
      <motion.main
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.22, ease: EASE_OUT }}
        aria-busy
        className="fixed inset-0 z-[1300] flex flex-col items-center justify-center gap-5 bg-droid-bg text-droid-text"
      >
        <BrandMark size={26} className="text-droid-text" />
        <motion.p
          role="status"
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.9, duration: 0.3, ease: EASE_OUT }}
          className="flex items-center gap-2 text-[13px] text-droid-text-muted"
        >
          <Spinner className="h-3.5 w-3.5 motion-safe:animate-spin-slow" />
          {message}
        </motion.p>
      </motion.main>
    </MotionConfig>
  );
}
