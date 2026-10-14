import type { ReactNode } from 'react';
import { ArrowUp, Check, Copy, GitFork, X } from '@droidex/icons';
import { useRelativeTimeNow } from '../../hooks/useRelativeTimeNow';
import { Button } from '../ui/Button';
import { Tooltip } from '../ui/Tooltip';
import { useCopiedFlash } from './primitives';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

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

function MessageTime({ ts, label }: { ts: number; label?: string }) {
  return (
    <time
      dateTime={new Date(ts).toISOString()}
      title={detailFormat.format(ts)}
      className="whitespace-nowrap px-1.5 text-caption tabular-nums text-muted opacity-0 transition-opacity duration-150 group-hover/msg:opacity-100"
    >
      {label ?? formatResponseTime(ts, Date.now())}
    </time>
  );
}

// A prompt from the last hour says how long ago the agent took it in: "just
// now", then "12m ago". Only those keep a clock running. A clock set ahead of
// this one shows the time instead.
function isRecent(ago: number): boolean {
  return ago >= 0 && ago < HOUR_MS;
}

function PromptTime({ ts }: { ts: number }) {
  return isRecent(Date.now() - ts) ? <RecentPromptTime ts={ts} /> : <MessageTime ts={ts} />;
}

function RecentPromptTime({ ts }: { ts: number }) {
  const now = useRelativeTimeNow(ts + HOUR_MS);
  const ago = now - ts;
  if (!isRecent(ago)) return <MessageTime ts={ts} />;
  const minutes = Math.floor(ago / 60_000);
  return <MessageTime ts={ts} label={minutes < 1 ? 'just now' : `${String(minutes)}m ago`} />;
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const { copied, copy } = useCopiedFlash();
  return (
    <Tooltip label={copied ? 'Copied' : 'Copy'}>
      <Button
        variant="ghost"
        size="sm"
        icon={copied ? Check : Copy}
        aria-label={label}
        onClick={() => {
          copy(text);
        }}
      />
    </Tooltip>
  );
}

// Hangs under the bubble's right edge without reserving a row, so prompts keep
// their spacing; the time and actions appear on hover or focus. A steer the
// model has not taken in yet says so at rest, and can be sent now.
export function PromptActions({
  text,
  ts,
  onSendNow,
  onWithdraw,
}: {
  text: string;
  ts?: number | undefined;
  onSendNow?: (() => void) | undefined;
  /** Takes a steer back into the composer, where the harness can still drop it. */
  onWithdraw?: (() => void) | undefined;
}) {
  return (
    <div className="absolute right-0 top-full mt-0.5 flex h-control-sm items-center">
      <div className="pointer-events-none flex items-center opacity-0 transition-opacity duration-150 delay-300 focus-within:pointer-events-auto focus-within:opacity-100 focus-within:delay-0 group-hover/msg:pointer-events-auto group-hover/msg:opacity-100 group-hover/msg:delay-0">
        {ts !== undefined ? <PromptTime ts={ts} /> : null}
        <CopyButton text={text} label="Copy prompt" />
        {onWithdraw ? (
          <Tooltip label="Edit before sending">
            <Button
              variant="ghost"
              size="sm"
              icon={X}
              aria-label="Take back to edit"
              onClick={onWithdraw}
            />
          </Tooltip>
        ) : null}
        {onSendNow ? (
          <Tooltip label="Send now">
            <Button
              variant="ghost"
              size="sm"
              icon={ArrowUp}
              aria-label="Send now"
              onClick={onSendNow}
            />
          </Tooltip>
        ) : null}
      </div>
      {onSendNow ? <span className="px-1.5 text-caption text-muted">Unread</span> : null}
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
  children,
}: {
  text: string;
  ts: number;
  onFork?: () => void;
  forking?: boolean;
  /** What the chat is doing since this response, ahead of its time. */
  children?: ReactNode;
}) {
  return (
    // Pulled left so the first icon lines up with the response text.
    <div className="-ml-1.5 mt-1.5 flex h-control-sm items-center gap-0.5">
      <CopyButton text={text} label="Copy response" />
      {onFork ? (
        <Tooltip label={forking ? 'Forking…' : 'Fork into a new chat'}>
          <Button
            variant="ghost"
            size="sm"
            icon={GitFork}
            aria-label="Fork chat"
            loading={forking}
            disabled={forking}
            onClick={onFork}
          />
        </Tooltip>
      ) : null}
      {children}
      <MessageTime ts={ts} />
    </div>
  );
}
