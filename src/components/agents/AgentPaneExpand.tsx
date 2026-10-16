import { Maximize, Minimize } from '@droidex/icons';
import { Button } from '../ui/Button';
import { Tooltip } from '../ui/Tooltip';

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
    <Tooltip label={label} placement="bottom">
      <Button
        variant="ghost"
        size="sm"
        icon={Icon}
        aria-label={label}
        aria-pressed={expanded}
        onClick={onToggle}
      />
    </Tooltip>
  );
}
