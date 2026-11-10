// The Effects section's shadows: one row per kit shadow token the element
// draws, then a button that adds one. A pick or removal writes the whole list
// as one stacked shadow; a shadow drawn other than from kit tokens shows raw,
// in a single row.

import { useRef, useState } from 'react';
import { Plus, Trash } from '@droidex/icons';
import { Button } from '../../components/ui/Button';
import { Tooltip } from '../../components/ui/Tooltip';
import { Labelled } from './ElementPanelRows';
import { shadowTokens } from './panelValues';
import { OptionPopover, ValuePickerField, type ValueOption } from './ValuePickerField';

interface ShadowRowsProps {
  /** The element's shadow as the panel shows it. */
  shadow: string;
  /** The kit's shadow tokens; undefined until they load. */
  options: ValueOption[] | undefined;
  disabled: boolean;
  onPick: (value: string) => void;
  onHover: (value: string | null) => void;
}

export function ShadowRows({ shadow, options, disabled, onPick, onHover }: ShadowRowsProps) {
  const tokens = options ?? [];
  const layers = shadowTokens(shadow, tokens);
  const off = disabled || tokens.length === 0;
  const note = options?.length === 0 && 'This kit defines no shadows.';
  if (layers === null || layers.length === 0)
    return (
      <Labelled label="Shadow" note={note}>
        <ValuePickerField
          label="Shadow"
          options={tokens}
          value={shadow}
          face={shadow === 'none' ? 'None' : shadow}
          disabled={off}
          onPick={onPick}
          onActive={onHover}
        />
      </Labelled>
    );
  // A shadow has no none to write, so the last one is changed, not removed.
  const written = (next: readonly string[]) => next.join(', ');
  const replaced = (index: number, token: string) =>
    written(layers.map((layer, at) => (at === index ? token : layer)));
  return (
    <>
      {layers.map((layer, index) => {
        const name = index === 0 ? 'Shadow' : `Shadow ${String(index + 1)}`;
        return (
          <Labelled key={index} label={index === 0 ? 'Shadow' : ''}>
            <div className="flex items-center gap-1">
              <div className="min-w-0 flex-1">
                <ValuePickerField
                  label={name}
                  options={tokens}
                  value={layer}
                  disabled={off}
                  onPick={(token) => {
                    onPick(replaced(index, token));
                  }}
                  onActive={(token) => {
                    onHover(token === null ? null : replaced(index, token));
                  }}
                />
              </div>
              {layers.length > 1 && (
                <Tooltip label="Remove shadow">
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={Trash}
                    aria-label={`Remove ${name}`}
                    disabled={disabled}
                    onClick={() => {
                      onPick(written(layers.filter((_, at) => at !== index)));
                    }}
                  />
                </Tooltip>
              )}
            </div>
          </Labelled>
        );
      })}
      <Labelled label="">
        <AddShadow
          options={tokens}
          disabled={off}
          onPick={(token) => {
            onPick(written([...layers, token]));
          }}
          onActive={(token) => {
            onHover(token === null ? null : written([...layers, token]));
          }}
        />
      </Labelled>
    </>
  );
}

function AddShadow({
  options,
  disabled,
  onPick,
  onActive,
}: {
  options: ValueOption[];
  disabled: boolean;
  onPick: (token: string) => void;
  onActive: (token: string | null) => void;
}) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        ref={anchor}
        variant="ghost"
        size="sm"
        icon={Plus}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => {
          setOpen((was) => !was);
        }}
      >
        Add shadow
      </Button>
      <OptionPopover
        label="Add shadow"
        options={options}
        value=""
        disabled={disabled}
        anchorRef={anchor}
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        onPick={onPick}
        onActive={onActive}
      />
    </>
  );
}
