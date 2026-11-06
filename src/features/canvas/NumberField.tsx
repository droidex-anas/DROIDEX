// A number, usually with a unit: typing previews (a bare number gains the
// field's unit), the arrow keys step it (Shift by the large step), dragging
// its short name scrubs it, Enter commits and Escape takes it back. A button
// lists the kit's tokens for the property when it has any.

import { useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { Hash } from '@droidex/icons';
import { Input } from '../../components/ui/Field';
import { cn } from '../../components/ui/cn';
import { ValuePickerButton, type ValueOption } from './ValuePickerField';

// The unit group wraps the choice so a bare number still yields a string.
const NUMBER = /^(-?\d*\.?\d+)((?:px|rem|em|%)?)$/;

export interface NumberFieldProps {
  /** The field's accessible name: the property as a person reads it. */
  label: string;
  /** The short name shown before the value; dragging it scrubs. */
  short: string;
  value: string;
  previewed: boolean;
  disabled: boolean;
  /** The unit a bare number gains; null where the property reads unitless. */
  unit: 'px' | null;
  step: number;
  shiftStep: number;
  min?: number;
  max?: number;
  /** The property's kit tokens, when it takes any. */
  tokens?: ValueOption[];
  /** Extra control at the field's end, such as a size mode menu. */
  trailing?: ReactNode;
  onPreview: (value: string) => void;
  onRevert: () => void;
  onCommit: () => void;
  onLeave: () => void;
  /** A token pick or mode choice: previews the value and commits at once. */
  onPick: (value: string) => void;
}

/** The value's amount and unit, or null for a keyword such as `fit-content`. */
function parseNumber(value: string): { amount: number; unit: string } | null {
  const match = NUMBER.exec(value.trim());
  if (!match) return null;
  return { amount: Number(match[1]), unit: match[2] };
}

/** A stepped amount without float dust. */
function amountText(amount: number): string {
  return String(Math.round(amount * 1000) / 1000);
}

export function NumberField({
  label,
  short,
  value,
  previewed,
  disabled,
  unit,
  step,
  shiftStep,
  min,
  max,
  tokens,
  trailing,
  onPreview,
  onRevert,
  onCommit,
  onLeave,
  onPick,
}: NumberFieldProps) {
  const input = useRef<HTMLInputElement>(null);
  /** The drag in progress, held by pointer capture so it ends with the pointer or the field. */
  const scrub = useRef<{ startX: number; start: { amount: number; unit: string } } | null>(null);
  const clamp = (amount: number): number => {
    if (min !== undefined) amount = Math.max(min, amount);
    if (max !== undefined) amount = Math.min(max, amount);
    return amount;
  };
  const stepBy = (delta: number) => {
    const parsed = parseNumber(value);
    if (!parsed) return;
    const next = clamp(parsed.amount + delta);
    onPreview(`${amountText(next)}${parsed.unit || (unit ?? '')}`);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      // A bare number commits with the field's unit, the way it steps.
      const trimmed = value.trim();
      if (unit !== null && /^-?\d*\.?\d+$/.test(trimmed)) onPreview(`${trimmed}${unit}`);
      onCommit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      // While saving, the preview is what is being written, so it stays.
      if (previewed && !disabled) onRevert();
      else onLeave();
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      if (disabled) return;
      const direction = event.key === 'ArrowUp' ? 1 : -1;
      stepBy(direction * (event.shiftKey ? shiftStep : step));
    }
  };
  const startScrub = (event: PointerEvent<HTMLSpanElement>) => {
    if (disabled || event.button !== 0) return;
    const start = parseNumber(value);
    if (!start) return;
    event.preventDefault();
    input.current?.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    scrub.current = { startX: event.clientX, start };
  };
  /** Scrubbing steps the value it started from, four pixels per step. */
  const moveScrub = (event: PointerEvent<HTMLSpanElement>) => {
    const drag = scrub.current;
    if (!drag || disabled) return;
    const steps = Math.round((event.clientX - drag.startX) / 4);
    const next = clamp(drag.start.amount + steps * step);
    onPreview(`${amountText(next)}${drag.start.unit || (unit ?? '')}`);
  };
  return (
    <div className="flex min-w-0 items-center gap-1">
      <Input
        ref={input}
        variant="compact"
        aria-label={label}
        value={value}
        title={value}
        readOnly={disabled}
        spellCheck={false}
        inputMode="decimal"
        className={cn('tabular-nums', previewed && 'bg-active')}
        leading={
          <span
            aria-hidden
            onPointerDown={startScrub}
            onPointerMove={moveScrub}
            onLostPointerCapture={() => {
              scrub.current = null;
            }}
            className={cn(
              'flex min-w-7 shrink-0 cursor-ew-resize touch-none select-none items-center pr-1 whitespace-nowrap text-label',
              previewed ? 'text-primary' : 'text-muted',
            )}
          >
            {short}
          </span>
        }
        actions={
          (tokens?.length ?? 0) > 0 || trailing !== undefined ? (
            <>
              {trailing}
              {tokens?.length ? (
                <ValuePickerButton
                  label={`${label} tokens`}
                  icon={<Hash aria-hidden className="size-icon-sm" />}
                  options={tokens}
                  value={value}
                  disabled={disabled}
                  onPick={onPick}
                />
              ) : null}
            </>
          ) : undefined
        }
        onChange={(event) => {
          onPreview(event.target.value);
        }}
        onKeyDown={onKeyDown}
      />
    </div>
  );
}
