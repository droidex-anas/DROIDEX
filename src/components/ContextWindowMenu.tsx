import { useRef, useState } from 'react';
import { Check, ChevronDown } from '@droidex/icons';
import type { ContextWindowTokens } from '../types/bridge';
import { CONTEXT_WINDOW_LABEL, type ContextWindowOption } from '../lib/contextWindow';
import { Menu } from './ui/Menu';

export default function ContextWindowMenu({
  options,
  selected,
  onSelect,
}: {
  options: ContextWindowOption[];
  /** The window the chat pinned, or undefined while it follows the provider. */
  selected: ContextWindowTokens | undefined;
  onSelect: (next: ContextWindowTokens) => void;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const providerDefault = options.find((option) => option.isProviderDefault);
  const shown = selected ?? providerDefault?.value;
  const label = options.find((o) => o.value === shown)?.label ?? 'Default';

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={CONTEXT_WINDOW_LABEL}
        title={CONTEXT_WINDOW_LABEL}
        onClick={() => {
          setOpen((v) => !v);
        }}
        className={`flex h-6 shrink-0 items-center gap-0.5 rounded-sm px-1.5 text-caption transition-colors ${
          open
            ? 'bg-elevated text-primary dark:bg-active'
            : 'text-muted hover:bg-elevated hover:text-primary dark:hover:bg-active'
        }`}
      >
        {label}
        <ChevronDown className="size-3" aria-hidden="true" />
      </button>

      <Menu
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        anchorRef={buttonRef}
        label={CONTEXT_WINDOW_LABEL}
        placement="bottom-end"
        width={200}
      >
        <Menu.Label>{CONTEXT_WINDOW_LABEL}</Menu.Label>
        {options.map((option) => {
          const on = option.value === selected;
          return (
            <Menu.Item
              key={option.value}
              role="menuitemradio"
              aria-checked={on}
              disabled={option.unavailableReason !== undefined}
              title={option.unavailableReason}
              onSelect={() => {
                onSelect(option.value);
              }}
            >
              <span className="flex size-icon-md shrink-0 items-center justify-center">
                {on && <Check className="size-icon-sm text-accent" aria-hidden="true" />}
              </span>
              <span className="flex-1">{option.label}</span>
              {option.isProviderDefault && <span className="text-caption text-muted">Default</span>}
            </Menu.Item>
          );
        })}
      </Menu>
    </>
  );
}
