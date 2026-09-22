import { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, SlidersHorizontal } from 'lucide-react';

export type ModelCategory = 'core' | 'factory' | 'claude' | 'custom';

const CATEGORY_LABEL: Record<ModelCategory, string> = {
  core: 'Droid core',
  factory: 'Factory',
  claude: 'Claude',
  custom: 'Custom',
};

const ACCENT = 'var(--droid-accent)';
const accentMix = (pct: number) =>
  `color-mix(in srgb, var(--droid-accent) ${String(pct)}%, transparent)`;

// The model popover's category filter: a button inside the search bar that
// opens the catalog counts per category. Controlled — the popover owns open
// state so its global arrow-key handler can yield while the dropdown is up;
// the filter owns its outside-click dismissal.
export default function ModelCategoryFilter({
  cat,
  total,
  counts,
  open,
  onOpenChange,
  onSelect,
}: {
  cat: ModelCategory | 'all';
  total: number;
  counts: Record<ModelCategory, number>;
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

  const active = open || cat !== 'all';
  const options: { value: ModelCategory | 'all'; label: string; count: number }[] = [
    { value: 'all', label: 'All models', count: total },
    ...(['core', 'factory', 'claude', 'custom'] as const satisfies readonly ModelCategory[]).map(
      (value) => ({ value, label: CATEGORY_LABEL[value], count: counts[value] }),
    ),
  ];

  return (
    <div className="relative shrink-0" ref={rootRef}>
      <button
        onClick={() => {
          onOpenChange(!open);
        }}
        title="Filter models by category"
        aria-expanded={open}
        className={`grid h-6 w-6 place-items-center rounded-md transition-colors ${
          active ? 'text-droid-text' : 'text-droid-text-muted hover:text-droid-text'
        }`}
        style={
          active
            ? {
                backgroundColor: accentMix(13),
                boxShadow: `inset 0 0 0 1px ${accentMix(40)}`,
              }
            : undefined
        }
      >
        <SlidersHorizontal className="w-3.5 h-3.5" />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
            className="absolute right-0 top-full mt-1.5 w-44 z-50 rounded-xl border border-droid-border bg-droid-elevated shadow-md overflow-hidden p-1"
          >
            {options.map((opt) => {
              const on = cat === opt.value;
              return (
                <button
                  key={opt.value}
                  onClick={() => {
                    onSelect(opt.value);
                    onOpenChange(false);
                  }}
                  className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left text-[12px] transition-colors ${
                    on
                      ? 'bg-droid-surface text-droid-text'
                      : 'text-droid-text-secondary hover:bg-droid-surface/60'
                  }`}
                >
                  <span className="w-3.5 h-3.5 shrink-0 flex items-center justify-center">
                    {on && (
                      <Check className="w-3 h-3" style={{ color: ACCENT }} strokeWidth={3.5} />
                    )}
                  </span>
                  <span className="flex-1">{opt.label}</span>
                  <span className="text-[11px] text-droid-text-muted">{opt.count}</span>
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
