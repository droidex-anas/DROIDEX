import { formatDuration } from '../../lib/tools';
import { AgentStatusPill } from './AgentStatusPill';
import { AGENT_STATUS_ORDER } from './agentMonitorModel';
import type { AgentWave } from './useAgentWave';

/* Count pills, one progress bar, its percentage, and the wave's elapsed. The
   transcript card and the docked line show the same line, so a glance at either
   reports the same run. Rendered inside a button, so spans only. */

export function AgentSummaryLine({
  wave,
  showCounts,
  morphId,
  className = '',
}: {
  wave: AgentWave;
  // Collapsed only: expanded, each count pill has become a row's status pill.
  showCounts: boolean;
  morphId?: string;
  className?: string;
}) {
  const percent = Math.round(wave.progress * 100);
  const layoutId = (status: string) => (morphId === undefined ? undefined : `${morphId}:${status}`);
  return (
    <span className={`flex items-center gap-2 ${className}`}>
      {showCounts &&
        AGENT_STATUS_ORDER.map((status) =>
          wave.counts[status] > 0 ? (
            <AgentStatusPill
              key={status}
              status={status}
              count={wave.counts[status]}
              {...(layoutId(status) !== undefined ? { layoutId: layoutId(status) } : {})}
            />
          ) : null,
        )}
      {showCounts && wave.counts.queued > 0 ? (
        <AgentStatusPill
          status="queued"
          count={wave.counts.queued}
          {...(layoutId('queued') !== undefined ? { layoutId: layoutId('queued') } : {})}
        />
      ) : null}
      <span className="ml-1 h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-droid-active/60">
        <span
          data-testid="agent-progress"
          data-percent={percent}
          className="block h-full rounded-full bg-droid-green motion-safe:transition-[width] motion-safe:duration-500"
          style={{ width: `${String(percent)}%` }}
        />
      </span>
      <span className="shrink-0 text-[13px] font-semibold tabular-nums text-droid-text">
        {percent}%
      </span>
      <span className="w-14 shrink-0 text-right text-[12px] tabular-nums text-droid-text-muted">
        {wave.timeMs != null ? formatDuration(wave.timeMs) : ''}
      </span>
    </span>
  );
}
