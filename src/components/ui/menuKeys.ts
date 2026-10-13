// Keyboard navigation over a menu's enabled items. `current` is -1 when no
// item has focus (the menu itself does).

export function navigationIndex(key: string, current: number, count: number): number | null {
  if (count === 0) return null;
  switch (key) {
    case 'ArrowDown':
      return current < 0 ? 0 : (current + 1) % count;
    case 'ArrowUp':
      return current < 0 ? count - 1 : (current - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

// The item whose label starts with what has been typed. Repeating one letter
// cycles through the items that start with it, as native menus do; a longer
// query keeps the current item while it still matches.
export function typeaheadIndex(labels: string[], query: string, current: number): number {
  const typed = query.toLowerCase();
  const cycling = typed === typed[0].repeat(typed.length);
  const prefix = cycling ? typed[0] : typed;
  const start = cycling ? current + 1 : Math.max(current, 0);
  for (let step = 0; step < labels.length; step++) {
    const index = (start + step) % labels.length;
    if (labels[index].trim().toLowerCase().startsWith(prefix)) return index;
  }
  return -1;
}
