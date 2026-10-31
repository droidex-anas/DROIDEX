import { motion, useReducedMotion } from 'framer-motion';
import type { CSSProperties, ReactNode } from 'react';

// The panel spring (feel.md): a long move settles in about a third of a
// second, and one reversed half-way keeps its speed instead of restarting.
const TRAVEL = { type: 'spring', stiffness: 400, damping: 40 } as const;

/**
 * The composer's outer box. A new chat's composer stands in the middle of its
 * home; the first send carries it to the foot of its column, and a send that
 * fails carries it back, as one travel rather than a jump (spec §4). Only that
 * change is measured, so typing never reads layout. Under reduced motion it is
 * a plain box.
 */
export function ComposerFrame({
  centered,
  className,
  style,
  children,
}: {
  centered: boolean;
  className: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const reduceMotion = useReducedMotion();
  if (reduceMotion)
    return (
      <div className={className} style={style}>
        {children}
      </div>
    );
  return (
    <motion.div
      layout="position"
      layoutDependency={centered}
      transition={TRAVEL}
      className={className}
      style={style}
    >
      {children}
    </motion.div>
  );
}
