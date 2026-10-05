import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check } from '@droidex/icons';
import type { BrowserViewport, BrowserViewportMode } from '../../types/bridge';
import { VIEWPORT_LABELS, viewportForMode } from './browserViewport';

const MODES = Object.keys(VIEWPORT_LABELS) as BrowserViewportMode[];

// The page's size, under the page: Fit follows the pane, a standard size lays
// the page out at that size and draws it scaled to fit. The parent places it;
// at the end of a row its menu opens from its right edge.
export function ViewportMenu({
  mode,
  fitViewport,
  onSelect,
  className,
  menuAlign = 'center',
}: {
  mode: BrowserViewportMode;
  fitViewport: BrowserViewport;
  onSelect: (mode: BrowserViewportMode) => void;
  className: string;
  menuAlign?: 'center' | 'end';
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const menuX = menuAlign === 'end' ? 0 : '-50%';
  const size = (choice: BrowserViewportMode) => {
    const { width, height } = viewportForMode(choice, fitViewport);
    return `${String(width)} × ${String(height)}`;
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    // A click on the page itself lands in its own document; it only shows
    // here as the focus moving into the page.
    const onAway = (e: Event) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onAway);
    window.addEventListener('focusin', onAway);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onAway);
      window.removeEventListener('focusin', onAway);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={className}>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Page size: ${VIEWPORT_LABELS[mode]}`}
        onClick={() => {
          setOpen((value) => !value);
        }}
        className="flex h-8 items-center gap-2 rounded-md border border-droid-border bg-droid-bg/90 px-2.5 text-[11px] text-droid-text-muted shadow-droid-sm transition-colors hover:text-droid-text-secondary"
      >
        <span className="tabular-nums text-droid-text-secondary">{size(mode)}</span>
        <span>{VIEWPORT_LABELS[mode]}</span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            aria-label="Page size"
            onKeyDown={(e) => {
              // Tab leaves the menu where it was going; only the menu closes.
              if (e.key === 'Tab') {
                setOpen(false);
                return;
              }
              if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
              e.preventDefault();
              const options = optionRefs.current.filter((el): el is HTMLButtonElement => !!el);
              const index = options.indexOf(document.activeElement as HTMLButtonElement);
              const step = e.key === 'ArrowDown' ? 1 : options.length - 1;
              options[(index + step) % options.length]?.focus();
            }}
            initial={{ opacity: 0, x: menuX, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, x: menuX, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: menuX, y: 8, scale: 0.98 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            className={`absolute bottom-full z-50 mb-2 w-[220px] overflow-hidden rounded-2xl border border-droid-border/60 bg-droid-raised p-1.5 shadow-droid ${
              menuAlign === 'end' ? 'right-0' : 'left-1/2'
            }`}
          >
            {MODES.map((choice, index) => {
              const selected = choice === mode;
              return (
                <button
                  key={choice}
                  ref={(el) => {
                    optionRefs.current[index] = el;
                  }}
                  type="button"
                  role="menuitemradio"
                  tabIndex={-1}
                  aria-checked={selected}
                  autoFocus={selected}
                  onClick={() => {
                    setOpen(false);
                    buttonRef.current?.focus();
                    if (!selected) onSelect(choice);
                  }}
                  className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors ${
                    selected ? 'bg-droid-surface' : 'hover:bg-droid-surface/60'
                  }`}
                >
                  <span
                    className={`flex-1 text-[13px] ${
                      selected ? 'font-medium text-droid-text' : 'text-droid-text-secondary'
                    }`}
                  >
                    {VIEWPORT_LABELS[choice]}
                  </span>
                  <span className="text-[11px] tabular-nums text-droid-text-muted">
                    {size(choice)}
                  </span>
                  <Check
                    className={`h-3.5 w-3.5 shrink-0 text-droid-accent ${selected ? '' : 'invisible'}`}
                    strokeWidth={2.6}
                  />
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
