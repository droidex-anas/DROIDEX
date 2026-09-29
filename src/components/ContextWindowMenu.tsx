import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown } from 'lucide-react';
import type { ContextWindowTokens } from '../types/bridge';
import { CONTEXT_WINDOW_LABEL, type ContextWindowOption } from '../lib/contextWindow';

const MENU_WIDTH_PX = 176;
const GAP_PX = 6;
const EDGE_PX = 8;

/**
 * The window a Claude chat runs on, as a quiet text button beside the model's
 * name in the effort popover. The list floats in a portal because the popover
 * card clips its own overflow, and it names the provider's own window so a
 * chat that pins none still reads as deliberate.
 */
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
  const [place, setPlace] = useState<{ left: number; top: number }>();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
    };
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  useLayoutEffect(() => {
    const button = buttonRef.current;
    if (!open || !button) return;
    const rect = button.getBoundingClientRect();
    // Hung from the button's right edge, so the list stays inside the popover.
    setPlace({
      left: Math.max(
        EDGE_PX,
        Math.min(rect.right - MENU_WIDTH_PX, window.innerWidth - MENU_WIDTH_PX - EDGE_PX),
      ),
      top: rect.bottom + GAP_PX,
    });
  }, [open]);

  const providerDefault = options.find((option) => option.isProviderDefault);
  const shown = selected ?? providerDefault?.value;
  const label =
    shown === undefined ? 'Default' : (options.find((o) => o.value === shown)?.label ?? 'Default');

  // The menu opens on the window in use, or the first that can be picked, and
  // the arrow keys walk the ones that can.
  const choosable = options.filter((option) => option.unavailableReason === undefined);
  const openOn = choosable.find((option) => option.value === shown) ?? choosable[0];
  const onMenuKey = (e: React.KeyboardEvent) => {
    // Tab leaves the list from its button, so focus moves on from there.
    if (e.key === 'Tab') {
      setOpen(false);
      buttonRef.current?.focus();
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = [
      ...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]:enabled') ??
        []),
    ];
    if (items.length === 0) return;
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const step = e.key === 'ArrowDown' ? 1 : items.length - 1;
    items[(Math.max(index, 0) + step) % items.length].focus();
  };

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
        className={`flex h-6 shrink-0 items-center gap-0.5 rounded-md px-1.5 text-[11px] transition-colors ${
          open
            ? 'bg-droid-surface text-droid-text'
            : 'text-droid-text-muted hover:bg-droid-surface/60 hover:text-droid-text'
        }`}
      >
        {label}
        <ChevronDown className="h-3 w-3" />
      </button>

      {createPortal(
        <AnimatePresence>
          {open && place && (
            <motion.div
              ref={menuRef}
              role="menu"
              aria-label={CONTEXT_WINDOW_LABEL}
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
              data-popover-layer="context-window"
              onKeyDown={onMenuKey}
              style={{ ...place, width: MENU_WIDTH_PX }}
              className="fixed z-[200] overflow-hidden rounded-xl border border-droid-border/60 bg-droid-raised p-1 shadow-droid"
            >
              <div className="px-2 pt-1 pb-1.5 text-[11px] font-medium text-droid-text-muted">
                {CONTEXT_WINDOW_LABEL}
              </div>
              {options.map((option) => {
                const on = option.value === selected;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="menuitemradio"
                    aria-checked={on}
                    disabled={option.unavailableReason !== undefined}
                    title={option.unavailableReason}
                    autoFocus={option === openOn}
                    onClick={() => {
                      onSelect(option.value);
                      setOpen(false);
                      buttonRef.current?.focus();
                    }}
                    className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                      on
                        ? 'bg-droid-surface text-droid-text'
                        : 'text-droid-text-secondary enabled:hover:bg-droid-surface/60'
                    }`}
                  >
                    <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                      {on && <Check className="h-3 w-3 text-droid-accent" strokeWidth={3} />}
                    </span>
                    <span className="flex-1">{option.label}</span>
                    {option.isProviderDefault && (
                      <span className="text-[11px] text-droid-text-muted">Default</span>
                    )}
                  </button>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}
