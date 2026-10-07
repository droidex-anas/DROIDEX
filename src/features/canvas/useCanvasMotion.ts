import { useReducedMotion } from 'framer-motion';

import { motionFor, type CanvasMotion } from './canvasMotion';

/**
 * Canvas motion tokens resolved against the user's reduced-motion preference,
 * so no Canvas component reads the preference itself.
 */
export function useCanvasMotion(): CanvasMotion {
  return motionFor(useReducedMotion() === true);
}
