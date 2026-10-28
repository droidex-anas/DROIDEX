import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';

// Eased (expo-out) count-up for headline metrics. Returns the target at once
// when the user prefers reduced motion, and re-runs from the current value
// when the target changes (e.g. after a refresh).
export function useCountUp(target: number, durationMs = 700): number {
  const reduce = useReducedMotion();
  const [value, setValue] = useState(target);
  const fromRef = useRef(target);
  const firstRun = useRef(true);
  useEffect(() => {
    if (reduce) {
      fromRef.current = target;
      setValue(target);
      return;
    }
    const from = firstRun.current ? 0 : fromRef.current;
    firstRun.current = false;
    if (from === target) return;
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
      const current = Math.round(from + (target - from) * eased);
      fromRef.current = current;
      setValue(current);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [target, durationMs, reduce]);
  return value;
}
