import { motion } from 'framer-motion';
import { useState } from 'react';

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
        className="absolute inset-0 h-full w-full cursor-text rounded-xl text-[16px] opacity-0"
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
      <div aria-hidden className="pointer-events-none grid grid-cols-6 gap-2">
        {Array.from({ length: CODE_LENGTH }, (_, index) => {
          const digit = value[index] ?? '';
          const active = focused && !busy && index === activeIndex;
          return (
            <span
              key={index}
              className={`relative grid h-14 place-items-center rounded-xl font-mono text-[22px] tabular-nums text-droid-text transition-[background-color,box-shadow] duration-150 ${
                active ? 'bg-droid-active ring-2 ring-droid-accent/15' : 'bg-droid-field'
              } ${busy ? 'opacity-60' : ''}`}
            >
              {digit}
              {active && !digit && (
                <span className="h-6 w-[1.5px] rounded-full bg-droid-text motion-safe:animate-pulse" />
              )}
            </span>
          );
        })}
      </div>
    </motion.div>
  );
}
