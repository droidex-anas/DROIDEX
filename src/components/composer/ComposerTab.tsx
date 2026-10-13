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
      // The composer's own corner, carried onto the tab above it.
      className="relative z-0 mx-10 -mb-3 min-w-0 rounded-t-xl bg-surface px-4 pb-4 pt-1.5 shadow-sm"
    >
      {children}
    </motion.div>
  );
}
