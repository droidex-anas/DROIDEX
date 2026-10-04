export const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// aria-modal contract: Tab cycles inside the dialog. Focus on the dialog
// itself (a click on non-focusable content) or outside it wraps to the edges
// instead of walking into the page behind the scrim.
export function wrapTabFocus(
  event: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'preventDefault'>,
  dialog: HTMLElement | null,
): void {
  if (event.key !== 'Tab' || !dialog) return;
  const focusables = dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
  // Every control disabled (work pending): Tab stays on the dialog.
  if (focusables.length === 0) {
    event.preventDefault();
    dialog.focus();
    return;
  }
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const active = dialog.ownerDocument.activeElement;
  const outside = active === dialog || !dialog.contains(active);
  if (event.shiftKey && (active === first || outside)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || outside)) {
    event.preventDefault();
    first.focus();
  }
}
