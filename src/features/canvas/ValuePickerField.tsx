// A field that picks one value from a list: the kit's tokens for a property,
// or the keywords its grammar allows. Typing filters the list, arrows move
// through it, and Enter or a click picks, applying the value at once.

import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { Check, ChevronDown } from '@droidex/icons';
import { Input } from '../../components/ui/Field';
import { Popover } from '../../components/ui/Popover';
import { cn } from '../../components/ui/cn';
import { colourFace } from './panelValues';

export interface ValueOption {
  /** What picking writes: a token name or a CSS value. */
  value: string;
  label: string;
  /** The value it stands for, shown muted on the right; also matches the current value. */
  hint?: string;
  /** A colour the option paints, when it is one. */
  swatch?: string;
}

interface ValuePickerProps {
  /** The field's accessible name: the property as a person reads it. */
  label: string;
  options: readonly ValueOption[];
  /** The element's current value, matched against option values and hints. */
  value: string;
  disabled: boolean;
  onPick: (value: string) => void;
}

/** The option whose value or hint is the element's current value, if any. */
function currentOption(options: readonly ValueOption[], value: string): ValueOption | undefined {
  return options.find((option) => option.value === value || option.hint === value);
}

/**
 * The whole field: a compact face with the current option, or `face` (the
 * value itself unless given) when none is current, opening the option list.
 */
export function ValuePickerField({
  label,
  options,
  value,
  face = value,
  disabled,
  onPick,
}: ValuePickerProps & { face?: string }) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const current = currentOption(options, value);
  return (
    <>
      <button
        ref={anchor}
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-disabled={disabled || undefined}
        title={current ? `${current.label} (${current.hint ?? current.value})` : value}
        onClick={() => {
          if (!disabled) setOpen((was) => !was);
        }}
        className="flex h-control-md w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-md bg-field px-2.5 text-body text-primary transition-colors duration-quick ease-smooth-out hover:bg-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring aria-disabled:cursor-default aria-disabled:text-muted"
      >
        {current?.swatch !== undefined && <Swatch colour={current.swatch} />}
        <span className="min-w-0 flex-1 truncate text-left">
          {current ? current.label : face || '—'}
        </span>
        <ChevronDown aria-hidden className="size-icon-sm shrink-0 text-muted" />
      </button>
      <OptionPopover
        label={label}
        options={options}
        value={value}
        disabled={disabled}
        anchorRef={anchor}
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        onPick={onPick}
      />
    </>
  );
}

/** A small icon button that opens the same list, for a number field's tokens. */
export function ValuePickerButton({
  label,
  icon,
  className,
  ...props
}: ValuePickerProps & { icon: ReactNode; className?: string }) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        ref={anchor}
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-disabled={props.disabled || undefined}
        onClick={() => {
          if (!props.disabled) setOpen((was) => !was);
        }}
        className={cn(
          'flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted transition-colors duration-quick ease-smooth-out hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring aria-disabled:cursor-default',
          className,
        )}
      >
        {icon}
      </button>
      <OptionPopover
        label={label}
        anchorRef={anchor}
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        {...props}
      />
    </>
  );
}

function OptionPopover({
  label,
  options,
  value,
  anchorRef,
  open,
  onClose,
  onPick,
}: ValuePickerProps & {
  anchorRef: RefObject<HTMLButtonElement | null>;
  open: boolean;
  onClose: () => void;
}) {
  // The popover mounts its children as it opens, so the list's state starts
  // fresh on the current value every time.
  return (
    <Popover open={open} onClose={onClose} anchorRef={anchorRef} label={label} width={224}>
      <OptionList label={label} options={options} value={value} onClose={onClose} onPick={onPick} />
    </Popover>
  );
}

export function OptionList({
  label,
  options,
  value,
  onClose,
  onPick,
}: Omit<ValuePickerProps, 'disabled'> & { onClose: () => void }) {
  const listId = useId();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(() => {
    const current = currentOption(options, value);
    return Math.max(
      options.findIndex((option) => option === current),
      0,
    );
  });
  const needle = query.trim().toLowerCase();
  const shown = options.filter((option) =>
    `${option.label} ${option.hint ?? ''}`.toLowerCase().includes(needle),
  );
  const clamped = Math.min(active, Math.max(shown.length - 1, 0));
  useEffect(() => {
    document.getElementById(`${listId}-${String(clamped)}`)?.scrollIntoView({ block: 'nearest' });
  }, [listId, clamped]);

  const pick = (option: ValueOption | undefined) => {
    if (!option) return;
    onPick(option.value);
    onClose();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key] ?? 0;
    if (step !== 0) {
      event.preventDefault();
      setActive((clamped + step + shown.length) % Math.max(shown.length, 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      pick(shown[clamped]);
    }
  };
  return (
    <div className="flex flex-col gap-1 p-1.5">
      <Input
        variant="embedded"
        autoFocus
        role="combobox"
        aria-expanded
        aria-controls={listId}
        aria-activedescendant={shown.length === 0 ? undefined : `${listId}-${String(clamped)}`}
        aria-label={`Search ${label}`}
        placeholder="Search"
        value={query}
        spellCheck={false}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
      />
      <div
        id={listId}
        role="listbox"
        aria-label={label}
        className="scrollbar-on-hover max-h-56 overflow-y-auto"
      >
        {shown.length === 0 && (
          <p className="px-2 py-1.5 text-caption text-muted">Nothing by that name.</p>
        )}
        {shown.map((option, index) => {
          const isCurrent = option === currentOption(options, value);
          return (
            <button
              key={option.value}
              id={`${listId}-${String(index)}`}
              type="button"
              role="option"
              tabIndex={-1}
              aria-selected={isCurrent}
              onMouseEnter={() => {
                setActive(index);
              }}
              onClick={() => {
                pick(option);
              }}
              className={cn(
                'flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left text-body text-primary',
                index === clamped && 'bg-active',
              )}
            >
              {option.swatch !== undefined && <Swatch colour={option.swatch} />}
              {/* The name keeps its width, and the value takes what is left. */}
              <span className={cn('min-w-0 truncate', option.hint === undefined && 'flex-1')}>
                {option.label}
              </span>
              {option.hint !== undefined && (
                <span
                  className="min-w-0 flex-1 basis-0 truncate text-right text-caption text-muted"
                  title={option.hint}
                >
                  {option.hint}
                </span>
              )}
              {isCurrent && <Check aria-hidden className="size-icon-sm shrink-0 text-muted" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The value's own colour, edged so any colour reads on any surface; a colour
 * that paints nothing shows the transparency checkerboard instead.
 */
export function Swatch({ colour }: { colour: string }) {
  const none = colourFace(colour).none;
  return (
    <span
      aria-hidden
      className={cn(
        // eslint-disable-next-line design-policy/design-tokens -- colour swatch edge: an arbitrary colour needs an edge to read on any surface
        'size-3 shrink-0 rounded-xs ring-1 ring-inset ring-text/40',
        none && 'canvas-swatch-none',
      )}
      style={{ backgroundColor: none ? undefined : colour }}
    />
  );
}
