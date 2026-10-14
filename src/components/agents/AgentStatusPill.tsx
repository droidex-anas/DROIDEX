import { motion } from 'framer-motion';
import type { ChildStatus } from '../../types/bridge';
import { AGENT_STATUS_LABEL } from './agentMonitorModel';

export type AgentPillStatus = ChildStatus | 'queued';

// Done is a raised chip rather than a tint: a finished agent should read as
// settled, not as another coloured state competing with the live ones. Failed
// keeps a tint, because it is the one terminal state worth looking at.
const PILL_TONE: Record<AgentPillStatus, string> = {
  running: 'bg-success/15 text-success',
  paused: 'bg-warning/15 text-warning',
  pending: 'bg-active/60 text-muted',
  queued: 'bg-active/60 text-muted',
  failed: 'bg-danger/15 text-danger',
  completed: 'bg-elevated text-primary',
};

// The count pills on the summary line and the status pill on a row are the same
// chip: expanding the card glides one into the other (see AgentMonitorCard).
export function AgentStatusPill({
  status,
  count,
  layoutId,
  className = '',
}: {
  status: AgentPillStatus;
  count?: number;
  layoutId?: string;
  className?: string;
}) {
  return (
    <motion.span
      {...(layoutId !== undefined ? { layoutId } : {})}
      data-testid="agent-status-pill"
      data-status={status}
      className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-label ${PILL_TONE[status]} ${className}`}
    >
      {count != null ? `${String(count)} ` : ''}
      {AGENT_STATUS_LABEL[status]}
    </motion.span>
  );
}
