// The context menu of a layer's row in the layers panel: what the row's own
// keys do to its layer, opened where the pointer right-clicked.

import type { RefObject } from 'react';
import { Copy, Trash } from '@droidex/icons';
import { Menu } from '../../../components/ui/Menu';
import type { AnchorPoint } from '../../../components/ui/usePopoverPosition';
import { DUPLICATE_KEY_LABEL } from './layerKeys';

const MENU_WIDTH = 200;

export function LayerMenu({
  name,
  at,
  anchorRef,
  onDuplicate,
  onDelete,
  onClose,
}: {
  /** The layer's row label, which names the menu. */
  name: string;
  at: AnchorPoint;
  /** What takes the keyboard back once the menu closes. */
  anchorRef: RefObject<HTMLElement | null>;
  onDuplicate: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  return (
    <Menu
      open
      onClose={onClose}
      anchorRef={anchorRef}
      anchorPoint={at}
      label={`${name} layer`}
      width={MENU_WIDTH}
      onContextMenu={(event) => {
        event.preventDefault();
      }}
    >
      <Menu.Item icon={Copy} onSelect={onDuplicate}>
        Duplicate
        <Menu.Shortcut>{DUPLICATE_KEY_LABEL}</Menu.Shortcut>
      </Menu.Item>
      <Menu.Item icon={Trash} danger onSelect={onDelete}>
        Delete
        <Menu.Shortcut>⌫</Menu.Shortcut>
      </Menu.Item>
    </Menu>
  );
}
