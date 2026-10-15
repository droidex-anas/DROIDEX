// Shared layout primitives and controls for settings sections (SettingsPanel
// and the feature settings screens import these; keep them free of feature
// state).

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Check, ChevronDown } from '@droidex/icons';
import { Popover } from './ui/Popover';

export function SectionTitle({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-6">
      <h2 className="text-title text-primary">{title}</h2>
      {sub && <p className="mt-1 text-body text-muted">{sub}</p>}
    </div>
  );
}

export function GroupLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-2 mt-1 select-none text-label text-muted">{children}</div>;
}

/* ── settings row: label + description on the left, control on the right ── */
export function SettingRow({
  label,
  description,
  children,
}: {
  label: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <div className="min-w-0">
        <div className="text-body text-primary">{label}</div>
        {description && <div className="mt-0.5 text-caption text-muted">{description}</div>}
      </div>
      {children}
    </div>
  );
}

/* ── generic in-app dropdown (replaces native <select>) ── */
export interface DropdownOption {
  value: string;
  label: string;
  icon?: React.ReactNode;
}

export function Dropdown({
  value,
  options,
  onChange,
  ariaLabel,
  placeholder = 'Select…',
  triggerIcon,
  width = 'w-44',
  align = 'right',
}: {
  value: string;
  options: DropdownOption[];
  onChange: (v: string) => void;
  /** Accessible name for the listbox popup (usually the field's label). */
  ariaLabel: string;
  placeholder?: string;
  triggerIcon?: React.ReactNode;
  width?: string;
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const [minWidth, setMinWidth] = useState<number>();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const close = () => {
    setOpen(false);
  };

  // A listbox opens with focus on the selected option.
  useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    const selected =
      list?.querySelector<HTMLElement>('[role="option"][aria-selected="true"]') ??
      list?.querySelector<HTMLElement>('[role="option"]');
    if (!list || !selected) return;
    selected.focus({ preventScroll: true });
    // The popover's position pass sizes the list after this effect runs, so
    // reveal the selected option whenever the list's box settles.
    const observer = new ResizeObserver(() => {
      selected.scrollIntoView({ block: 'nearest' });
    });
    observer.observe(list);
    return () => {
      observer.disconnect();
    };
  }, [open]);

  const onListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const items = Array.from(
      listRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [],
    );
    if (items.length === 0) return;
    event.preventDefault();
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next =
      event.key === 'ArrowDown'
        ? items.at((index + 1) % items.length)
        : items.at((index - 1 + items.length) % items.length);
    next?.focus();
  };

  const sel = options.find((o) => o.value === value);

  return (
    <div className={width === 'w-full' ? 'w-full' : 'shrink-0'}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          setMinWidth(triggerRef.current?.offsetWidth);
          setOpen((v) => !v);
        }}
        className={`${width} flex h-control-md select-none items-center justify-between gap-2 rounded-md px-3 text-body text-primary transition-colors duration-150 ease-out ${
          open ? 'bg-active' : 'bg-elevated hover:bg-active'
        }`}
      >
        <span className="flex min-w-0 items-center gap-2">
          {triggerIcon ?? sel?.icon}
          <span className="truncate">{sel?.label ?? placeholder}</span>
        </span>
        <ChevronDown
          aria-hidden="true"
          className={`size-icon-sm shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      <Popover
        open={open}
        onClose={close}
        anchorRef={triggerRef}
        label={ariaLabel}
        placement={align === 'right' ? 'bottom-end' : 'bottom-start'}
        style={{ minWidth }}
        className="max-w-80"
      >
        <div
          ref={listRef}
          role="listbox"
          aria-label={ariaLabel}
          onKeyDown={onListKeyDown}
          className="min-h-0 overflow-y-auto p-1.5"
        >
          {options.map((o) => {
            const active = o.value === value;
            return (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  onChange(o.value);
                  close();
                }}
                className={`flex w-full select-none items-center gap-2 rounded-md px-2 py-1.5 text-left text-body text-primary ${
                  active ? 'bg-active' : 'hover:bg-elevated dark:hover:bg-active'
                }`}
              >
                {o.icon}
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                {active && (
                  <Check aria-hidden="true" className="size-icon-sm shrink-0 text-accent" />
                )}
              </button>
            );
          })}
        </div>
      </Popover>
    </div>
  );
}
