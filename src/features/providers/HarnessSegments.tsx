import { motion } from 'framer-motion';
import { Lock } from 'lucide-react';
import { PROVIDER_KINDS, type ProviderKind, type ProviderStatus } from '../../types/bridge';
import { ModelIcon } from '../../components/ModelIcon';
import { PROVIDER_LABELS, PROVIDER_MARKS, providerUnavailableReason } from './providerIdentity';

const accentMix = (pct: number) =>
  `color-mix(in srgb, var(--droid-accent) ${String(pct)}%, transparent)`;

// The rail speaks in full harness names; the segmented row has room for short ones.
const SHORT_LABELS: Record<ProviderKind, string> = {
  droid: 'Droid',
  claude: 'Claude',
  codex: 'Codex',
};

function segmentTone(selected: boolean, unavailable: boolean): string {
  if (selected) return 'text-droid-text';
  if (unavailable) return 'cursor-not-allowed text-droid-text-muted/40';
  return 'text-droid-text-muted hover:text-droid-text';
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
        className="relative flex gap-0.5 rounded-xl border border-droid-border bg-droid-bg/60 p-0.5"
      >
        {PROVIDER_KINDS.map((kind) => {
          const selected = kind === provider;
          const reason = providerUnavailableReason(
            statuses.find((entry) => entry.provider === kind),
          );
          const unavailable = locked ? !selected : reason !== null;
          let title = reason ?? `Run this chat on ${PROVIDER_LABELS[kind]}`;
          if (locked) {
            title = selected
              ? `${PROVIDER_LABELS[kind]} — this chat's harness`
              : `${PROVIDER_LABELS[kind]} — a chat keeps the harness it was created on`;
          }
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
              className={`relative flex h-7 flex-1 items-center justify-center rounded-[9px] text-[11px] font-medium transition-colors ${segmentTone(selected, unavailable)}`}
            >
              {selected && (
                <motion.span
                  layoutId="model-slider-harness-pill"
                  aria-hidden
                  className="absolute inset-0 rounded-[9px] bg-droid-surface"
                  style={{ boxShadow: `inset 0 0 0 1px ${accentMix(33)}` }}
                  transition={{ type: 'spring', stiffness: 520, damping: 38 }}
                />
              )}
              <span className="relative flex items-center gap-1.5">
                <ModelIcon provider={PROVIDER_MARKS[kind]} size={13} />
                {SHORT_LABELS[kind]}
                {locked && selected && <Lock className="h-2.5 w-2.5 text-droid-text-muted" />}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
