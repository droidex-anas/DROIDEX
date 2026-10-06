import { motion, useReducedMotion } from 'framer-motion';
import type { ReactNode } from 'react';

import { inlineCardMotion } from '../inlineCardMotion';

// A tab joined to the composer card's top edge, in StartInBar's slot and
// shape. It sits 12px under the card, so it rises out from behind it.
export function ComposerTab({ children }: { children: ReactNode }) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      {...inlineCardMotion(reduceMotion)}
      className="relative z-0 mx-[6%] -mb-3 min-w-0 border border-droid-border bg-droid-surface px-4 pb-4 pt-1.5"
      // The composer's own 20px corner, carried onto the tab above it.
      style={{ borderTopLeftRadius: 20, borderTopRightRadius: 20 }}
    >
      {children}
    </motion.div>
  );
}
