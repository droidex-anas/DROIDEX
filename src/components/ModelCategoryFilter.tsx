import { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ListFilter } from 'lucide-react';
import type { CategoryOption, ModelCategory } from './modelCategories';

const ACCENT = 'var(--droid-accent)';

// The model popover's category filter: a button beside the search bar that
// opens the catalog counts per category. Controlled — the popover owns open
// state so its global arrow-key handler can yield while the dropdown is up;
// the filter owns its outside-click dismissal.
export default function ModelCategoryFilter({
  options,
  selected,
  open,
  onOpenChange,
  onSelect,
}: {
  options: CategoryOption[];
  selected: ModelCategory | 'all';
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (next: ModelCategory | 'all') => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onOpenChange(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('mousedown', onDown);
    };
  }, [open, onOpenChange]);

  const filtered = selected !== 'all';

  return (
    <div className="relative shrink-0" ref={rootRef}>
      <button
        type="button"
        onClick={() => {
          onOpenChange(!open);
        }}
        aria-label="Filter models by category"
        title="Filter models by category"
        aria-expanded={open}
        className={`relative flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
          open
            ? 'bg-droid-surface text-droid-text'
            : 'bg-droid-bg/50 hover:bg-droid-surface/60 hover:text-droid-text'
        } ${filtered ? 'text-droid-text' : 'text-droid-text-muted'}`}
      >
        <ListFilter className="h-4 w-4" strokeWidth={1.5} />
        {filtered && (
          <span
            className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: ACCENT }}
          />
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
            className="absolute right-0 top-full z-50 mt-1.5 w-44 overflow-hidden rounded-xl border border-droid-border bg-droid-raised p-1 shadow-md"
          >
            {options.map((option) => {
              const on = option.value === selected;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    onSelect(option.value);
                    onOpenChange(false);
                  }}
                  className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12px] transition-colors ${
                    on
                      ? 'bg-droid-surface text-droid-text'
                      : 'text-droid-text-secondary hover:bg-droid-surface/60'
                  }`}
                >
                  <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                    {on && (
                      <Check className="h-3 w-3" style={{ color: ACCENT }} strokeWidth={3.5} />
                    )}
                  </span>
                  <span className="flex-1">{option.label}</span>
                  <span className="text-[11px] tabular-nums text-droid-text-muted">
                    {option.count}
                  </span>
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
