import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check } from '@droidex/icons';
import type { BrowserViewport, BrowserViewportMode } from '../../types/bridge';
import { VIEWPORT_LABELS, viewportForMode } from './browserViewport';

const MODES = Object.keys(VIEWPORT_LABELS) as BrowserViewportMode[];

// The page's size, under the page: Fit follows the pane, a standard size lays
// the page out at that size and draws it scaled to fit.
export function ViewportMenu({
  mode,
  fitViewport,
  onSelect,
}: {
  mode: BrowserViewportMode;
  fitViewport: BrowserViewport;
  onSelect: (mode: BrowserViewportMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
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

  return (
    <div ref={rootRef} className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Page size: ${VIEWPORT_LABELS[mode]}`}
        onClick={() => {
          setOpen((value) => !value);
        }}
        className="flex items-center gap-2 rounded-md border border-droid-border bg-droid-bg/90 px-2.5 py-1.5 text-[11px] text-droid-text-muted shadow-lg transition-colors hover:text-droid-text-secondary"
      >
        <span className="tabular-nums text-droid-text-secondary">{size(mode)}</span>
        <span>{VIEWPORT_LABELS[mode]}</span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            aria-label="Page size"
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            className="absolute bottom-full left-1/2 z-50 mb-2 w-[220px] -translate-x-1/2 overflow-hidden rounded-2xl border border-droid-border/60 bg-droid-raised p-1.5 shadow-droid"
          >
            {MODES.map((choice) => {
              const selected = choice === mode;
              return (
                <button
                  key={choice}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selected}
                  autoFocus={selected}
                  onClick={() => {
                    setOpen(false);
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
