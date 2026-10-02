import type { KeyboardEvent } from 'react';

export const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// aria-modal contract: Tab cycles inside the dialog. Focus on the dialog
// itself (a click on non-focusable content) or outside it wraps to the edges
// instead of walking into the page behind the scrim.
export function wrapTabFocus(event: KeyboardEvent, dialog: HTMLElement | null): void {
  if (event.key !== 'Tab' || !dialog) return;
  const focusables = dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
  if (focusables.length === 0) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const active = document.activeElement;
  const outside = active === dialog || !dialog.contains(active);
  if (event.shiftKey && (active === first || outside)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || outside)) {
    event.preventDefault();
    first.focus();
  }
}
