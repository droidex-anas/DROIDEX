// A number, usually with a unit: typing previews (a bare number gains the
// field's unit), the arrow keys step it (Shift by the large step), dragging
// its short name scrubs it, Enter commits and Escape takes it back. A button
// lists the kit's tokens for the property when it has any. At rest it reads
// as the token it matches or with its fraction rounded, and zero or a keyword
// as a muted placeholder; its tooltip keeps the exact value.

import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { Hash } from '@droidex/icons';
import { Input } from '../../components/ui/Field';
import { cn } from '../../components/ui/cn';
import { Tooltip } from '../../components/ui/Tooltip';
import { lengthFace, type LengthFace } from './panelValues';
import { ValuePickerButton, type ValueOption } from './ValuePickerField';

// The unit group wraps the choice so a bare number still yields a string.
const NUMBER = /^(-?\d*\.?\d+)((?:px|rem|em|%)?)$/;

export interface NumberFieldProps {
  /** The field's accessible name: the property as a person reads it. */
  label: string;
  /** The short name shown before the value, with the label as its tooltip when they differ; dragging it scrubs. */
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

/** The exact value, after the token the face names, when it names one. */
function faceTitle(face: LengthFace, value: string): string {
  const named = face.token ?? face.text;
  return named && named !== value ? `${named} · ${value}` : value;
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
  const [editing, setEditing] = useState(false);
  // What it reads as at rest; typing, and a preview, always show the value itself.
  const face: LengthFace =
    editing || previewed ? { text: value, placeholder: '' } : lengthFace(value, tokens);
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
  const shortName = (
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
  );
  return (
    <div className="min-w-0">
      <Input
        ref={input}
        variant="compact"
        aria-label={label}
        value={face.text}
        placeholder={face.placeholder}
        title={faceTitle(face, value)}
        readOnly={disabled}
        spellCheck={false}
        inputMode="decimal"
        onFocus={() => {
          setEditing(true);
        }}
        onBlur={() => {
          setEditing(false);
        }}
        className={cn('group tabular-nums', previewed && 'bg-active')}
        leading={short === label ? shortName : <Tooltip label={label}>{shortName}</Tooltip>}
        actions={
          (tokens?.length ?? 0) > 0 || trailing !== undefined ? (
            <span className="relative flex items-center">
              {trailing}
              {tokens?.length ? (
                // Shown on hover over the value's end, as a design tool's token
                // button is, so a token name at rest has the field's whole width.
                <ValuePickerButton
                  label={`${label} tokens`}
                  icon={<Hash aria-hidden className="size-icon-sm" />}
                  options={tokens}
                  value={value}
                  disabled={disabled}
                  onPick={onPick}
                  className={cn(
                    'absolute right-full top-1/2 -translate-y-1/2 opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100',
                    previewed ? 'bg-active' : 'bg-field group-hover:bg-active',
                  )}
                />
              ) : null}
            </span>
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
