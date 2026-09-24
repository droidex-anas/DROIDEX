import type { ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { INLINE_CARD_DURATION_S, INLINE_CARD_EASE } from '../../components/inlineCardMotion';

/* Going into a thread or a project and coming back is a lateral move, so the
   list and the open view slide past each other the way the Subagents pane's do. */
export function PaneTransition({
  open,
  reduceMotion,
  viewKey,
  children,
}: {
  open: boolean;
  reduceMotion: boolean;
  viewKey: string | undefined;
  children: ReactNode;
}) {
  const travel = reduceMotion ? 0 : 12;
  return (
    <AnimatePresence initial={false} mode="wait">
      <motion.div
        key={open ? `detail:${viewKey ?? ''}` : 'list'}
        initial={{ opacity: 0, x: open ? travel : -travel }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: open ? -travel : travel }}
        transition={{
          duration: reduceMotion ? 0 : INLINE_CARD_DURATION_S,
          ...(reduceMotion ? {} : { ease: INLINE_CARD_EASE }),
        }}
        className="flex min-h-0 flex-1 flex-col"
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
