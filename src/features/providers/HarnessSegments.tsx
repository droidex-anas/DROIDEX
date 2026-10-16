import { motion } from 'framer-motion';
import { Lock } from 'lucide-react';
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
 * Compact harness picker for the slider-style model popover: one segment per
 * harness with a sliding selection pill. Lock and availability semantics match
 * the rail: a live chat keeps the harness it was created on, and a harness
 * with no usable status is not pickable yet.
 */
export default function HarnessSegments({
  provider,
  statuses,
  locked,
  onSelect,
}: {
  provider: ProviderKind;
  statuses: ProviderStatus[];
  locked: boolean;
  onSelect: (kind: ProviderKind) => void;
}) {
  return (
    <div className="px-3 pt-3">
      <div
        role="radiogroup"
        aria-label="Harness"
        className="relative flex gap-0.5 rounded-lg bg-elevated p-0.5 dark:bg-bg/60"
      >
        {PROVIDER_KINDS.map((kind) => {
          const {
            selected,
            disabled: unavailable,
            title,
          } = harnessChoice(kind, provider, statuses, locked);
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
              className={`relative flex h-control-sm flex-1 items-center justify-center rounded-md text-label transition-colors ${segmentTone(selected, unavailable)}`}
            >
              {selected && (
                <motion.span
                  layoutId="model-slider-harness-pill"
                  aria-hidden
                  className="absolute inset-0 rounded-md bg-raised"
                  transition={{ type: 'spring', stiffness: 520, damping: 38 }}
                />
              )}
              <span className="relative flex items-center gap-1.5">
                <ModelIcon provider={PROVIDER_MARKS[kind]} size={13} />
                {SHORT_LABELS[kind]}
                {locked && selected && <Lock className="size-icon-sm text-muted" />}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
