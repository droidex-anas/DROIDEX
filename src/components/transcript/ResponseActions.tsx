import { Check } from 'lucide-react';
import { Copy, GitFork } from '@droidex/icons';
import { HoverTooltip } from '../HoverTooltip';
import { useCopiedFlash } from './primitives';

const DAY_MS = 24 * 60 * 60 * 1000;

const timeFormat = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const weekdayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'long' });
const monthDayFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const fullDateFormat = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});
const detailFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'short' });

function startOfDay(ts: number): number {
  const day = new Date(ts);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

// "Thursday 17:23" within the last week (today included), then "Mar 3, 17:23",
// and the year once it differs from the current one.
function formatResponseTime(ts: number, now: number): string {
  const time = timeFormat.format(ts);
  // Rounded because a day across a DST change is not exactly DAY_MS long.
  const daysAgo = Math.round((startOfDay(now) - startOfDay(ts)) / DAY_MS);
  if (daysAgo < 7) return `${weekdayFormat.format(ts)} ${time}`;
  const sameYear = new Date(ts).getFullYear() === new Date(now).getFullYear();
  const date = sameYear ? monthDayFormat.format(ts) : fullDateFormat.format(ts);
  return `${date}, ${time}`;
}

const buttonClass =
  'flex h-7 w-7 items-center justify-center rounded-md text-droid-text-muted transition-colors hover:bg-droid-elevated hover:text-droid-text focus-visible:bg-droid-elevated focus-visible:text-droid-text focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50';

function MessageTime({ ts }: { ts: number }) {
  return (
    <time
      dateTime={new Date(ts).toISOString()}
      title={detailFormat.format(ts)}
      className="px-1.5 text-[12px] tabular-nums text-droid-text-muted opacity-0 transition-opacity duration-150 group-hover/msg:opacity-100"
    >
      {formatResponseTime(ts, Date.now())}
    </time>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const { copied, copy } = useCopiedFlash();
  return (
    <HoverTooltip label={copied ? 'Copied' : 'Copy'}>
      <button
        type="button"
        aria-label={label}
        onClick={() => {
          copy(text);
        }}
        className={buttonClass}
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </HoverTooltip>
  );
}

// Hangs under the bubble's right edge without reserving a row, so prompts keep
// their spacing; it only appears on hover or focus.
export function PromptActions({ text, ts }: { text: string; ts: number }) {
  return (
    <div className="pointer-events-none absolute right-0 top-full mt-0.5 flex h-7 items-center opacity-0 transition-opacity duration-150 delay-300 focus-within:pointer-events-auto focus-within:opacity-100 focus-within:delay-0 group-hover/msg:pointer-events-auto group-hover/msg:opacity-100 group-hover/msg:delay-0">
      <MessageTime ts={ts} />
      <CopyButton text={text} label="Copy prompt" />
    </div>
  );
}

// The settled final response's own row: Copy, Fork (copies the chat through
// this response), and when it finished.
export function ResponseActions({
  text,
  ts,
  onFork,
  forking = false,
}: {
  text: string;
  ts: number;
  onFork?: () => void;
  forking?: boolean;
}) {
  return (
    // Pulled left so the first icon lines up with the response text.
    <div className="-ml-1.5 mt-1.5 flex h-7 items-center gap-0.5">
      <CopyButton text={text} label="Copy response" />
      {onFork ? (
        <HoverTooltip label={forking ? 'Forking…' : 'Fork into a new chat'}>
          <button
            type="button"
            aria-label="Fork chat"
            aria-busy={forking}
            disabled={forking}
            onClick={onFork}
            className={buttonClass}
          >
            <GitFork className="h-3.5 w-3.5" />
          </button>
        </HoverTooltip>
      ) : null}
      <MessageTime ts={ts} />
    </div>
  );
}
