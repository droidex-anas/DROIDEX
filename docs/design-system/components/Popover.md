# Popover

The floating layer for menus, pickers and option lists. See [engineering.md](../engineering.md) for positioning.

- `raised` fill, `radius-lg` (12px), `shadow-lg` (which carries the edge, so no border), `space-1.5` inner padding, and no gap between items so their hit areas touch. Width 200–320px.
- Menu items: `body` text, `space-1.5` × `space-2` padding, `radius-md` (8px), 16px icon in `text-muted`. Highlight is `elevated` on light and `active` on dark, where the raised layer already is the elevated rung.
- Groups are separated by space, never a line. `divide-y divide-divider` is only for dense option rows where space alone would hurt scanning.
- A trailing shortcut sits in a `radius-sm` chip of `bg` at 70%, in `caption` and `text-secondary`.
- Destructive items go last after space, with a `danger` label and icon. Their highlight is `danger-soft`.
- It opens on the side with room, flips when it can't fit, and enters by fading in and rising 4px from the anchor over 120–150ms.
- The consumer provides the anchor, the items and their actions.

Implemented by `Popover` and `Menu` in `src/components/ui/`.
