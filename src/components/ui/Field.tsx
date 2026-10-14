import {
  createContext,
  useContext,
  useId,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
} from 'react';
import { cn } from './cn';

interface FieldContextValue {
  inputId: string;
  describedBy: string | undefined;
  invalid: boolean;
}

const FieldContext = createContext<FieldContextValue | null>(null);

interface FieldProps extends HTMLAttributes<HTMLDivElement> {
  label: string;
  /** Help under the field. */
  hint?: ReactNode;
  /** Says how to fix the value; replaces the hint and marks the field invalid. */
  error?: ReactNode;
  children: ReactNode;
}

// A label above one control and a caption below it. The control inside
// (usually <Input />) picks up its id, description and invalid state.
export function Field({ label, hint, error, className, children, ...rest }: FieldProps) {
  const inputId = useId();
  const noteId = useId();
  const note = error ?? hint;
  const invalid = error !== undefined;
  return (
    <div {...rest} className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={inputId} className="select-none text-label text-secondary">
        {label}
      </label>
      <FieldContext.Provider
        value={{ inputId, describedBy: note === undefined ? undefined : noteId, invalid }}
      >
        {children}
      </FieldContext.Provider>
      {note !== undefined && (
        <p id={noteId} className={cn('text-caption', invalid ? 'text-danger' : 'text-muted')}>
          {note}
        </p>
      )}
    </div>
  );
}

type InputVariant = 'default' | 'compact' | 'embedded';

const VARIANT: Record<InputVariant, string> = {
  default: 'h-control-lg rounded-md px-3 text-body-lg',
  compact: 'h-control-md rounded-md px-2.5 text-body',
  // A search sitting in a picker's header strip: the strip is the field, and
  // the caret shows focus, so it draws no fill and no ring of its own.
  embedded: 'bg-transparent text-body focus-visible:outline-none',
};

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  ref?: Ref<HTMLInputElement>;
  variant?: InputVariant;
  /** Outside a Field; inside one, the Field's error decides. */
  invalid?: boolean;
}

// The single-line text field: filled, never outlined. Outside a Field, give
// it an aria-label.
export function Input({ ref, variant = 'default', invalid, className, ...rest }: InputProps) {
  const field = useContext(FieldContext);
  const isInvalid = field?.invalid ?? invalid ?? false;
  let fill = 'bg-field enabled:hover:bg-active';
  if (isInvalid) fill = 'bg-danger-soft ring-1.5 ring-danger';
  else if (variant === 'embedded') fill = '';
  return (
    <input
      ref={ref}
      id={field?.inputId}
      aria-describedby={field?.describedBy}
      aria-invalid={isInvalid || undefined}
      {...rest}
      className={cn(
        'w-full min-w-0 text-primary transition-colors duration-150 ease-out placeholder:text-muted',
        'disabled:cursor-not-allowed disabled:opacity-40',
        VARIANT[variant],
        fill,
        className,
      )}
    />
  );
}
