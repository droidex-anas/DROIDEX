import type { ReactNode } from 'react';
import type { AgentPaneTab } from './AgentPane';

/* The context panel's tab row: Context, always, and Subagents while the session
   has any. Never a tab per agent — the Subagents tab holds the whole list. */

export function AgentPaneTabs({
  tab,
  hasAgents,
  agentCount,
  trailing,
  onSelect,
}: {
  tab: AgentPaneTab;
  hasAgents: boolean;
  agentCount: number;
  trailing?: ReactNode;
  onSelect: (tab: AgentPaneTab) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Context panel"
      className="flex h-11 shrink-0 items-center gap-1 border-b border-droid-border/70 pl-2 pr-3"
    >
      <PaneTab
        label="Context"
        selected={tab === 'context'}
        onSelect={() => {
          onSelect('context');
        }}
      />
      {hasAgents ? (
        <PaneTab
          label="Subagents"
          count={agentCount}
          selected={tab === 'subagents'}
          onSelect={() => {
            onSelect('subagents');
          }}
        />
      ) : null}
      <span className="ml-auto shrink-0">{trailing}</span>
    </div>
  );
}

function PaneTab({
  label,
  count,
  selected,
  onSelect,
}: {
  label: string;
  count?: number;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onSelect}
      className={`flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 text-[13px] font-semibold tracking-[-0.01em] transition-colors ${
        selected
          ? 'bg-droid-elevated text-droid-text'
          : 'text-droid-text-muted hover:text-droid-text-secondary'
      }`}
    >
      {label}
      {count != null && (
        <span className="text-[11px] font-medium tabular-nums text-droid-text-muted">{count}</span>
      )}
    </button>
  );
}
