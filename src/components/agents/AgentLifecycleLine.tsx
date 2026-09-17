import { AgentAvatar } from '../AgentAvatar';
import type { AgentRow } from './agentMonitorModel';

/* A wave's lifecycle in the transcript: the agents' own creatures and one
   sentence, in the same quiet tone as the feed's status rows. */

const LIFECYCLE_ICON_LIMIT = 4;

export function AgentLifecycleLine({ rows, text }: { rows: readonly AgentRow[]; text: string }) {
  return (
    <div
      data-testid="agent-lifecycle-line"
      className="flex items-center gap-2 text-[13px] leading-relaxed text-droid-text-muted"
    >
      <span className="flex shrink-0 items-center gap-1">
        {rows.slice(0, LIFECYCLE_ICON_LIMIT).map((row) => (
          <AgentAvatar key={row.key} seed={row.key} size={14} />
        ))}
      </span>
      <span className="min-w-0 break-words">{text}</span>
    </div>
  );
}
