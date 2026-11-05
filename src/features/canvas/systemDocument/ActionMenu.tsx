// The ⋯ menu a section, item or token row carries (spec §6). When it ends its
// row its padding hangs past the row's edge, so the glyph ends on it.

import { useRef, useState } from 'react';
import { Ellipsis, type IconComponent } from '@droidex/icons';
import { Button } from '../../../components/ui/Button';
import { Menu } from '../../../components/ui/Menu';

export interface MenuAction {
  label: string;
  icon?: IconComponent;
  danger?: boolean;
  disabled?: boolean;
  run: () => void;
}

export function ActionMenu({ label, actions }: { label: string; actions: MenuAction[] }) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        ref={anchorRef}
        variant="ghost"
        size="sm"
        icon={Ellipsis}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setOpen((current) => !current);
        }}
        className="last:-mr-1.5"
      />
      <Menu
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        anchorRef={anchorRef}
        label={label}
        width={220}
        placement="bottom-end"
      >
        {actions.map((action) => (
          <Menu.Item
            key={action.label}
            icon={action.icon}
            danger={action.danger}
            disabled={action.disabled}
            onSelect={action.run}
          >
            {action.label}
          </Menu.Item>
        ))}
      </Menu>
    </>
  );
}
