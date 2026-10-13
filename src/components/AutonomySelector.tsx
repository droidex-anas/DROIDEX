import { useRef, useState, type KeyboardEvent } from 'react';
import type { Placement } from '@floating-ui/react';
import { AcceptEdits, AutoApprove, Check, FullAccess, Spinner, Supervised } from '@droidex/icons';

import type { Autonomy, ProviderKind } from '../types/bridge';
import {
  autonomyConsequence,
  AUTONOMY_DESCRIPTIONS,
  AUTONOMY_LABELS,
  AUTONOMY_LEVELS,
} from '../lib/autonomy';
import { navigationIndex } from './ui/menuKeys';
import { Popover } from './ui/Popover';

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
  placement = 'top-end',
}: {
  scope: AutonomyScope;
  value: Autonomy;
  /** The chat's harness, so the chosen mode can say what it means there. */
  provider?: ProviderKind;
  pending?: boolean;
  disabled?: boolean;
  onSelect: (level: Autonomy) => void;
  placement?: Placement;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const choose = (level: Autonomy) => {
    // Reselecting the confirmed level can revoke a different pending grant.
    if (pending || level !== value) onSelect(level);
    setOpen(false);
  };

  // Arrows walk the levels and each level's number picks it.
  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (/^[1-9]$/.test(e.key)) {
      const level = AUTONOMY_LEVELS.at(Number(e.key) - 1);
      if (level) {
        e.preventDefault();
        choose(level);
      }
      return;
    }
    const options = Array.from(
      e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'),
    );
    const current = options.findIndex((option) => option === document.activeElement);
    const next = navigationIndex(e.key, current, options.length);
    if (next === null) return;
    e.preventDefault();
    options[next].focus();
  };

  const inactive = disabled || pending;
  const title = pending
    ? 'Updating autonomy…'
    : `${AUTONOMY_LABELS[value]} — ${AUTONOMY_DESCRIPTIONS[value]}`;

  const Glyph = AUTONOMY_GLYPHS[value];
  let tone = 'text-secondary hover:bg-active/60 hover:text-primary';
  if (open) tone = 'bg-active text-primary';
  else if (inactive) tone = 'cursor-not-allowed text-muted';

  return (
    <>
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
        className={`flex h-control-sm shrink-0 items-center gap-1.5 rounded-full px-2.5 text-caption transition-colors ${tone}`}
      >
        {pending ? (
          <Spinner className="size-icon-sm shrink-0 motion-safe:animate-spin-slow" />
        ) : (
          <Glyph className="size-icon-sm shrink-0" strokeWidth={GLYPH_STROKE} />
        )}
        <span>{AUTONOMY_LABELS[value]}</span>
      </button>

      <Popover
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        anchorRef={buttonRef}
        label="Autonomy"
        role="menu"
        placement={placement}
        width={320}
        onKeyDown={onMenuKey}
        className="overflow-y-auto p-1.5"
      >
        <AutonomyMenu scope={scope} value={value} provider={provider} onSelect={choose} />
      </Popover>
    </>
  );
}

// The levels with their consequences: a caption, then every level with its
// description. A check marks the active level and each row's number is its
// keyboard shortcut. Exported on its own so the content renders without
// opening the popover.
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
  return (
    <>
      <div className="flex select-none items-center justify-between gap-3 px-2 pb-1 pt-1.5">
        <span className="text-label text-muted">Autonomy</span>
        {SCOPE_CAPTIONS[scope] && (
          <span className="truncate text-caption text-muted">{SCOPE_CAPTIONS[scope]}</span>
        )}
      </div>
      {AUTONOMY_LEVELS.map((level, i) => {
        const selected = level === value;
        const Mark = AUTONOMY_GLYPHS[level];
        const consequence = selected ? autonomyConsequence(provider, level) : undefined;
        return (
          <button
            key={level}
            type="button"
            role="menuitemradio"
            aria-checked={selected}
            autoFocus={selected}
            onClick={() => {
              onSelect(level);
            }}
            onPointerMove={(e) => {
              e.currentTarget.focus({ preventScroll: true });
            }}
            className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left outline-none focus:bg-elevated dark:focus:bg-active"
          >
            <Mark
              className={`mt-0.5 size-icon-sm shrink-0 ${selected ? 'text-secondary' : 'text-muted'}`}
              strokeWidth={GLYPH_STROKE}
            />
            <span className="min-w-0 flex-1">
              <span
                className={`block ${selected ? 'text-body-strong text-primary' : 'text-body text-secondary'}`}
              >
                {AUTONOMY_LABELS[level]}
              </span>
              <span className="block text-caption text-muted">{AUTONOMY_DESCRIPTIONS[level]}</span>
              {consequence && (
                <span className="mt-1 block text-caption text-secondary">{consequence}</span>
              )}
            </span>
            {selected && (
              <Check className="mt-0.5 size-icon-sm shrink-0 text-accent" strokeWidth={2.6} />
            )}
            <span className="mt-0.5 w-3 shrink-0 text-right text-overline tabular-nums text-muted">
              {i + 1}
            </span>
          </button>
        );
      })}
    </>
  );
}
