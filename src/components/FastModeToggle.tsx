import { Zap } from '@droidex/icons';
import { FAST_MODE_HINT, FAST_MODE_LABEL } from '../lib/fastMode';
import { Tooltip } from './ui/Tooltip';

// The small bolt that turns fast mode on beside an effort slider. A model that
// cannot run fast mode disables it and says why.
export function FastModeToggle({
  on,
  blockedReason,
  onToggle,
}: {
  on: boolean;
  blockedReason: string | undefined;
  onToggle: (next: boolean) => void;
}) {
  return (
    <Tooltip label={blockedReason ?? `${FAST_MODE_LABEL} · ${FAST_MODE_HINT}`}>
      <button
        type="button"
        aria-pressed={on}
        aria-label={FAST_MODE_LABEL}
        aria-description={blockedReason ?? FAST_MODE_HINT}
        disabled={blockedReason !== undefined}
        onClick={() => {
          onToggle(!on);
        }}
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-sm transition-colors disabled:opacity-40 ${
          on
            ? 'bg-active text-accent dark:bg-surface'
            : 'text-muted enabled:hover:bg-elevated dark:enabled:hover:bg-surface/60 enabled:hover:text-primary'
        }`}
      >
        <Zap size={14} className="transition-colors" fill={on ? 'currentColor' : 'transparent'} />
      </button>
    </Tooltip>
  );
}
