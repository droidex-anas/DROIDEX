import { motion, useReducedMotion } from 'framer-motion';
import type { CSSProperties, ReactNode } from 'react';

// Spec §11: the move from Design home to the canvas workspace is one
// transition, not a fade-out and a re-mount.
const TRAVEL_SECONDS = 0.2;
const TRAVEL_EASE = [0.16, 1, 0.3, 1] as const;
const LAYOUT_ID = 'design-composer';

/**
 * The composer's outer box. In Design mode the home's composer and the one in
 * the canvas workspace's chat column are the same thing to the user, so
 * whichever is live carries a shared layout id and travels between them on send
 * (spec §4). Only the live composer takes it, so two never claim it at once.
 * Everywhere else, and under reduced motion, this is the plain box it has
 * always been.
 */
export function DesignComposerFrame({
  travels,
  className,
  style,
  children,
}: {
  travels: boolean;
  className: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const reduceMotion = useReducedMotion();
  if (!travels || reduceMotion)
    return (
      <div className={className} style={style}>
        {children}
      </div>
    );
  return (
    <motion.div
      layoutId={LAYOUT_ID}
      layout="position"
      transition={{ duration: TRAVEL_SECONDS, ease: TRAVEL_EASE }}
      className={className}
      style={style}
    >
      {children}
    </motion.div>
  );
}
