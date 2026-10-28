import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AcceptEdits, AutoApprove, Check, FullAccess, Spinner, Supervised } from '@droidex/icons';

import type { Autonomy, ProviderKind } from '../types/bridge';
import {
  autonomyConsequence,
  AUTONOMY_DESCRIPTIONS,
  AUTONOMY_LABELS,
  AUTONOMY_LEVELS,
} from '../lib/autonomy';

// One glyph per mode, reading left to right as the permissions open up.
const AUTONOMY_GLYPHS = {
  off: Supervised,
  low: AcceptEdits,
  medium: AutoApprove,
  high: FullAccess,
};
// At 14px this draws the same 1.33px line as the composer's + and send icons.
const GLYPH_STROKE = 2.29;

export type AutonomyScope = 'draft' | 'session' | 'settings';

// In the composer the pill already says which chat it belongs to; only the
// settings copy needs to say what its choice applies to.
const SCOPE_CAPTIONS: Partial<Record<AutonomyScope, string>> = {
  settings: 'Default for new sessions',
};

const POPOVER_OFFSET_Y = { up: 8, down: -8 } as const;
const POPOVER_PLACEMENT_CLASS = {
  up: 'bottom-full mb-2',
  down: 'top-full mt-2',
} as const;
const POPOVER_ALIGN_CLASS = { start: 'left-0', end: 'right-0' } as const;

// The one autonomy control: a compact pill that opens the four levels with
// their consequences. Controlled — the parent owns the value and the command
// that a selection triggers (draft state, live session update, or the
// persisted default). While `pending`, the parent can show the requested
// level while the provider confirms it.
export default function AutonomySelector({
  scope,
  value,
  provider,
  pending = false,
  disabled = false,
  onSelect,
  placement = 'up',
  align = 'end',
}: {
  scope: AutonomyScope;
  value: Autonomy;
  /** The chat's harness, so the chosen mode can say what it means there. */
  provider?: ProviderKind;
  pending?: boolean;
  disabled?: boolean;
  onSelect: (level: Autonomy) => void;
  placement?: 'up' | 'down';
  align?: 'start' | 'end';
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      // Closing via Escape must return keyboard focus to the pill.
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

  const inactive = disabled || pending;
  const title = pending
    ? 'Updating autonomy…'
    : `${AUTONOMY_LABELS[value]} — ${AUTONOMY_DESCRIPTIONS[value]}`;

  const Glyph = AUTONOMY_GLYPHS[value];
  let tone = 'text-droid-text-secondary hover:text-droid-text hover:bg-droid-bg/40';
  if (open) tone = 'bg-droid-bg/60 text-droid-text';
  else if (inactive) tone = 'text-droid-text-muted/60 cursor-not-allowed';

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          setOpen((v) => !v);
        }}
        disabled={inactive}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-busy={pending}
        aria-label={`Autonomy: ${AUTONOMY_LABELS[value]}`}
        title={title}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] transition-colors ${tone}`}
      >
        {pending ? (
          <Spinner className="w-3.5 h-3.5 shrink-0 motion-safe:animate-spin-slow" />
        ) : (
          <Glyph className="h-3.5 w-3.5 shrink-0" strokeWidth={GLYPH_STROKE} />
        )}
        <span>{AUTONOMY_LABELS[value]}</span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: POPOVER_OFFSET_Y[placement], scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: POPOVER_OFFSET_Y[placement], scale: 0.98 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            className={`absolute z-50 w-[360px] ${POPOVER_PLACEMENT_CLASS[placement]} ${POPOVER_ALIGN_CLASS[align]}`}
          >
            <AutonomyMenu
              scope={scope}
              value={value}
              provider={provider}
              onSelect={(level) => {
                // Reselecting the confirmed level can revoke a different pending grant.
                if (pending || level !== value) onSelect(level);
                setOpen(false);
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// The level menu panel: header caption plus every level with its consequence
// description. A check marks the active level and each row's number is its
// keyboard shortcut. Exported on its own so the menu content is testable
// without opening the popover.
export function AutonomyMenu({
  scope,
  value,
  provider,
  onSelect,
}: {
  scope: AutonomyScope;
  value: Autonomy;
  provider?: ProviderKind;
  onSelect: (level: Autonomy) => void;
}) {
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const onMenuKey = (e: React.KeyboardEvent) => {
    if (/^[1-9]$/.test(e.key)) {
      const index = Number(e.key) - 1;
      if (index < AUTONOMY_LEVELS.length) {
        e.preventDefault();
        onSelect(AUTONOMY_LEVELS[index]);
      }
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const options = optionRefs.current.filter((el): el is HTMLButtonElement => el !== null);
    if (options.length === 0) return;
    const index = options.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      e.key === 'ArrowDown'
        ? options[(index + 1) % options.length]
        : options[(index - 1 + options.length) % options.length];
    next.focus();
  };

  return (
    <div
      role="menu"
      aria-label="Autonomy"
      onKeyDown={onMenuKey}
      className="rounded-2xl border border-droid-border/60 bg-droid-raised shadow-droid overflow-hidden"
    >
      <div className="flex items-center justify-between gap-3 px-3 pt-3 pb-1.5">
        <span className="text-[12px] font-medium text-droid-text-secondary">Autonomy</span>
        {SCOPE_CAPTIONS[scope] && (
          <span className="truncate text-[11px] text-droid-text-muted">
            {SCOPE_CAPTIONS[scope]}
          </span>
        )}
      </div>
      <div className="px-1.5 pb-1.5 space-y-0.5">
        {AUTONOMY_LEVELS.map((level, i) => {
          const selected = level === value;
          const Mark = AUTONOMY_GLYPHS[level];
          const consequence = selected ? autonomyConsequence(provider, level) : undefined;
          return (
            <button
              key={level}
              type="button"
              ref={(el) => {
                optionRefs.current[i] = el;
              }}
              role="menuitemradio"
              aria-checked={selected}
              autoFocus={selected}
              onClick={() => {
                onSelect(level);
              }}
              className={`w-full flex items-start gap-3 px-2.5 py-2 rounded-lg text-left transition-colors ${
                selected ? 'bg-droid-surface' : 'hover:bg-droid-surface/60'
              }`}
            >
              <Mark
                className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${
                  selected ? 'text-droid-text-secondary' : 'text-droid-text-muted'
                }`}
                strokeWidth={GLYPH_STROKE}
              />
              <span className="min-w-0 flex-1">
                <span
                  className={`block text-[13px] ${
                    selected ? 'font-medium text-droid-text' : 'text-droid-text-secondary'
                  }`}
                >
                  {AUTONOMY_LABELS[level]}
                </span>
                <span className="mt-0.5 block text-[11px] text-droid-text-muted leading-snug">
                  {AUTONOMY_DESCRIPTIONS[level]}
                </span>
                {consequence && (
                  <span className="mt-1 block text-[11px] text-droid-text-secondary leading-snug">
                    {consequence}
                  </span>
                )}
              </span>
              {selected && (
                <Check
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 text-droid-accent"
                  strokeWidth={2.6}
                />
              )}
              <span className="mt-0.5 w-3 shrink-0 text-right text-[10px] tabular-nums text-droid-text-muted/60">
                {i + 1}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
