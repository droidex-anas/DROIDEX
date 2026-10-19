import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { TranscriptEvent } from '../../types/bridge';
import { childSessionInfo, formatDuration } from '../../lib/tools';
import {
  childSessionLatest,
  childSessionTargetFromEvent,
  type ChildSessionActivity,
  type ChildSessionTarget,
} from '../../lib/childSessions';
import { Caret, Expand, useElapsed } from './primitives';

/* ── Per-agent name color: deterministic pick so each droid keeps one hue ── */
const CHILD_SESSION_COLORS = [
  '#e0a458',
  '#6ea8fe',
  '#5cc8a8',
  '#c58af9',
  '#e8728f',
  '#7bd88f',
  '#f0a06a',
  '#9d8cff',
] as const;
function childSessionColor(label: string): string {
  let h = 0;
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) >>> 0;
  return CHILD_SESSION_COLORS[h % CHILD_SESSION_COLORS.length];
}

/* ── In-chat spawned child session: inline thinking-style line + click to navigate ── */
export function ChildSessionLine({
  event,
  onOpen,
  activity,
}: {
  event: TranscriptEvent;
  onOpen?: (target: ChildSessionTarget) => void;
  activity?: ChildSessionActivity;
}) {
  const [open, setOpen] = useState(false);
  const { label, description } = childSessionInfo(event.toolArgs);
  const name = label ?? 'child session';
  const color = childSessionColor(name);
  const running = childSessionLineIsRunning(activity);
  const startTs = activity?.startedAt;
  const elapsed = useElapsed(startTs, running);
  const timer = running && startTs != null && elapsed >= 1000 ? formatDuration(elapsed) : '';
  const verb = running ? 'Running' : 'Spawned';
  // Append the literal "child session" only when the name is a real droid label, so a
  // nameless spawn reads "Spawned child session" instead of "Spawned child session child session".
  const tail = [label ? 'child session' : '', timer].filter(Boolean).join(' ');
  const muted = running ? 'shimmer-text font-medium' : 'text-muted';
  const latest = childSessionLatest(activity?.latest);
  const navigate = () => onOpen?.(childSessionTargetFromEvent(event));
  const toggle = () => {
    setOpen((o) => !o);
  };
  return (
    <div>
      <div className="group flex items-center gap-1.5 text-body">
        <button type="button" onClick={toggle} aria-expanded={open} className={muted}>
          {verb}
        </button>
        <button
          type="button"
          onClick={navigate}
          className="inline-link font-semibold"
          style={{ color }}
          title="Open child session"
        >
          {name}
        </button>
        {tail && <span className={muted}>{tail}</span>}
        {/* The verb is the accessible toggle; the chevron repeats it for the pointer. */}
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          onClick={toggle}
          className="-m-0.5 flex items-center rounded-xs p-0.5"
        >
          <Caret open={open} />
        </button>
      </div>
      <Expand open={open}>
        <div className="mt-2 pl-5">
          {description && <div className="text-body text-muted break-words">{description}</div>}
          {latest && (
            <div className="mt-1.5 text-body break-words">
              <span className={running ? 'shimmer-text font-medium' : 'text-secondary font-medium'}>
                {latest.head}
              </span>
              {latest.body && <span className="ml-1.5 text-muted">{latest.body}</span>}
            </div>
          )}
          {!latest && <div className="mt-1.5 text-body text-muted">No activity captured yet.</div>}
          <button
            type="button"
            onClick={navigate}
            className="mt-2 inline-flex items-center gap-1 text-label text-muted transition-colors hover:text-primary"
          >
            Open session
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </Expand>
    </div>
  );
}

export function childSessionLineIsRunning(activity?: ChildSessionActivity): boolean {
  return activity?.status === 'running';
}
