import type { HTMLAttributes, ReactNode, Ref } from 'react';
import type { IconComponent } from '@droidex/icons';
import { cn } from './cn';

type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'accent';

const TONE: Record<BadgeTone, string> = {
  neutral: 'bg-elevated text-secondary',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  accent: 'bg-accent/15 text-accent',
};

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  ref?: Ref<HTMLSpanElement>;
  tone?: BadgeTone;
  /** A 12px icon, for the states people scan for. */
  icon?: IconComponent;
  /** Always a word: colour never carries the state alone. */
  children: ReactNode;
}

export function Badge({
  ref,
  tone = 'neutral',
  icon: Icon,
  className,
  children,
  ...rest
}: BadgeProps) {
  return (
    <span
      ref={ref}
      {...rest}
      className={cn(
        'inline-flex h-5 shrink-0 select-none items-center gap-1 whitespace-nowrap rounded-full px-2 text-caption font-medium',
        TONE[tone],
        className,
      )}
    >
      {Icon && <Icon className="size-3 shrink-0" aria-hidden="true" />}
      {children}
    </span>
  );
}

type CountBadgeTone = 'subtle' | 'recessed' | 'active';
type CountBadgeSize = 'sm' | 'md';

const COUNT_TONE: Record<CountBadgeTone, string> = {
  subtle: 'bg-elevated text-secondary',
  recessed: 'bg-surface text-muted',
  active: 'bg-surface text-primary',
};

const COUNT_SIZE: Record<CountBadgeSize, string> = {
  sm: 'h-4 min-w-4 px-1',
  md: 'h-5 min-w-5 px-1.5',
};

interface CountBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  ref?: Ref<HTMLSpanElement>;
  tone?: CountBadgeTone;
  size?: CountBadgeSize;
  children: ReactNode;
}

/** Symmetrical numeric chip for section headers, filter tabs, and collapsed groups. */
export function CountBadge({
  ref,
  tone = 'subtle',
  size = 'md',
  className,
  children,
  ...rest
}: CountBadgeProps) {
  return (
    <span
      ref={ref}
      {...rest}
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center rounded-full text-caption font-medium tabular-nums',
        COUNT_SIZE[size],
        COUNT_TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
