// A Components row's variant menu: one radio group per prop of the entry,
// each pick kept until the entry is added. The search keeps the keyboard, so
// the menu opens from it (⌥↓ or the row's caret) and hands focus back to it.

import type { RefObject } from 'react';
import { Check } from '@droidex/icons';
import { cn } from '../../../components/ui/cn';
import { Menu } from '../../../components/ui/Menu';
import type { CatalogListing } from '../protocol';
import type { ChosenProps } from './paletteRows';

export function VariantMenu({
  entry,
  chosen,
  searchRef,
  triggerRef,
  onClose,
  onPick,
}: {
  /** The entry whose menu is open, or undefined while none is. */
  entry: CatalogListing | undefined;
  chosen: ChosenProps;
  searchRef: RefObject<HTMLInputElement | null>;
  /** The open row's caret, which the menu sits under. */
  triggerRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onPick: (prop: string, option: string) => void;
}) {
  return (
    <Menu
      open={entry !== undefined}
      onClose={onClose}
      anchorRef={searchRef}
      alignRef={triggerRef}
      placement="bottom-end"
      label={`${entry?.name ?? ''} variants`}
      width={200}
      className="max-h-80"
    >
      {entry?.props.map((prop) => (
        <div key={prop.name} role="group" aria-label={prop.name}>
          <Menu.Label>{prop.name}</Menu.Label>
          {prop.options.map((option) => {
            const checked = (chosen[prop.name] ?? prop.default) === option;
            return (
              <Menu.Item
                key={option}
                role="menuitemradio"
                aria-checked={checked}
                onSelect={() => {
                  onPick(prop.name, option);
                }}
              >
                <span className={cn('min-w-0 flex-1 truncate', checked && 'text-body-strong')}>
                  {option}
                </span>
                <Check
                  className={cn('size-icon-sm shrink-0 text-accent', !checked && 'invisible')}
                  aria-hidden="true"
                />
              </Menu.Item>
            );
          })}
        </div>
      ))}
    </Menu>
  );
}
