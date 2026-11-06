// A size field's mode menu: whether a width or height is fixed, hugs its
// contents or fills its container, and whether a maximum is set at all.

import { useRef, useState } from 'react';
import { ChevronDown } from '@droidex/icons';
import { Menu } from '../../components/ui/Menu';

/** The mode a size reads as; null for one none of them names, such as `auto` or `50%`. */
function sizeMode(value: string): 'Fixed' | 'Hug' | 'Fill' | null {
  if (value === 'fit-content') return 'Hug';
  if (value === '100%') return 'Fill';
  return /^\d*\.?\d+px$/.test(value.trim()) ? 'Fixed' : null;
}

/** A width or height's sizing mode: fixed at a length, hugging contents, or filling. */
export function SizeMode({
  label,
  extent,
  value,
  disabled,
  onPick,
}: {
  label: string;
  /** The element's drawn size on this axis, which Fixed fixes to. */
  extent: number;
  value: string;
  disabled: boolean;
  onPick: (value: string) => void;
}) {
  const mode = sizeMode(value);
  return (
    <ModeMenu
      label={`${label} sizing`}
      mode={mode}
      face={mode === 'Hug' || mode === 'Fill' ? mode : undefined}
      disabled={disabled}
      choices={[
        {
          name: 'Fixed',
          pick: () => {
            onPick(`${String(Math.round(extent))}px`);
          },
        },
        {
          name: 'Hug contents',
          pick: () => {
            onPick('fit-content');
          },
        },
        {
          name: 'Fill container',
          pick: () => {
            onPick('100%');
          },
        },
      ]}
    />
  );
}

/** A maximum's mode: fixed at a length, or none. */
export function NoneMode({
  label,
  value,
  disabled,
  onPick,
}: {
  label: string;
  value: string;
  disabled: boolean;
  onPick: (value: string) => void;
}) {
  return (
    <ModeMenu
      label={label}
      // The field itself reads None, so the button shows only its chevron.
      mode={value === 'none' ? 'None' : 'Fixed'}
      disabled={disabled}
      choices={[
        // Fixed needs a length, so the number field is the way back to it.
        { name: 'Fixed' },
        {
          name: 'None',
          pick: () => {
            onPick('none');
          },
        },
      ]}
    />
  );
}

function ModeMenu({
  label,
  mode,
  face,
  disabled,
  choices,
}: {
  label: string;
  mode: string | null;
  /** Text beside the chevron, for a mode the field's own value does not show. */
  face?: string;
  disabled: boolean;
  choices: { name: string; pick?: () => void }[];
}) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        ref={anchor}
        type="button"
        aria-label={mode === null ? label : `${label}, now ${mode}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-disabled={disabled || undefined}
        onClick={() => {
          if (!disabled) setOpen((was) => !was);
        }}
        className="flex h-6 shrink-0 cursor-pointer items-center rounded-sm px-0.5 text-label text-muted transition-colors duration-quick ease-smooth-out hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring aria-disabled:cursor-default"
      >
        {face}
        <ChevronDown aria-hidden className="size-icon-sm" />
      </button>
      <Menu
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        anchorRef={anchor}
        label={label}
        width={140}
      >
        {choices.map((choice) => (
          <Menu.Item
            key={choice.name}
            onSelect={() => {
              setOpen(false);
              if (choice.name !== mode) choice.pick?.();
            }}
          >
            {choice.name}
          </Menu.Item>
        ))}
      </Menu>
    </>
  );
}
