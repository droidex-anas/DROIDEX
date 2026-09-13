import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';

import { ModelIcon } from '../../components/ModelIcon';
import { fitToWindow } from '../../components/composer/popoverFit';
import { useStoreSelector } from '../../hooks/useStore';
import { refreshProviders } from '../../lib/commands';
import { PROVIDER_KINDS, type ProviderKind } from '../../types/bridge';
import { PROVIDER_LABELS, PROVIDER_MARKS, providerUnavailableReason } from './providerIdentity';

const PREFERRED_WIDTH_PX = 280;
const MIN_WIDTH_PX = 200;

// The provider chip in the composer toolbar, beside the model chip it scopes.
// A session's provider is bound when it is created, so an open session shows
// its binding as a plain mark instead of a control. Open state is owned by the
// composer, which hides the native browser view while a popover is up.
export default function ProviderPicker({
  value,
  locked,
  open,
  onOpenChange,
  onSelect,
}: {
  value: ProviderKind;
  locked: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (provider: ProviderKind) => void;
}) {
  const statuses = useStoreSelector((state) => state.providerStatuses);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [fit, setFit] = useState<{ width: number; left: number }>();

  // Readiness is derived from what the sidecar already knows, so asking on
  // every open costs nothing and keeps a stale CLI from looking available.
  useEffect(() => {
    if (open) refreshProviders();
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const refit = () => {
      const trigger = buttonRef.current;
      if (!trigger) return;
      setFit(
        fitToWindow(
          trigger.getBoundingClientRect().left,
          window.innerWidth,
          PREFERRED_WIDTH_PX,
          MIN_WIDTH_PX,
        ),
      );
    };
    refit();
    window.addEventListener('resize', refit);
    return () => {
      window.removeEventListener('resize', refit);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      onOpenChange(false);
      // Closing via Escape must return keyboard focus to the chip.
      buttonRef.current?.focus();
    };
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onOpenChange(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [open, onOpenChange]);

  // Arrow keys walk the rows, as they do in a menu. Unavailable providers are
  // disabled and therefore unfocusable, so they are skipped rather than trapped.
  const moveFocus = (e: KeyboardEvent<HTMLDivElement>) => {
    const rows = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>(
        '[role="menuitemradio"]:not(:disabled)',
      ) ?? [],
    );
    if (rows.length === 0) return;
    const current = rows.findIndex((row) => row === document.activeElement);
    let next: number;
    if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = rows.length - 1;
    else if (e.key === 'ArrowDown') next = (current + 1) % rows.length;
    else if (e.key === 'ArrowUp') next = (current - 1 + rows.length) % rows.length;
    else return;
    e.preventDefault();
    rows.at(next)?.focus();
  };

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
          onOpenChange(!open);
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
            style={fit}
            className="absolute bottom-full left-0 z-50 mb-2 w-[280px]"
          >
            <div
              ref={menuRef}
              role="menu"
              aria-label="Provider"
              onKeyDown={moveFocus}
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
                      onOpenChange(false);
                      buttonRef.current?.focus();
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
