import { Maximize, Minimize } from '@droidex/icons';
import { HoverTooltip } from '../HoverTooltip';

/* Gives the agent the whole content row, and hands it back. */
export function AgentPaneExpand({
  expanded,
  onToggle,
}: {
  expanded: boolean;
  onToggle: () => void;
}) {
  const label = expanded ? 'Collapse' : 'Expand';
  const Icon = expanded ? Minimize : Maximize;
  return (
    <HoverTooltip label={label} placement="bottom">
      <button
        type="button"
        aria-label={label}
        aria-pressed={expanded}
        onClick={onToggle}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-droid-text-muted transition-colors hover:bg-droid-elevated/60 hover:text-droid-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-droid-accent/60"
      >
        <Icon className="h-3.5 w-3.5" />
      </button>
    </HoverTooltip>
  );
}
