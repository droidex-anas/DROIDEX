# Popover

The floating layer for menus, pickers and option lists. See [engineering.md](../engineering.md) for positioning.

- `raised` fill, `radius-lg` (12px), `shadow-lg` (which carries the edge, so no border), `space-1.5` inner padding, and no gap between items so their hit areas touch. Width 200–320px.
- Menu items: `body` text, `space-1.5` × `space-2` padding, `radius-md` (8px), 16px icon in `text-muted`. Highlight is `elevated` on light and `active` on dark, where the raised layer already is the elevated rung.
- Groups are split by a soft `divider`, inset `space-2`. Never a dark rule.
- A trailing shortcut sits in a `radius-sm` chip of `bg` at 70%, in `caption` and `text-secondary`.
- Destructive items go last after a divider, with a `danger` label and icon. Their highlight is `danger-soft`.
- It opens on the side with room, flips when it can't fit, and enters by fading in and rising 4px from the anchor over 120–150ms.
- The consumer provides the anchor, the items and their actions.

Hand-written from `src/components/environment/Popover.tsx` and the composer's send menu (`rounded-xl bg-droid-raised p-1.5`), with the border removed.
