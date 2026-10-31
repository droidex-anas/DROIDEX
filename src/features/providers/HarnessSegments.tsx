import { motion } from 'framer-motion';
import { PROVIDER_KINDS, type ProviderKind, type ProviderStatus } from '../../types/bridge';
import { ModelIcon } from '../../components/ModelIcon';
import { harnessChoice, PROVIDER_MARKS } from './providerIdentity';

// The rail speaks in full harness names; the segmented row has room for short ones.
const SHORT_LABELS: Record<ProviderKind, string> = {
  droid: 'Droid',
  claude: 'Claude',
  codex: 'Codex',
};

function segmentTone(selected: boolean, unavailable: boolean): string {
  if (selected) return 'text-primary';
  if (unavailable) return 'cursor-not-allowed text-muted/40';
  return 'text-muted hover:text-primary';
}

/**
 * Compact harness picker for the slider-style model popover and side chats:
 * one segment per harness with a sliding selection pill. As on the rail, a
 * harness with no usable status is not pickable yet.
 */
export default function HarnessSegments({
  provider,
  statuses,
  onSelect,
}: {
  provider: ProviderKind;
  statuses: ProviderStatus[];
  onSelect: (kind: ProviderKind) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Harness"
      className="relative flex shrink-0 gap-0.5 rounded-md bg-elevated p-0.5 dark:bg-bg/60"
    >
      {PROVIDER_KINDS.map((kind) => {
        const { selected, disabled: unavailable, title } = harnessChoice(kind, provider, statuses);
        return (
          <button
            key={kind}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={unavailable}
            title={title}
            onClick={() => {
              if (!selected) onSelect(kind);
            }}
            className={`relative flex h-control-sm flex-1 items-center justify-center rounded-sm text-label transition-colors ${segmentTone(selected, unavailable)}`}
          >
            {selected && (
              <motion.span
                layoutId="model-slider-harness-pill"
                aria-hidden
                className="absolute inset-0 rounded-sm bg-raised"
                transition={{ type: 'spring', stiffness: 520, damping: 38 }}
              />
            )}
            <span className="relative flex items-center gap-1.5">
              <ModelIcon provider={PROVIDER_MARKS[kind]} size={13} />
              {SHORT_LABELS[kind]}
            </span>
          </button>
        );
      })}
    </div>
  );
}
