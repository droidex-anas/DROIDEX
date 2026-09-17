import { memo } from 'react';
import { motion } from 'framer-motion';
import type { ChildSessionSummary, ProviderKind, ReasoningEffort } from '../../types/bridge';
import { isPendingChildPlaceholder } from '../../lib/childSessions';
import { reasoningEffortLabel } from '../../lib/reasoningEffort';
import { formatDuration } from '../../lib/tools';
import { ModelIcon } from '../ModelIcon';
import { AgentStatusPill } from './AgentStatusPill';
import type { AgentRow as AgentRowModel } from './agentMonitorModel';

export function agentRowTitle(name: string, childSessionId: string): string {
  if (isPendingChildPlaceholder({ childSessionId })) return `Open ${name}`;
  return `Open ${name}\nChild ID: ${childSessionId}`;
}

export interface AgentRowProps {
  row: AgentRowModel;
  provider?: ProviderKind;
  durationMs?: number;
  // The context pane is a third of the card's width: the same row, wrapped.
  dense?: boolean;
  // The pill that glides out of the summary line when the card expands; only
  // the first row of each status carries one.
  pillLayoutId?: string;
  // The child itself, not its spawn link: a workflow phase and a delegated
  // role can share one tool-use id, so only the child identifies the agent.
  onOpen?: (child: ChildSessionSummary) => void;
}

export function areAgentRowPropsEqual(previous: AgentRowProps, next: AgentRowProps): boolean {
  return (
    previous.row.child === next.row.child &&
    previous.row.snapshot === next.row.snapshot &&
    previous.row.status === next.row.status &&
    previous.row.name === next.row.name &&
    previous.row.description === next.row.description &&
    previous.row.provider === next.row.provider &&
    previous.row.target?.toolUseId === next.row.target?.toolUseId &&
    previous.provider === next.provider &&
    previous.durationMs === next.durationMs &&
    previous.dense === next.dense &&
    previous.pillLayoutId === next.pillLayoutId &&
    previous.onOpen === next.onOpen
  );
}

// The top rung gets the reasoning colour the model picker already uses for it;
// every other level stays the neutral chip.
export function AgentEffortChip({
  effort,
  provider,
}: {
  effort: ReasoningEffort;
  provider?: ProviderKind;
}) {
  const ultra = effort === 'ultra';
  return (
    <span
      data-testid="agent-effort"
      data-effort={effort}
      className={`shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium capitalize ${
        ultra
          ? 'bg-droid-ultra/15 text-droid-ultra'
          : 'bg-droid-active/60 text-droid-text-secondary'
      }`}
    >
      {reasoningEffortLabel(effort, provider)}
    </span>
  );
}

export const AgentRow = memo(function AgentRow({
  row,
  provider,
  durationMs,
  dense = false,
  pillLayoutId,
  onOpen,
}: AgentRowProps) {
  const { child } = row;
  const canOpen = Boolean(onOpen && !isPendingChildPlaceholder(child));
  const elapsed = durationMs != null ? formatDuration(durationMs) : '';
  const pill = (
    <AgentStatusPill
      status={row.queued ? 'queued' : row.status}
      {...(pillLayoutId !== undefined ? { layoutId: pillLayoutId } : {})}
    />
  );
  const identity = (
    <>
      <ModelIcon provider={row.provider} size={16} />
      <span className="truncate text-[13px] font-medium leading-5 text-droid-text">{row.name}</span>
      {child.reasoningEffort ? (
        <AgentEffortChip effort={child.reasoningEffort} {...(provider ? { provider } : {})} />
      ) : null}
    </>
  );
  const rowClass = `flex w-full flex-col gap-1 rounded-[10px] px-2.5 py-2 text-left transition-colors ${
    canOpen ? 'hover:bg-droid-active/40' : ''
  }`;

  const body = dense ? (
    <>
      <span className="flex items-center gap-2">
        {identity}
        <span className="ml-auto flex shrink-0 items-center gap-2">{pill}</span>
      </span>
      <span className="flex items-center gap-2 pl-[26px]">
        <span className="min-w-0 flex-1 truncate text-[12px] text-droid-text-secondary">
          {row.description}
        </span>
        <span className="shrink-0 text-[11px] tabular-nums text-droid-text-muted">{elapsed}</span>
      </span>
    </>
  ) : (
    <span className="flex w-full items-center gap-3">
      <span className="flex w-[196px] shrink-0 items-center gap-2.5">{identity}</span>
      <span className="min-w-0 flex-1 truncate text-[13px] text-droid-text-secondary">
        {row.description}
      </span>
      {pill}
      <span className="w-14 shrink-0 text-right text-[12px] tabular-nums text-droid-text-muted">
        {elapsed}
      </span>
    </span>
  );

  return (
    <motion.li
      data-testid="agent-row"
      data-child-key={row.key}
      data-child-session-id={child.childSessionId}
      data-stream-fidelity={row.snapshot.fidelity}
      variants={{ hidden: { opacity: 0, y: 6 }, show: { opacity: 1, y: 0 } }}
    >
      {canOpen ? (
        <button
          type="button"
          onClick={() => {
            onOpen?.(child);
          }}
          title={agentRowTitle(row.agentName, child.childSessionId)}
          className={rowClass}
        >
          {body}
        </button>
      ) : (
        <div className={rowClass}>{body}</div>
      )}
    </motion.li>
  );
}, areAgentRowPropsEqual);
