import type { HTMLAttributes, ReactNode, Ref } from 'react';
import { ChevronDown } from '@droidex/icons';
import { cn } from './cn';

// One row language for side panels and lists (components/PanelRow.md). Put
// rows in a container with a `px-2` gutter: the row's `px-3` then puts icons,
// labels and headers on the 20px content edge (rules.md, "Alignment").

interface RowBaseProps extends Omit<HTMLAttributes<HTMLElement>, 'onClick'> {
  ref?: Ref<HTMLButtonElement>;
  /** A 16px icon. Pass `null` to keep the empty icon column, so labels line up
   *  with rows that have one. */
  icon?: ReactNode;
  label: ReactNode;
  /** Short trailing meta: a count, a timestamp, a state. */
  meta?: ReactNode;
  /** Anything after the meta, such as a caret. */
  trailing?: ReactNode;
}

// Without an action the row is a readout, not a control, so it has no
// selected or disabled state.
type RowProps = RowBaseProps &
  (
    | { onClick: () => void; active?: boolean; disabled?: boolean }
    | { onClick?: undefined; active?: never; disabled?: never }
  );

export function Row({
  ref,
  icon,
  label,
  meta,
  trailing,
  active = false,
  disabled = false,
  onClick,
  className,
  ...rest
}: RowProps) {
  const content = (
    <>
      {icon !== undefined && (
        <span className="flex size-icon-md shrink-0 items-center justify-center text-muted transition-colors group-hover:text-secondary">
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate text-body text-primary">{label}</span>
      {meta !== undefined && (
        <span className="shrink-0 text-caption tabular-nums text-muted">{meta}</span>
      )}
      {trailing}
    </>
  );
  const layout = 'flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left';
  if (!onClick) {
    return (
      <div {...rest} className={cn(layout, className)}>
        {content}
      </div>
    );
  }
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled}
      data-active={active || undefined}
      {...rest}
      onClick={onClick}
      className={cn(
        layout,
        'group cursor-default select-none transition-colors duration-150 ease-out disabled:cursor-not-allowed disabled:opacity-40',
        active ? 'bg-active' : 'enabled:hover:bg-elevated',
        className,
      )}
    >
      {content}
    </button>
  );
}

interface SectionHeaderProps extends HTMLAttributes<HTMLDivElement> {
  label: ReactNode;
  /** A trailing caption, aligned on the label's baseline. */
  trailing?: ReactNode;
}

export function SectionHeader({ label, trailing, className, ...rest }: SectionHeaderProps) {
  return (
    <div
      {...rest}
      className={cn(
        'flex select-none items-baseline justify-between gap-2 px-3 pb-1 pt-4',
        className,
      )}
    >
      <span className="min-w-0 truncate text-label text-muted">{label}</span>
      {trailing !== undefined && (
        <span className="shrink-0 text-caption tabular-nums text-muted">{trailing}</span>
      )}
    </div>
  );
}

// The only line in the system: a translucent hairline between groups.
export function Divider({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div role="separator" {...rest} className={cn('mx-3 my-1.5 h-px bg-divider', className)} />
  );
}

// The disclosure caret expandable rows carry on their trailing edge, so every
// fold rotates and dims identically.
export function RowCaret({ open }: { open: boolean }) {
  return (
    <ChevronDown
      aria-hidden="true"
      className={cn(
        'size-icon-sm shrink-0 text-muted/60 transition-transform duration-150 ease-out',
        open && 'rotate-180',
      )}
    />
  );
}
