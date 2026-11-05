// The document column scrolls alone: scrollIntoView would also scroll the
// pane's clipped ancestors and push the header out of the window.

import type { KitFile } from './kitFiles';

export function revealSection(column: HTMLElement, id: string) {
  const section = column.querySelector<HTMLElement>(`[data-section-id="${CSS.escape(id)}"]`);
  if (!section) return;
  scrollColumn(column, topIn(column, section));
  section.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
}

export function revealFile(column: HTMLElement, shownAt: NonNullable<KitFile['shownAt']>) {
  if (shownAt === 'cover') {
    scrollColumn(column, 0);
    return;
  }
  const item = column.querySelector<HTMLElement>(`[data-item-id="${CSS.escape(shownAt.itemId)}"]`);
  if (item) scrollColumn(column, topIn(column, item));
}

function topIn(column: HTMLElement, element: HTMLElement): number {
  return (
    element.getBoundingClientRect().top -
    column.getBoundingClientRect().top +
    column.scrollTop -
    parseFloat(getComputedStyle(element).scrollMarginTop)
  );
}

function scrollColumn(column: HTMLElement, top: number) {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  column.scrollTo({ top, behavior: reduceMotion ? 'auto' : 'smooth' });
}
