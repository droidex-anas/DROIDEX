import { motion } from 'framer-motion';
import { useState } from 'react';
import { cn } from '../../src/components/ui/cn';

const CODE_LENGTH = 6;

/**
 * A six-digit authenticator code shown as separate cells. One real input sits
 * over the cells, so typing, pasting and the phone's one-time-code autofill all
 * behave like a normal text field.
 */
export function CodeField({
  value,
  onChange,
  onComplete,
  busy,
  invalid,
}: {
  value: string;
  onChange: (value: string) => void;
  onComplete: (code: string) => void;
  busy: boolean;
  invalid: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const activeIndex = Math.min(value.length, CODE_LENGTH - 1);
  return (
    <motion.div
      className="relative"
      animate={invalid ? { x: [0, -6, 6, -3, 3, 0] } : { x: 0 }}
      transition={{ duration: 0.32 }}
    >
      <input
        aria-label="Authenticator code"
        aria-invalid={invalid || undefined}
        value={value}
        // Read-only rather than disabled keeps focus, so a rejected code can be retyped at once.
        readOnly={busy}
        aria-busy={busy || undefined}
        autoFocus
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        // The cells draw focus, so the invisible input draws none.
        className="absolute inset-0 size-full cursor-text opacity-0 focus-visible:outline-none"
        onFocus={() => {
          setFocused(true);
        }}
        onBlur={() => {
          setFocused(false);
        }}
        onChange={(event) => {
          const digits = event.target.value.replace(/\D/g, '').slice(0, CODE_LENGTH);
          onChange(digits);
          if (digits.length === CODE_LENGTH) onComplete(digits);
        }}
      />
      <div aria-hidden="true" className="pointer-events-none grid grid-cols-6 gap-2">
        {Array.from({ length: CODE_LENGTH }, (_, index) => {
          const digit = value[index] ?? '';
          const active = focused && !busy && index === activeIndex;
          return (
            <span
              key={index}
              className={cn(
                'grid h-14 place-items-center rounded-lg font-mono text-title tabular-nums text-primary transition duration-150 ease-out',
                active ? 'bg-active ring-1.5 ring-focus-ring' : 'bg-field',
                invalid && !active && 'bg-danger-soft',
                busy && 'opacity-60',
              )}
            >
              {digit}
              {active && !digit && (
                <span className="h-6 w-0.5 rounded-full bg-text motion-safe:animate-pulse" />
              )}
            </span>
          );
        })}
      </div>
    </motion.div>
  );
}
