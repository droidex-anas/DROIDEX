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
import { Menu } from './ui/Menu';

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

  // Each level's number picks it; Menu owns the arrows and type-ahead.
  const pickByNumber = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!/^[1-9]$/.test(e.key)) return;
    const level = AUTONOMY_LEVELS.at(Number(e.key) - 1);
    if (!level) return;
    e.preventDefault();
    choose(level);
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

      <Menu
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        anchorRef={buttonRef}
        label="Autonomy"
        placement={placement}
        width={320}
        onKeyDown={pickByNumber}
      >
        <Menu.Label className="flex items-center justify-between gap-3">
          <span>Autonomy</span>
          {SCOPE_CAPTIONS[scope] && (
            <span className="truncate text-caption text-muted">{SCOPE_CAPTIONS[scope]}</span>
          )}
        </Menu.Label>
        {AUTONOMY_LEVELS.map((level, i) => (
          <Menu.Item
            key={level}
            role="menuitemradio"
            aria-checked={level === value}
            onSelect={() => {
              choose(level);
            }}
          >
            <AutonomyRow
              level={level}
              number={i + 1}
              selected={level === value}
              provider={provider}
            />
          </Menu.Item>
        ))}
      </Menu>
    </>
  );
}

// One level with its description; the chosen one also says what it means on
// this harness. A check marks it, and the number is the row's shortcut.
function AutonomyRow({
  level,
  number,
  selected,
  provider,
}: {
  level: Autonomy;
  number: number;
  selected: boolean;
  provider?: ProviderKind;
}) {
  const Mark = AUTONOMY_GLYPHS[level];
  const consequence = selected ? autonomyConsequence(provider, level) : undefined;
  return (
    <span className="flex min-w-0 flex-1 items-start gap-2">
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
      {selected && <Check className="mt-0.5 size-icon-sm shrink-0 text-accent" strokeWidth={2.6} />}
      <span className="mt-0.5 w-3 shrink-0 text-right text-overline tabular-nums text-muted">
        {number}
      </span>
    </span>
  );
}
