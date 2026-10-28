import { useEffect, useState } from 'react';

const REFRESH_MS = 30_000;

/** The time relative labels count from, refreshed often enough to stay honest
    without re-rendering a whole list every second. With `until`, the clock
    stops once that time has passed, when the label no longer changes. */
export function useRelativeTimeNow(until?: number): number {
  const [now, setNow] = useState(() => Date.now());
  const running = until === undefined || now < until;
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      setNow(Date.now());
    }, REFRESH_MS);
    return () => {
      clearInterval(timer);
    };
  }, [running]);
  return now;
}
