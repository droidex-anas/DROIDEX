// One choice among a few, as a design tool shows it: its label, then a row of
// icon or short text segments with radio semantics. Arrow keys move the choice
// like native radios; picking a segment applies it at once. Icon segments share
// the row; a text segment takes the room its word needs.

import { useId, useRef, type KeyboardEvent, type RefObject } from 'react';
import type { IconComponent } from '@droidex/icons';
import { cn } from '../../components/ui/cn';
import { Tooltip } from '../../components/ui/Tooltip';

export interface Segment<T extends string> {
  value: T;
  /** The icon's accessible name and tooltip, a text face's tooltip, or else the face itself. */
  label: string;
  /** The face of an icon-less segment, which names it; defaults to the label. */
  text?: string;
  icon?: IconComponent;
  /** Extra classes for the icon, such as a flip for a reversed direction. */
  iconClassName?: string;
}

export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  disabled,
  selectedRef,
  onPick,
}: {
  label: string;
  options: readonly Segment<T>[];
  /** The chosen value, or '' when the element's value matches no segment. */
  value: T | '';
  disabled: boolean;
  /** Takes the chosen segment, so a caller can focus the group. */
  selectedRef?: RefObject<HTMLButtonElement | null>;
  onPick: (value: T) => void;
}) {
  const labelId = useId();
  const groupRef = useRef<HTMLDivElement>(null);
  const current = options.findIndex((option) => option.value === value);
  // Among icons a word takes only its own width; a row of words shares it.
  const wordWidth = options.some((option) => option.icon) ? 'shrink-0' : 'min-w-0 flex-1';
  const onKeyDown = (event: KeyboardEvent) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    if (disabled) return;
    const next = (Math.max(current, 0) + step + options.length) % options.length;
    const option = options.at(next);
    if (option === undefined) return;
    onPick(option.value);
    groupRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
  };
  return (
    <div className="flex items-center gap-2">
      <span id={labelId} className="w-16 shrink-0 truncate text-label text-muted">
        {label}
      </span>
      <div
        ref={groupRef}
        role="radiogroup"
        aria-labelledby={labelId}
        onKeyDown={onKeyDown}
        className="flex h-control-sm min-w-0 flex-1 items-stretch gap-0.5 rounded-md bg-field p-0.5"
      >
        {options.map((option, index) => {
          const selected = option.value === value;
          const button = (
            <button
              ref={selected ? selectedRef : undefined}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={option.icon ? option.label : undefined}
              aria-disabled={disabled || undefined}
              tabIndex={selected || (current === -1 && index === 0) ? 0 : -1}
              onClick={() => {
                if (!disabled) onPick(option.value);
              }}
              className={cn(
                'flex h-full w-full min-w-0 cursor-pointer items-center justify-center rounded-sm transition-colors duration-quick ease-smooth-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring aria-disabled:cursor-default',
                option.icon ? 'px-1' : 'px-1.5',
                selected ? 'bg-active text-primary' : 'text-muted hover:text-primary',
              )}
            >
              {option.icon ? (
                <option.icon aria-hidden className={cn('size-icon-sm', option.iconClassName)} />
              ) : (
                <span className="whitespace-nowrap text-label">{option.text ?? option.label}</span>
              )}
            </button>
          );
          return option.icon || option.text !== undefined ? (
            <Tooltip
              key={option.value}
              label={option.label}
              className={option.icon ? 'min-w-0 flex-1' : wordWidth}
            >
              {button}
            </Tooltip>
          ) : (
            <span key={option.value} className={wordWidth}>
              {button}
            </span>
          );
        })}
      </div>
    </div>
  );
}
