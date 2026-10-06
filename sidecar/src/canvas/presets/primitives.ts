// Shared behavior is copied into each immutable kit, not imported from the host.
export const PRIMITIVES_TSX = `import { useEffect, useId, useRef } from 'react';
import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'quiet';
}

const BUTTON_VARIANTS = {
  primary: 'ds-button-primary',
  secondary: 'ds-button-secondary',
  quiet: 'ds-button-quiet',
};

export function Button({
  variant = 'primary',
  className = '',
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={['ds-button', BUTTON_VARIANTS[variant], className].join(' ')}
      {...props}
    />
  );
}

export function Card({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={['ds-card p-6', className].join(' ')} {...props} />;
}

export function Badge({ className = '', ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span className={['ds-badge', className].join(' ')} {...props} />;
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string;
}

export function Input({ label, hint, error, id, className = '', ...props }: InputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const descriptionId = inputId + '-description';
  const description = error || hint;
  const describedBy = [props['aria-describedby'], description ? descriptionId : null]
    .filter(Boolean)
    .join(' ');
  return (
    <div className="ds-field">
      <label htmlFor={inputId}>{label}</label>
      <input
        {...props}
        id={inputId}
        className={['ds-input', className].join(' ')}
        aria-describedby={describedBy || undefined}
        aria-invalid={error ? true : props['aria-invalid']}
      />
      {description ? (
        <p id={descriptionId} className={error ? 'ds-error' : 'ds-hint'}>
          {description}
        </p>
      ) : null}
    </div>
  );
}

export interface TabItem {
  value: string;
  label: string;
  content: ReactNode;
  disabled?: boolean;
}

export interface TabsProps {
  label: string;
  items: TabItem[];
  value: string;
  onValueChange: (value: string) => void;
}

export function Tabs({ label, items, value, onValueChange }: TabsProps) {
  const id = useId();
  return (
    <div className="ds-tabs">
      <div role="tablist" aria-label={label} className="ds-tablist">
        {items.map((item, index) => (
          <button
            key={item.value}
            type="button"
            role="tab"
            id={id + '-tab-' + index}
            aria-controls={id + '-panel-' + index}
            aria-selected={value === item.value}
            disabled={item.disabled}
            tabIndex={value === item.value ? 0 : -1}
            className="ds-tab"
            onClick={() => onValueChange(item.value)}
            onKeyDown={(event) => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              const enabled = items
                .map((tab, i) => ({ tab, i }))
                .filter(({ tab }) => !tab.disabled);
              const current = enabled.findIndex(({ i }) => i === index);
              let next = current;
              if (event.key === 'Home') next = 0;
              if (event.key === 'End') next = enabled.length - 1;
              if (event.key === 'ArrowRight') next = (current + 1) % enabled.length;
              if (event.key === 'ArrowLeft') next = (current - 1 + enabled.length) % enabled.length;
              const target = enabled[next];
              if (!target) return;
              document.getElementById(id + '-tab-' + target.i)?.focus();
              onValueChange(target.tab.value);
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      {items.map((item, index) => (
        <div
          key={item.value}
          role="tabpanel"
          id={id + '-panel-' + index}
          aria-labelledby={id + '-tab-' + index}
          hidden={value !== item.value}
          tabIndex={0}
          className="ds-tabpanel"
        >
          {item.content}
        </div>
      ))}
    </div>
  );
}

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

export function Dialog({ open, onClose, title, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;
    const previous = document.activeElement;
    // Native modal behavior owns focus containment, inert background and Escape.
    dialog.showModal();
    return () => {
      dialog.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className="ds-dialog"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="ds-dialog-header">
        <h2 id={titleId}>{title}</h2>
        <Button variant="quiet" onClick={onClose} aria-label="Close dialog">
          Close
        </Button>
      </div>
      {children}
    </dialog>
  );
}
`;
