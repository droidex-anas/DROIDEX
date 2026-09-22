import { PROVIDER_KINDS, type ProviderKind, type ProviderStatus } from '../../types/bridge';
import { ModelIcon } from '../../components/ModelIcon';
import { PROVIDER_LABELS, PROVIDER_MARKS, providerUnavailableReason } from './providerIdentity';

// The harness column of the model popover: one mark per CLI a chat can run on.
// A new draft switches freely; once the chat exists its harness is fixed, so
// the other marks stay visible but stop accepting input.
export default function HarnessRail({
  current,
  statuses,
  locked,
  onSelect,
}: {
  current: ProviderKind;
  statuses: ProviderStatus[];
  locked: boolean;
  onSelect: (provider: ProviderKind) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Harness"
      className="flex w-11 shrink-0 flex-col items-center gap-1 border-r border-droid-border py-3"
    >
      {PROVIDER_KINDS.map((provider) => {
        const selected = provider === current;
        const reason = providerUnavailableReason(
          statuses.find((entry) => entry.provider === provider),
        );
        const disabled = locked ? !selected : reason !== null;
        let title = reason ?? `Run this chat on ${PROVIDER_LABELS[provider]}`;
        if (locked) {
          title = selected
            ? `${PROVIDER_LABELS[provider]} — this chat's harness`
            : `${PROVIDER_LABELS[provider]} — a chat keeps the harness it was created on`;
        }
        let tone = 'text-droid-text-muted hover:bg-droid-surface/60 hover:text-droid-text';
        if (selected) tone = 'bg-droid-surface text-droid-text';
        else if (disabled) tone = 'cursor-not-allowed text-droid-text-muted/40';
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
            className={`grid h-8 w-8 place-items-center rounded-lg transition-colors ${tone}`}
            style={
              selected
                ? {
                    boxShadow:
                      'inset 0 0 0 1px color-mix(in srgb, var(--droid-accent) 33%, transparent)',
                  }
                : undefined
            }
          >
            <ModelIcon provider={PROVIDER_MARKS[provider]} size={16} />
          </button>
        );
      })}
    </div>
  );
}
