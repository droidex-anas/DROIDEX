import type { HTMLAttributes, ReactNode, Ref } from 'react';
import type { IconComponent } from '@droidex/icons';
import { cn } from './cn';

type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger';

const TONE: Record<BadgeTone, string> = {
  neutral: 'bg-elevated text-secondary',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
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
