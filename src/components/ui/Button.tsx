import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { Spinner, type IconComponent } from '@droidex/icons';
import { cn } from './cn';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
type ButtonSize = 'sm' | 'md' | 'lg';

// Hover states only apply while enabled, so a disabled button stays still.
// A ghost toggle that is on (pressed, its menu open, or `data-selected`)
// brightens its icon instead of taking a fill; a pressed secondary toggle
// (one chip of a choice group) takes the `active` fill.
const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-text text-bg enabled:hover:opacity-90',
  secondary:
    'bg-elevated text-secondary enabled:hover:bg-active enabled:hover:text-primary aria-pressed:bg-active aria-pressed:text-primary',
  ghost:
    'text-muted enabled:hover:bg-elevated enabled:hover:text-secondary enabled:aria-pressed:text-primary enabled:aria-expanded:text-primary enabled:data-[selected]:text-primary',
  danger: 'bg-danger-soft text-danger enabled:hover:bg-danger enabled:hover:text-bg',
  success: 'bg-success-soft text-success enabled:hover:bg-success enabled:hover:text-bg',
};

const SIZE: Record<ButtonSize, { text: string; square: string }> = {
  sm: { text: 'h-control-sm min-w-16 px-2.5 text-label', square: 'size-control-sm' },
  md: { text: 'h-control-md min-w-16 px-3 text-body-strong', square: 'size-control-md' },
  lg: { text: 'h-control-lg min-w-16 px-3 text-body-strong', square: 'size-control-lg' },
};

interface ButtonBaseProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  ref?: Ref<HTMLButtonElement>;
  variant?: ButtonVariant;
  size?: ButtonSize;
  shape?: 'default' | 'round';
  /** Swaps the icon (or the label) for a spinner and keeps the button's width. */
  loading?: boolean;
}

// Icon-only buttons have no visible label, so they must name themselves.
type ButtonProps = ButtonBaseProps &
  (
    | { children: ReactNode; icon?: IconComponent }
    | { children?: undefined; icon: IconComponent; 'aria-label': string }
  );

export function Button({
  ref,
  variant = 'secondary',
  size = 'md',
  shape = 'default',
  loading = false,
  icon: Icon,
  type = 'button',
  className,
  children,
  ...rest
}: ButtonProps) {
  const iconOnly = children === undefined;
  const spinner = <Spinner className="size-icon-md shrink-0 animate-spin" aria-hidden="true" />;
  // Without an icon to swap, the label stays in place (invisible) to hold the width.
  const labelHidden = loading && !Icon;
  return (
    <button
      ref={ref}
      type={type}
      aria-busy={loading || undefined}
      data-loading={loading || undefined}
      {...rest}
      className={cn(
        'relative inline-flex shrink-0 select-none items-center justify-center gap-1.5 transition duration-150 ease-out',
        'enabled:active:scale-97 enabled:active:duration-75 disabled:cursor-not-allowed disabled:opacity-40',
        shape === 'round' ? 'rounded-full' : 'rounded-md',
        iconOnly ? SIZE[size].square : SIZE[size].text,
        VARIANT[variant],
        className,
      )}
    >
      {Icon && (loading ? spinner : <Icon className="size-icon-md shrink-0" aria-hidden="true" />)}
      {children !== undefined && (
        <span className={cn('truncate', labelHidden && 'invisible')}>{children}</span>
      )}
      {labelHidden && <span className="absolute inset-0 grid place-items-center">{spinner}</span>}
    </button>
  );
}
