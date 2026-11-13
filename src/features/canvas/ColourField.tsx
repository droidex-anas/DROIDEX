// A colour: its swatch and value, then a popover that lists the kit's colour
// tokens first and picks any colour after them. It reads as its token's name,
// else hex with any opacity, else None, focused or not: typing starts from
// what it reads as, and previews; a token or swatch pick commits at once; a
// custom drag previews and commits as the popover closes.

import { useRef, useState, type KeyboardEvent } from 'react';
import { ChevronDown } from '@droidex/icons';
import { ColorPicker } from '../../components/ColorPicker';
import { Input } from '../../components/ui/Field';
import { Popover } from '../../components/ui/Popover';
import { cn } from '../../components/ui/cn';
import { colourFace, typedColour } from './panelValues';
import { OptionList, Swatch, type ValueOption } from './ValuePickerField';

const HEX = /^#(?:[0-9a-f]{3}){1,2}$/i;
const RGB = /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/;

/** The picker's start colour: the value as hex when it reads as one, else black. */
function hexOf(value: string): string {
  if (HEX.test(value.trim())) return value.trim().toLowerCase();
  const rgb = RGB.exec(value.trim());
  if (!rgb) return '#000000';
  const channel = (part: string | undefined) =>
    Math.min(255, Number(part)).toString(16).padStart(2, '0');
  return `#${channel(rgb[1])}${channel(rgb[2])}${channel(rgb[3])}`;
}

export function ColourField({
  label,
  value,
  previewed,
  disabled,
  tokens,
  onPreview,
  onRevert,
  onCommit,
  onLeave,
  onPick,
  onActive,
}: {
  /** The field's accessible name: the property as a person reads it. */
  label: string;
  value: string;
  previewed: boolean;
  disabled: boolean;
  /** The property's colour tokens, their values as swatches. */
  tokens: ValueOption[];
  onPreview: (value: string) => void;
  onRevert: () => void;
  onCommit: () => void;
  onLeave: () => void;
  onPick: (value: string) => void;
  /** A token the list rests on, to preview; null once it is left unpicked. */
  onActive: (value: string | null) => void;
}) {
  const field = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  /** The picker was dragged since the popover opened, so closing it commits the colour. */
  const dragged = useRef(false);
  /** The text last typed and the value it previewed; null once the field reads its value again. */
  const [typed, setTyped] = useState<{ text: string; value: string } | null>(null);
  // As a number field's: typing shows as typed only while it is still the preview.
  const face =
    typed !== null && previewed && typed.value === value
      ? typed.text
      : colourFace(value, tokens).text;
  const close = () => {
    setOpen(false);
    if (!dragged.current) return;
    dragged.current = false;
    onCommit();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      setTyped(null);
      onCommit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setTyped(null);
      // While saving, the preview is what is being written, so it stays.
      if (previewed && !disabled) onRevert();
      else onLeave();
    }
  };
  return (
    <div ref={field} className="min-w-0">
      <Input
        variant="compact"
        aria-label={label}
        value={face}
        readOnly={disabled}
        spellCheck={false}
        className={cn(previewed && 'bg-active')}
        leading={
          <span className="flex shrink-0 items-center pr-1.5">
            <Swatch colour={value} />
          </span>
        }
        actions={
          <button
            ref={trigger}
            type="button"
            aria-label={`Pick ${label}`}
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-disabled={disabled || undefined}
            onClick={() => {
              if (open) close();
              else if (!disabled) setOpen(true);
            }}
            className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted transition-colors duration-quick ease-smooth-out hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring aria-disabled:cursor-default"
          >
            <ChevronDown aria-hidden className="size-icon-sm" />
          </button>
        }
        onBlur={() => {
          setTyped(null);
        }}
        onChange={(event) => {
          const next = typedColour(event.target.value, tokens);
          setTyped({ text: event.target.value, value: next });
          onPreview(next);
        }}
        onKeyDown={onKeyDown}
      />
      {/* Beside the panel rather than over the fields below it. */}
      <Popover
        open={open}
        onClose={close}
        anchorRef={trigger}
        alignRef={field}
        label={label}
        width={232}
        placement="left-start"
      >
        <div className="flex flex-col gap-1 p-1.5">
          {tokens.length > 0 && (
            <OptionList
              label={`${label} tokens`}
              options={tokens}
              value={value}
              onClose={close}
              onPick={(token) => {
                // The token is the colour now; the drag before it goes with this commit.
                dragged.current = false;
                onPick(token);
              }}
              onActive={onActive}
            />
          )}
          <ColorPicker
            value={hexOf(value)}
            onChange={(hex) => {
              if (disabled) return;
              dragged.current = true;
              onPreview(hex);
            }}
          />
        </div>
      </Popover>
    </div>
  );
}
