// The pull request tablists are one tab stop each: Left and Right move to the
// neighbouring tab and wrap at the ends, as WAI-ARIA tabs do.
export function arrowKeyTab<Id>(tabs: readonly { id: Id }[], current: Id, key: string): Id | null {
  if (key !== 'ArrowLeft' && key !== 'ArrowRight') return null;
  const step = key === 'ArrowRight' ? 1 : -1;
  const index = tabs.findIndex((tab) => tab.id === current);
  return tabs[(index + step + tabs.length) % tabs.length].id;
}
