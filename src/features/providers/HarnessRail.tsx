import { PROVIDER_KINDS, type ProviderKind, type ProviderStatus } from '../../types/bridge';
import { ModelIcon } from '../../components/ModelIcon';
import { harnessChoice, PROVIDER_MARKS } from './providerIdentity';

// The harness column of the classic model popover: one mark per CLI a new chat
// can run on.
export default function HarnessRail({
  current,
  statuses,
  onSelect,
}: {
  current: ProviderKind;
  statuses: ProviderStatus[];
  onSelect: (provider: ProviderKind) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Harness"
      className="flex w-11 shrink-0 flex-col items-center gap-1 py-1.5"
    >
      {PROVIDER_KINDS.map((provider) => {
        const { selected, disabled, title } = harnessChoice(provider, current, statuses);
        let tone = 'text-muted hover:bg-elevated dark:hover:bg-surface/60 hover:text-primary';
        if (selected) tone = 'bg-active text-primary dark:bg-surface';
        else if (disabled) tone = 'cursor-not-allowed text-muted/40';
        return (
          <button
            key={provider}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            title={title}
            onClick={() => {
              if (!selected) onSelect(provider);
            }}
            className={`grid size-control-md place-items-center rounded-md transition-colors ${tone}`}
          >
            <ModelIcon provider={PROVIDER_MARKS[provider]} size={16} />
          </button>
        );
      })}
    </div>
  );
}
