export type PrDetailTab = 'summary' | 'changes';

// `key` is the digit that switches to the view from anywhere in the pane.
export const PR_DETAIL_TABS: { id: PrDetailTab; label: string; key: string }[] = [
  { id: 'summary', label: 'Summary', key: '1' },
  { id: 'changes', label: 'Changes', key: '2' },
];

export function prDetailTabId(tab: PrDetailTab): string {
  return `pull-request-${tab}-tab`;
}

export function prDetailTabPanelId(tab: PrDetailTab): string {
  return `pull-request-${tab}-tabpanel`;
}

// Left and Right move to the neighbouring tab and wrap at the ends, as
// WAI-ARIA tabs do.
export function arrowKeyTab<Id>(tabs: readonly { id: Id }[], current: Id, key: string): Id | null {
  if (key !== 'ArrowLeft' && key !== 'ArrowRight') return null;
  const step = key === 'ArrowRight' ? 1 : -1;
  const index = tabs.findIndex((tab) => tab.id === current);
  return tabs[(index + step + tabs.length) % tabs.length].id;
}
