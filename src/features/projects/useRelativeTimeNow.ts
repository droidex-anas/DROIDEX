import { useEffect, useState } from 'react';

const REFRESH_MS = 30_000;

/** The time relative labels count from, refreshed often enough to stay honest
    without re-rendering a whole list every second. */
export function useRelativeTimeNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, REFRESH_MS);
    return () => {
      clearInterval(timer);
    };
  }, []);
  return now;
}
