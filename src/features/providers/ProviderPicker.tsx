import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';

import { ModelIcon } from '../../components/ModelIcon';
import { useStoreSelector } from '../../hooks/useStore';
import { refreshProviders } from '../../lib/commands';
import { PROVIDER_KINDS, type ProviderKind } from '../../types/bridge';
import { PROVIDER_LABELS, PROVIDER_MARKS, providerUnavailableReason } from './providerIdentity';

// The provider chip in the composer toolbar, beside the model chip it scopes.
// A session's provider is bound when it is created, so an open session shows
// its binding as a plain mark instead of a control.
export default function ProviderPicker({
  value,
  locked,
  onSelect,
}: {
  value: ProviderKind;
  locked: boolean;
  onSelect: (provider: ProviderKind) => void;
}) {
  const statuses = useStoreSelector((state) => state.providerStatuses);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Statuses arrive with the sidecar's initial snapshot; ask again if this
  // composer opened before one did.
  const missingStatuses = statuses.length === 0;
  useEffect(() => {
    if (open && missingStatuses) refreshProviders();
  }, [open, missingStatuses]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  if (locked) {
    return (
      <span
        className="flex items-center px-2 py-1 rounded-lg text-droid-text-muted shrink-0"
        title={`${PROVIDER_LABELS[value]} — a chat keeps the provider it was created on`}
      >
        <ModelIcon provider={PROVIDER_MARKS[value]} size={14} />
        <span className="sr-only">{`Provider: ${PROVIDER_LABELS[value]}`}</span>
      </span>
    );
  }

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          setOpen((v) => !v);
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Provider: ${PROVIDER_LABELS[value]}`}
        title={`${PROVIDER_LABELS[value]} — select the provider for this chat`}
        className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] transition-colors ${
          open
            ? 'bg-droid-bg/60 text-droid-text'
            : 'text-droid-text-secondary hover:text-droid-text hover:bg-droid-bg/40'
        }`}
      >
        <ModelIcon provider={PROVIDER_MARKS[value]} size={14} />
        <ChevronDown
          className={`w-3 h-3 shrink-0 text-droid-text-muted/40 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            className="absolute z-50 w-[280px] bottom-full mb-2 left-0"
          >
            <div
              role="menu"
              aria-label="Provider"
              className="rounded-2xl border border-droid-border bg-droid-elevated shadow-2xl shadow-black/50 overflow-hidden"
            >
              <div className="flex items-center justify-between px-4 pt-3 pb-2">
                <span className="text-[11px] font-medium text-droid-text-secondary tracking-wide">
                  Provider
                </span>
                <span className="text-[10px] text-droid-text-muted">Applies to this new chat</span>
              </div>
              <div className="px-2 pb-2 space-y-0.5">
                {PROVIDER_KINDS.map((provider) => (
                  <ProviderOption
                    key={provider}
                    provider={provider}
                    selected={provider === value}
                    reason={providerUnavailableReason(
                      statuses.find((status) => status.provider === provider),
                    )}
                    onSelect={() => {
                      if (provider !== value) onSelect(provider);
                      setOpen(false);
                    }}
                  />
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ProviderOption({
  provider,
  selected,
  reason,
  onSelect,
}: {
  provider: ProviderKind;
  selected: boolean;
  reason: string | null;
  onSelect: () => void;
}) {
  const unavailable = reason !== null;
  let tone = 'hover:bg-droid-surface/60';
  if (unavailable) tone = 'opacity-50';
  else if (selected) tone = 'bg-droid-surface';

  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      autoFocus={selected}
      disabled={unavailable}
      onClick={onSelect}
      className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-colors ${tone}`}
    >
      <ModelIcon provider={PROVIDER_MARKS[provider]} size={16} />
      <span className="min-w-0">
        <span className={`block text-[12px] ${selected ? 'font-medium' : ''} text-droid-text`}>
          {PROVIDER_LABELS[provider]}
        </span>
        {unavailable && (
          <span className="block text-[10px] text-droid-text-muted leading-snug">{reason}</span>
        )}
      </span>
    </button>
  );
}
