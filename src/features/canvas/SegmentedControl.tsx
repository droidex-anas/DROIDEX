// One choice among a few, as a design tool shows it: its label, then a row of
// icon or short text segments with radio semantics. Arrow keys move the choice
// like native radios; picking a segment applies it at once. Icon segments share
// the row; a text segment takes the room its word needs. A ⋯ segment can end
// the row with a menu of the choices it leaves out.

import { useId, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { Check, Ellipsis, type IconComponent } from '@droidex/icons';
import { cn } from '../../components/ui/cn';
import { Menu } from '../../components/ui/Menu';
import { Tooltip } from '../../components/ui/Tooltip';
import { segmentClass } from './segmentClass';

export interface Segment<T extends string | number> {
  value: T;
  /** The icon's accessible name and tooltip, a text face's tooltip, or else the face itself. */
  label: string;
  /** The face of an icon-less segment, which names it; defaults to the label. */
  text?: string;
  icon?: IconComponent;
  /** Extra classes for the icon, such as a flip for a reversed direction. */
  iconClassName?: string;
}

export function SegmentedControl<T extends string | number>({
  label,
  options,
  value,
  disabled,
  selectedRef,
  more,
  onPick,
}: {
  label: string;
  options: readonly Segment<T>[];
  /** The chosen value, or '' when the element's value matches no segment. */
  value: T | '';
  disabled: boolean;
  /** Takes the chosen segment, so a caller can focus the group. */
  selectedRef?: RefObject<HTMLButtonElement | null>;
  /** A `MoreSegments` menu at the row's end. */
  more?: ReactNode;
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
    // With nothing chosen, an arrow chooses the first segment, or the last going back.
    const from = current === -1 && step < 0 ? 0 : current;
    const next = (from + step + options.length) % options.length;
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
      <div className="flex h-control-sm min-w-0 flex-1 items-stretch gap-0.5 rounded-md bg-field p-0.5">
        <div
          ref={groupRef}
          role="radiogroup"
          aria-labelledby={labelId}
          onKeyDown={onKeyDown}
          className="flex min-w-0 flex-1 items-stretch gap-0.5"
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
                className={segmentClass(selected, option.icon ? 'px-1' : 'px-1.5')}
              >
                {option.icon ? (
                  <option.icon aria-hidden className={cn('size-icon-sm', option.iconClassName)} />
                ) : (
                  <span className="truncate text-label">{option.text ?? option.label}</span>
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
        {more}
      </div>
    </div>
  );
}

/**
 * A ⋯ segment that ends a row with a menu of the choices its segments leave
 * out; it reads as chosen while the value is one of them.
 */
export function MoreSegments({
  label,
  options,
  value,
  disabled,
  onPick,
}: {
  label: string;
  options: readonly Segment<string>[];
  value: string;
  disabled: boolean;
  onPick: (value: string) => void;
}) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const chosen = options.find((option) => option.value === value);
  return (
    <>
      <Tooltip label={chosen?.label ?? label} className="shrink-0">
        <button
          ref={anchor}
          type="button"
          aria-label={chosen ? `${label}, now ${chosen.text ?? chosen.label}` : label}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-disabled={disabled || undefined}
          onClick={() => {
            if (!disabled) setOpen((was) => !was);
          }}
          className={segmentClass(chosen !== undefined, 'px-1')}
        >
          <Ellipsis aria-hidden className="size-icon-sm" />
        </button>
      </Tooltip>
      <Menu
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        anchorRef={anchor}
        label={label}
        width={160}
        placement="bottom-end"
      >
        {options.map((option) => (
          <Menu.Item
            key={option.value}
            role="menuitemradio"
            aria-checked={option === chosen}
            onSelect={() => {
              if (option !== chosen) onPick(option.value);
            }}
          >
            <span className="flex-1 truncate">{option.text ?? option.label}</span>
            {option === chosen && (
              <Check aria-hidden className="ml-auto size-icon-sm shrink-0 text-accent" />
            )}
          </Menu.Item>
        ))}
      </Menu>
    </>
  );
}
