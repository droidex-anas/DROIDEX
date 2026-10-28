import { useEffect, useState } from 'react';
import type { UsageLimit } from '../../types/bridge';

// Browsers fire a longer timer at once, and a monthly reset is further away.
const MAX_TIMER_MS = 2 ** 31 - 1;

// The limit an idle chat is held on: the one its last turn was refused on,
// until that limit's reset time passes. The wait is checked again whenever the
// clamped timer fires or the window comes back into focus, so a reset weeks
// away never releases the chat early.
export function useActiveUsageLimit(
  limit: UsageLimit | undefined,
  isLive: boolean,
): UsageLimit | undefined {
  const resetsAt = limit?.resetsAt;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (resetsAt === undefined) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = () => {
      const current = Date.now();
      setNow(current);
      clearTimeout(timer);
      if (resetsAt > current) timer = setTimeout(check, Math.min(resetsAt - current, MAX_TIMER_MS));
    };
    check();
    window.addEventListener('focus', check);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', check);
    };
  }, [resetsAt]);
  if (!limit || isLive) return undefined;
  if (resetsAt !== undefined && resetsAt <= now) return undefined;
  return limit;
}
