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

type InputVariant = 'default' | 'compact' | 'embedded' | 'inline';

const VARIANT: Record<InputVariant, string> = {
  default: 'h-control-lg rounded-md px-3 text-body-lg',
  compact: 'h-control-md rounded-md px-2.5 text-body',
  // A search sitting in a picker's header strip: the strip is the field, and
  // the caret shows focus, so it draws no fill and no ring of its own.
  embedded: 'bg-transparent text-body focus-visible:outline-none',
  // Text edited where it reads: the box of the text it replaces, in the type
  // the caller sets, so nothing moves as editing starts or ends.
  inline: '-mx-1 rounded-sm px-1',
};

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  ref?: Ref<HTMLInputElement>;
  variant?: InputVariant;
  /** Outside a Field; inside one, the Field's error decides. */
  invalid?: boolean;
  /** Fixed content before the value, such as the `@` of a username or a colour swatch. */
  leading?: ReactNode;
  /** Fixed content after the value, such as the unit of a number. */
  trailing?: ReactNode;
  /** Controls at the field's end, such as a picker button; unlike the affixes, assistive tech reaches them. */
  actions?: ReactNode;
}

function inputFill(invalid: boolean, variant: InputVariant) {
  if (invalid) return 'bg-danger-soft ring-1.5 ring-danger';
  return variant === 'embedded' ? '' : 'bg-field';
}

// The single-line text field: filled, never outlined. Outside a Field, give
// it an aria-label.
export function Input({
  ref,
  variant = 'default',
  invalid,
  leading,
  trailing,
  actions,
  className,
  ...rest
}: InputProps) {
  const field = useContext(FieldContext);
  const isInvalid = field?.invalid ?? invalid ?? false;
  const fill = inputFill(isInvalid, variant);
  const hovers = fill === 'bg-field';
  const hasAffix = [leading, trailing, actions].some((part) => part !== undefined);
  const width = variant === 'inline' ? 'field-sizing-content' : 'w-full';
  const input = (
    <input
      ref={ref}
      id={field?.inputId}
      aria-describedby={field?.describedBy}
      aria-invalid={isInvalid || undefined}
      {...rest}
      className={
        !hasAffix
          ? cn(
              width,
              'min-w-0 text-primary transition-colors duration-150 ease-out placeholder:text-muted disabled:cursor-not-allowed disabled:opacity-40',
              VARIANT[variant],
              fill,
              hovers && 'enabled:hover:bg-active',
              className,
            )
          : cn(
              width,
              'h-full min-w-0 bg-transparent text-primary placeholder:text-muted focus-visible:outline-none disabled:cursor-not-allowed',
            )
      }
    />
  );
  if (!hasAffix) return input;
  // Affixes sit in the same line box as the value, so they share one
  // baseline at every size. The label wrapper lets a click on them focus the
  // input; index.css draws the focus ring on the wrapper.
  return (
    <label
      className={cn(
        'field-affix flex cursor-text items-center transition-colors duration-150 ease-out',
        VARIANT[variant],
        fill,
        hovers && !rest.disabled && 'hover:bg-active',
        rest.disabled && 'cursor-not-allowed opacity-40',
        className,
      )}
    >
      <Affix>{leading}</Affix>
      {input}
      <Affix className={variant === 'inline' ? 'pl-0.5' : 'pl-1'}>{trailing}</Affix>
      <Actions>{actions}</Actions>
    </label>
  );
}

function Actions({ children }: { children: ReactNode }) {
  if (children === undefined) return null;
  return <span className="flex shrink-0 items-center gap-0.5 pl-1">{children}</span>;
}

function Affix({ className, children }: { className?: string; children: ReactNode }) {
  if (children === undefined) return null;
  return (
    <span aria-hidden="true" className={cn('shrink-0 select-none text-muted', className)}>
      {children}
    </span>
  );
}
